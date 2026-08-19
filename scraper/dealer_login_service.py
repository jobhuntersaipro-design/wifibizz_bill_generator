"""
dealer_login_service.py - Holds a live Playwright browser between the two HTTP
requests of the interactive per-user dealer login (request OTP -> submit OTP).

Why this exists
---------------
`api_server.py` drives Playwright with `asyncio.run(...)` per request, which
creates and destroys a browser each call. The two-step OTP login needs ONE
browser to survive from "Send OTP" to "Verify", so we run all Playwright work on
a single persistent event loop living in a daemon thread for the life of the
process. Both requests submit their coroutine to that loop, so the objects
created in step 1 are still valid in step 2.

Public API (sync, safe to call from Flask handlers)
---------------------------------------------------
    request_otp(staff_code, password, channel, user_key, registered_email) -> dict
    submit_otp(pending_id, otp)                                            -> dict
    auto_status(pending_id, user_key)                                      -> dict
    cancel(pending_id)                                                     -> dict

Sessions are saved per user to `sessions/dealer_<user_key>.json`.

Auto-read OTP (see context/features/gmail-otp-auto-read-spec.md)
---------------------------------------------------
The account owner sets up Gmail auto-forwarding from their dealer account's
registered email to the one shared inbox this server has Gmail API access to
(no per-user OAuth — just Gmail's native "Forwarding and POP/IMAP" setting).
For an Email-channel login WITH a `registered_email` supplied, `request_otp()`
kicks off a background read of `gmail_otp_reader.get_latest_otp()` (filtered
by both sender AND `to:registered_email`, since Gmail preserves the original
To header on auto-forwarded mail — this is what stops two concurrent logins
forwarding into the same shared inbox from cross-matching each other's OTP)
and finishes the login itself — no human has to copy-paste the code. Without
a `registered_email`, or if the forward isn't set up / hasn't landed yet, the
read simply times out after `GMAIL_OTP_TIMEOUT_SECONDS` and the UI falls back
to the existing manual `submit_otp()` form (the user can also skip straight to
it via "Enter code manually instead" without waiting). Auto-read only ever
*adds* a path, never removes the manual one.
"""

import asyncio
import os
import re
import threading
import time
import traceback
import uuid

import dealer_web_login

# OTPs from the portal expire in minutes; drop a pending login after this.
PENDING_TTL_SECONDS = 540  # 9 minutes

# Hard cap on simultaneously-open login browsers. Each pending login holds a live
# Chromium, so this bounds memory/CPU and stops a caller spinning up many at once.
MAX_CONCURRENT_LOGINS = 4

# ── Auto-OTP config ───────────────────────────────────────────────────────────
GMAIL_OTP_SENDER_FILTER = os.environ.get("GMAIL_OTP_SENDER_FILTER", "@unifi.com.my")
# get_latest_otp() backdates its own search start by 60s (to also catch mail
# that landed just before the call), which eats into this budget — the actual
# real-time search window is (this value - 60). Live-tested: Unifi send ->
# Gmail auto-forward -> visible via the API took ~150s in practice, so this
# needs real headroom above 60s, not just "a bit more than expected latency".
# 300 => 240s of real search, comfortably inside PENDING_TTL_SECONDS (540).
GMAIL_OTP_TIMEOUT_SECONDS = int(os.environ.get("GMAIL_OTP_TIMEOUT_SECONDS", "300"))

# Terminal auto-read results, keyed by pending_id, for the client to poll.
# Populated once the background task finishes; separate from _PENDING because a
# successful auto-finish pops the pending record on completion.
_AUTO_STATUS = {}
_AUTO_STATUS_LOCK = threading.Lock()
_AUTO_STATUS_TTL_SECONDS = PENDING_TTL_SECONDS * 2

# ── Persistent background event loop ─────────────────────────────────────────
_loop = None
_loop_lock = threading.Lock()


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """Start (once) and return the shared background event loop."""
    global _loop
    with _loop_lock:
        if _loop is not None and _loop.is_running():
            return _loop
        _loop = asyncio.new_event_loop()

        def _run():
            asyncio.set_event_loop(_loop)
            _loop.run_forever()

        threading.Thread(target=_run, daemon=True, name="dealer-login-loop").start()
        return _loop


def _submit(coro, timeout: float):
    """Run a coroutine on the background loop and block for its result."""
    loop = _ensure_loop()
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    return fut.result(timeout=timeout)


# ── Pending-login registry ───────────────────────────────────────────────────
# pending_id -> {pw, browser, context, page, user_key, session_path, expires_at}
_PENDING = {}
_PENDING_LOCK = threading.Lock()


def _safe_key(user_key: str) -> str:
    """Filesystem-safe per-user session filename component."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(user_key or "shared"))[:64]


def _purge_expired() -> None:
    """Close and drop any pending logins whose OTP window has elapsed."""
    now = time.time()
    expired = []
    with _PENDING_LOCK:
        for pid, rec in list(_PENDING.items()):
            if rec["expires_at"] <= now:
                expired.append(rec)
                del _PENDING[pid]
    for rec in expired:
        _teardown(rec)

    with _AUTO_STATUS_LOCK:
        stale = [
            pid for pid, s in _AUTO_STATUS.items()
            if now - s.get("ts", 0) > _AUTO_STATUS_TTL_SECONDS
        ]
        for pid in stale:
            del _AUTO_STATUS[pid]


def _set_auto_status(pending_id: str, status: str, **extra) -> None:
    with _AUTO_STATUS_LOCK:
        _AUTO_STATUS[pending_id] = {"status": status, "ts": time.time(), **extra}


def _teardown(rec: dict) -> None:
    """Best-effort close of a pending login's browser on the background loop.

    Uses the bounded teardown so a wedged browser.close() (common under memory
    pressure) can't block pw.stop() and leak Chromium processes.
    """
    try:
        _submit(
            dealer_web_login.safe_teardown(rec.get("pw"), rec.get("browser"), rec.get("context")),
            timeout=45,
        )
    except Exception as e:
        print(f"[dealer-login] teardown failed: {e}")


def request_otp(
    staff_code: str, password: str, channel: str, user_key: str,
    registered_email: str = "",
) -> dict:
    """
    Step 1: log in with staff code + password, pick the channel, click GET so the
    portal sends an OTP to the account owner. Keeps the browser open and returns
    a `pending_id` to be passed to `submit_otp()`.

    `registered_email` is the email address registered on this dealer account
    (user-supplied, since we don't get it from the portal). It's required for
    auto-read: it's used as a `to:` filter on the shared inbox, since without
    it two concurrent Email-channel logins forwarding into the same mailbox
    could cross-match each other's OTP. No registered_email -> no auto-read,
    straight to manual (safe default, never guesses).

    Returns {"pending_id", "expires_in"} on success, or {"error", "message"} on
    a hard login failure (browser/redirect). Never stores credentials.
    """
    _purge_expired()

    # One pending login per user — cancel any earlier, unfinished attempt.
    with _PENDING_LOCK:
        stale = [pid for pid, r in _PENDING.items() if r["user_key"] == user_key]
    for pid in stale:
        cancel(pid)

    # Bound the number of simultaneously-open login browsers across all users.
    with _PENDING_LOCK:
        active = len(_PENDING)
    if active >= MAX_CONCURRENT_LOGINS:
        return {
            "error": "too_many_pending",
            "message": "The login service is busy. Try again in a minute.",
        }

    try:
        pw, browser, context, page = _submit(
            dealer_web_login.start_web_login(staff_code, password, channel),
            timeout=180,
        )
    except Exception as e:
        return {"error": "login_start_failed", "message": str(e)}

    pending_id = uuid.uuid4().hex
    session_path = f"sessions/dealer_{_safe_key(user_key)}.json"
    registered_email = (registered_email or "").strip()
    auto_otp = channel.strip().lower() == "email" and bool(registered_email)
    with _PENDING_LOCK:
        _PENDING[pending_id] = {
            "pw": pw,
            "browser": browser,
            "context": context,
            "page": page,
            "user_key": user_key,
            "session_path": session_path,
            # Held in memory only (never persisted) so phase 2 can re-fill the
            # form the portal clears on the GET reload. Dropped on submit/timeout.
            "staff_code": staff_code,
            "password": password,
            "channel": channel,
            "auto_otp": auto_otp,
            "registered_email": registered_email,
            "expires_at": time.time() + PENDING_TTL_SECONDS,
        }

    if auto_otp:
        _set_auto_status(pending_id, "pending")
        # Fire-and-forget on the same persistent loop — the HTTP response
        # returns immediately with auto_otp=true; the client polls auto_status().
        loop = _ensure_loop()
        asyncio.run_coroutine_threadsafe(_auto_otp_task(pending_id), loop)

    return {"pending_id": pending_id, "expires_in": PENDING_TTL_SECONDS, "auto_otp": auto_otp}


def _finish_with_otp(pending_id: str, rec: dict, otp: str) -> dict:
    """Shared finish step used by both the manual submit_otp() call and the
    auto-OTP background task. Caller must already hold rec["in_progress"]."""
    try:
        result = _submit(
            dealer_web_login.finish_web_login(
                rec["pw"], rec["browser"], rec["context"], rec["page"],
                rec["staff_code"], rec["password"], rec["channel"],
                otp, rec["session_path"],
            ),
            timeout=180,
        )
    except Exception as e:
        # Some exceptions (e.g. bare `raise RuntimeError()`, some Playwright
        # errors) stringify to "" — fall back to type name so callers/logs
        # always get something diagnosable instead of a blank message.
        message = str(e) or f"{type(e).__name__} (no message)"
        traceback.print_exc()

        if isinstance(e, dealer_web_login.CredentialsError):
            # The password is wrong, so no OTP can fix it — this login is dead.
            # Drop the record and close the browser (cancel() does both) so the
            # UI can send the user back to the credentials form instead of
            # leaving them staring at an OTP box that will never accept a code.
            cancel(pending_id)
            return {"error": "bad_credentials", "message": message}

        # Wrong/expired OTP: KEEP the pending record and its still-open browser so
        # the user can retry with another code (finish_web_login left it open).
        with _PENDING_LOCK:
            if pending_id in _PENDING:
                _PENDING[pending_id]["in_progress"] = False
        return {"error": "otp_verify_failed", "message": message}

    # Success — the browser is already torn down; drop the pending record.
    with _PENDING_LOCK:
        _PENDING.pop(pending_id, None)
    return {"ok": True, "session_path": result["session_path"]}


def submit_otp(pending_id: str, otp: str, user_key: str = None) -> dict:
    """
    Step 2: submit the user-supplied OTP on the still-open browser, save the
    session, and tear the browser down.

    `user_key` (the calling BizzFlow user) must match the user that started the
    pending login — a client-held pending_id alone is not proof of ownership.

    Returns {"ok": True, "session_path"} on success, or {"error", "message"}.
    """
    _purge_expired()
    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is None:
            return {"error": "pending_not_found",
                    "message": "Login attempt expired or unknown — start again."}
        # Reject if the caller doesn't own this pending login. Leave it in place
        # so the rightful owner can still complete it.
        if user_key is not None and rec["user_key"] != user_key:
            return {"error": "pending_not_found",
                    "message": "Login attempt expired or unknown — start again."}
        # Guard against concurrent submits on the same single-browser login
        # (including a race with the auto-OTP background task).
        if rec.get("in_progress"):
            return {"error": "otp_in_progress",
                    "message": "Still verifying the previous code — please wait a moment."}
        rec["in_progress"] = True

    return _finish_with_otp(pending_id, rec, otp)


def check_now(pending_id: str, user_key: str = None) -> dict:
    """One-shot manual retry: look at the shared inbox RIGHT NOW (single
    query, no wait loop) instead of the user typing the code by hand or
    waiting out the rest of the background auto-read window. For when the
    user can see the OTP already sitting in the inbox but auto-read hasn't
    (yet) picked it up.

    Returns {"ok": True, "session_path"} on success, or {"error", "message"}
    — "not_found" specifically means try again in a few seconds, not a hard
    failure.
    """
    _purge_expired()
    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is None:
            return {"error": "pending_not_found",
                    "message": "Login attempt expired or unknown — start again."}
        if user_key is not None and rec["user_key"] != user_key:
            return {"error": "pending_not_found",
                    "message": "Login attempt expired or unknown — start again."}
        if not rec.get("registered_email"):
            return {"error": "no_registered_email",
                    "message": "No registered email set for this login — enter the OTP manually."}
        if rec.get("in_progress"):
            # Not a failure: the OTP was already found and we're mid-login.
            # The client keeps polling auto-status and will see "completed".
            return {"error": "connecting", "message": "Connecting…"}
        registered_email = rec["registered_email"]

    try:
        from gmail_otp_reader import check_now_otp
        otp = check_now_otp(sender_filter=GMAIL_OTP_SENDER_FILTER, to_filter=registered_email)
    except Exception as e:
        traceback.print_exc()
        return {"error": "check_failed", "message": str(e) or f"{type(e).__name__} (no message)"}

    if not otp:
        return {"error": "not_found",
                "message": "No matching OTP email found yet — try again in a few seconds."}

    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is None:
            return {"error": "pending_not_found",
                    "message": "Login attempt expired or unknown — start again."}
        if rec.get("in_progress"):
            # The background auto-read grabbed the same code first — let it
            # finish rather than racing it on the one shared browser.
            return {"error": "connecting", "message": "Connecting…"}
        rec["in_progress"] = True

    return _finish_with_otp(pending_id, rec, otp)


async def _auto_otp_task(pending_id: str) -> None:
    """Background task: read the OTP from Gmail and finish the login without
    a human typing anything. Never raises — always resolves via _AUTO_STATUS."""
    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        registered_email = rec.get("registered_email") if rec else None

    try:
        from gmail_otp_reader import OtpNeverSent, get_latest_otp
    except Exception as e:
        _set_auto_status(pending_id, "error", message=f"Gmail reader unavailable: {e}")
        return

    try:
        otp = await asyncio.to_thread(
            get_latest_otp,
            sender_filter=GMAIL_OTP_SENDER_FILTER,
            max_age_seconds=GMAIL_OTP_TIMEOUT_SECONDS,
            to_filter=registered_email,
        )
    except OtpNeverSent as e:
        # No mail arrived at all: the portal took the request and sent nothing.
        # Reported separately from a timeout because the advice is the opposite
        # — no code is coming, so "enter it manually" is useless here.
        _set_auto_status(pending_id, "error", message=str(e), reason="otp_not_sent")
        return
    except Exception as e:
        # e.g. Gmail token expired/revoked and no browser available to re-auth
        # (gmail_otp_reader raises RuntimeError for this) — surface it plainly.
        traceback.print_exc()
        _set_auto_status(pending_id, "error", message=str(e) or f"{type(e).__name__} (no message)")
        return

    if not otp:
        _set_auto_status(pending_id, "timeout",
                          message="No OTP email arrived in time — enter it manually.")
        return

    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is None:
            # Cancelled, expired, or already finished manually in the meantime.
            return
        if rec.get("in_progress"):
            # A manual submit is already running the finish step — don't race it.
            return
        rec["in_progress"] = True

    # MUST go through a worker thread. This coroutine runs ON the shared event
    # loop, and _finish_with_otp -> _submit() blocks on fut.result() waiting for
    # a coroutine scheduled on that same loop. Calling it inline blocks the loop
    # thread, so the work it just scheduled can never run: guaranteed deadlock
    # until _submit's timeout fires (as a bare TimeoutError, which stringifies
    # to "" — the mystery blank-message error). to_thread keeps the loop free.
    result = await asyncio.to_thread(_finish_with_otp, pending_id, rec, otp)
    if result.get("error"):
        # `reason` carries "bad_credentials" through to the polling client, which
        # needs it to drop back to the credentials form. Set AFTER _finish_with_otp,
        # since its cancel() on that path clears this pending id's auto status.
        _set_auto_status(pending_id, "error",
                         message=result.get("message", "OTP verification failed."),
                         reason=result["error"])
    else:
        _set_auto_status(pending_id, "completed", session_path=result["session_path"])


def auto_status(pending_id: str, user_key: str = None) -> dict:
    """Poll the result of an in-flight or finished auto-OTP attempt.

    Returns {"status": "pending"|"completed"|"timeout"|"error"|"not_applicable"|"not_found", ...}.
    "not_applicable" means this pending login wasn't eligible for auto-read
    (SMS channel, not Email) — caller should fall back to the manual OTP form
    immediately rather than poll.
    """
    _purge_expired()

    with _AUTO_STATUS_LOCK:
        terminal = _AUTO_STATUS.get(pending_id)
    if terminal is not None:
        return {k: v for k, v in terminal.items() if k != "ts"}

    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is None:
            return {"status": "not_found"}
        if user_key is not None and rec["user_key"] != user_key:
            return {"status": "not_found"}
        if not rec.get("auto_otp"):
            return {"status": "not_applicable"}

    return {"status": "pending"}


def check_status(user_key: str) -> dict:
    """Validate the user's saved session against the portal.

    Returns {"connected": bool}. connected=False means no session file or the
    session has timed out (bounced to login) — the user needs to reconnect.
    """
    session_path = f"sessions/dealer_{_safe_key(user_key)}.json"
    try:
        connected = _submit(
            dealer_web_login.check_session(session_path), timeout=90
        )
        return {"connected": bool(connected)}
    except Exception as e:
        return {"connected": False, "error": str(e)}


def logout(user_key: str) -> dict:
    """Drop the user's saved dealer session so `check_status`/order actions
    treat them as disconnected. No portal round-trip needed — just deletes
    the local session file; the next connect starts a fresh login.

    Always returns {"ok": True}, even if there was nothing to delete.
    """
    session_path = f"sessions/dealer_{_safe_key(user_key)}.json"
    try:
        if os.path.exists(session_path):
            os.remove(session_path)
    except Exception as e:
        return {"ok": True, "note": f"session file cleanup failed (non-fatal): {e}"}
    return {"ok": True}


def cancel(pending_id: str, user_key: str = None) -> dict:
    """Abandon a pending login and close its browser.

    If `user_key` is given, only the owner may cancel their pending login.
    """
    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is not None and user_key is not None and rec["user_key"] != user_key:
            return {"ok": True, "note": "nothing to cancel"}
        rec = _PENDING.pop(pending_id, None)
    with _AUTO_STATUS_LOCK:
        _AUTO_STATUS.pop(pending_id, None)
    if rec is None:
        return {"ok": True, "note": "nothing to cancel"}
    _teardown(rec)
    return {"ok": True}

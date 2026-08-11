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
    request_otp(staff_code, password, channel, user_key) -> dict
    submit_otp(pending_id, otp)                           -> dict
    cancel(pending_id)                                    -> dict

Sessions are saved per user to `sessions/dealer_<user_key>.json`.
"""

import asyncio
import re
import threading
import time
import uuid

import dealer_web_login

# OTPs from the portal expire in minutes; drop a pending login after this.
PENDING_TTL_SECONDS = 540  # 9 minutes

# Hard cap on simultaneously-open login browsers. Each pending login holds a live
# Chromium, so this bounds memory/CPU and stops a caller spinning up many at once.
MAX_CONCURRENT_LOGINS = 4

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


def request_otp(staff_code: str, password: str, channel: str, user_key: str) -> dict:
    """
    Step 1: log in with staff code + password, pick the channel, click GET so the
    portal sends an OTP to the account owner. Keeps the browser open and returns
    a `pending_id` to be passed to `submit_otp()`.

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
            "expires_at": time.time() + PENDING_TTL_SECONDS,
        }
    return {"pending_id": pending_id, "expires_in": PENDING_TTL_SECONDS}


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
        # Guard against concurrent submits on the same single-browser login.
        if rec.get("in_progress"):
            return {"error": "otp_in_progress",
                    "message": "Still verifying the previous code — please wait a moment."}
        rec["in_progress"] = True

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
        # Wrong/expired OTP: KEEP the pending record and its still-open browser so
        # the user can retry with another code (finish_web_login left it open).
        with _PENDING_LOCK:
            if pending_id in _PENDING:
                _PENDING[pending_id]["in_progress"] = False
        return {"error": "otp_verify_failed", "message": str(e)}

    # Success — the browser is already torn down; drop the pending record.
    with _PENDING_LOCK:
        _PENDING.pop(pending_id, None)
    return {"ok": True, "session_path": result["session_path"]}


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


def cancel(pending_id: str, user_key: str = None) -> dict:
    """Abandon a pending login and close its browser.

    If `user_key` is given, only the owner may cancel their pending login.
    """
    with _PENDING_LOCK:
        rec = _PENDING.get(pending_id)
        if rec is not None and user_key is not None and rec["user_key"] != user_key:
            return {"ok": True, "note": "nothing to cancel"}
        rec = _PENDING.pop(pending_id, None)
    if rec is None:
        return {"ok": True, "note": "nothing to cancel"}
    _teardown(rec)
    return {"ok": True}

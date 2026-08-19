"""
dealer_web_login.py - Per-user interactive login for the Unifi eSales dealer
portal (the flow this project actually uses).

Kept SEPARATE from login_manager.py on purpose: login_manager.py is a drop-in
copy of the other project's file (shared for its anti-bot / stealth scripts), so
it must stay untouched — if that project updates its bot detection, the file can
be re-pasted here without clobbering anything. This module only *imports* the
bot-detection primitives from it (`_launch_browser_safe`, `LOGIN_URL`,
`HISTORY_URL`) and layers the two-phase, user-supplied-OTP flow on top.

The USER supplies staff code + password + OTP through the BizzFlow UI. The login
is split across two HTTP requests, driven by dealer_login_service on a persistent
event loop so the browser survives between phases:

    phase 1  start_web_login()  -> fill creds, pick channel (Email/SMS), click GET
    (user reads the OTP on their own device and types it into BizzFlow)
    phase 2  finish_web_login() -> re-fill the form the GET-reload cleared,
                                   submit the OTP, Sign In, save per-user session

The password is NEVER persisted — it lives only in dealer_login_service's
in-memory pending record and is dropped after login or the OTP timeout. It's
threaded into phase 2 solely because the portal reloads (and clears) the form
after the GET click, so staff code + password must be typed again before Sign In.
"""

import asyncio
import contextlib
import json
import os
import time

import login_manager
from shell_modal import clear_shell_dialog, dialog_summary
from login_manager import HISTORY_URL, LOGIN_URL


async def safe_teardown(pw=None, browser=None, context=None) -> None:
    """Close Playwright handles without letting one hung close() block the rest.

    Under memory pressure `browser.close()` / `context.close()` can WEDGE (the
    Chromium process stops responding while it's paged out to swap). A plain
    `await browser.close(); await pw.stop()` then hangs forever on the first
    call, so `pw.stop()` never runs and the headless_shell processes leak. We
    bound every step with its own timeout and always reach `pw.stop()`, which
    stops the Playwright driver and reaps its Chromium children even if the
    graceful close was skipped.
    """
    for closer in (
        getattr(context, "close", None),
        getattr(browser, "close", None),
        getattr(pw, "stop", None),
    ):
        if closer is None:
            continue
        try:
            await asyncio.wait_for(closer(), timeout=10)
        except Exception:
            pass

_TC_SELECTORS = [
    '.policy___1uV3w input[type="checkbox"]',
    'div[class*="policy"] input[type="checkbox"]',
    'input[type="checkbox"]:not(#login-form_rememerMe)',
]

# The portal sometimes localises the OTP channel option labels — e.g. the Email
# option renders as the Chinese "邮箱" even while the rest of the page is English.
# Match against every known label, not just the English one.
_CHANNEL_LABELS = {
    "Email": ["Email", "邮箱", "電郵", "電子郵件", "E-mail"],
    "SMS": ["SMS", "短信", "簡訊", "简讯"],
}


def _normalize_channel(channel: str) -> str:
    """Map free-form 'email'/'sms' to the portal's option labels ('Email'/'SMS')."""
    c = (channel or "Email").strip().lower()
    return "SMS" if c == "sms" else "Email"


def _shot_path(name: str) -> str:
    """Timestamped debug-screenshot path so concurrent logins from different
    users don't overwrite each other's captures."""
    os.makedirs("logs", exist_ok=True)
    return f"logs/{name}_{int(time.time() * 1000)}.png"


# The portal (Ant Design) surfaces a failed Sign In through several different
# containers depending on whether it's a field-level validation error, a toast,
# or a banner — so check all of them rather than assuming one shape.
_LOGIN_ERROR_SELECTORS = (
    ".ant-message-error",
    ".ant-message-notice-content",
    ".ant-form-item-explain-error",
    ".ant-alert-error",
    ".ant-notification-notice-message",
    ".ant-notification-notice-description",
)


async def _read_login_error(page) -> str:
    """Return whatever error text the portal is currently showing, or ''.

    Used instead of guessing the failure reason: a wrong PASSWORD and a wrong
    OTP both just bounce back to /login, so without reading the portal's own
    message we can't tell the user which one was actually wrong.
    """
    seen = []
    for sel in _LOGIN_ERROR_SELECTORS:
        try:
            loc = page.locator(sel)
            for i in range(await loc.count()):
                node = loc.nth(i)
                if not await node.is_visible():
                    continue
                text = " ".join((await node.inner_text()).split()).strip()
                if text and text not in seen:
                    seen.append(text)
        except Exception:
            continue
    return " | ".join(seen)


# --------------------------------------------------------------------------
# Portal API capture
#
# `_read_login_error` above scrapes the DOM, and the evidence says it never
# fires: across every run to date logs/ holds only `login_redirect_*.png` and
# not one `login_error_*.png`. Ant toasts auto-dismiss after a few seconds and
# the page reloads after both GET and Sign In, so the error text is gone before
# we read it — and a wrong password and a wrong OTP then look identical (both
# just reset the form to a blank /login).
#
# So read the portal's own API response instead: it's captured the moment it
# arrives, which no toast timing or navigation can take away. Log-only for now
# — we don't yet know the endpoints or the JSON shape, and guessing wrong at
# the GET step would break logins that would otherwise succeed.
# --------------------------------------------------------------------------

# Substring hints, deliberately loose: the real paths are unknown until this
# runs against the live portal. Over-capturing is harmless while log-only.
_AUTH_URL_HINTS = ("login", "signin", "otp", "sms", "auth", "verify", "captcha")

_STATIC_SUFFIXES = (".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".gif",
                    ".ico", ".woff", ".woff2", ".ttf", ".map")

# Blank these before anything is printed. NOT "code" — the portal's status code
# field is very likely named that, and it's the signal this whole feature needs.
_REDACT_KEYS = ("password", "passwd", "pwd", "smscode", "otp", "token",
                "accesstoken", "refreshtoken", "authorization")


def _looks_like_auth_api(url: str) -> bool:
    path = url.lower().split("?")[0]
    if path.endswith(_STATIC_SUFFIXES):
        return False
    return any(hint in path for hint in _AUTH_URL_HINTS)


def _redact(value):
    """Recursively blank credential-ish values. A response shouldn't echo the
    password back — but "shouldn't" isn't a guarantee worth logging on."""
    if isinstance(value, dict):
        return {
            k: ("***" if k.lower().replace("_", "") in _REDACT_KEYS else _redact(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


class _AuthCapture:
    """Collects login/OTP API responses seen while it's attached to a page."""

    def __init__(self):
        self.records = []      # [{"url", "status", "body"}]
        self._reads = []

    def on_response(self, response):
        # Playwright calls this synchronously; the body has to be awaited, so
        # hand it off to a task and drain them all before reporting.
        if _looks_like_auth_api(response.url):
            self._reads.append(asyncio.ensure_future(self._read(response)))

    async def _read(self, response):
        record = {"url": response.url, "status": response.status, "body": None}
        try:
            ctype = (response.headers or {}).get("content-type", "").lower()
            if "json" in ctype:
                record["body"] = _redact(await response.json())
            else:
                record["body"] = " ".join((await response.text()).split())[:400]
        except Exception as e:
            # A response whose body was discarded on navigation still tells us
            # the endpoint and status, so keep the record either way.
            record["body"] = f"<unreadable: {type(e).__name__}>"
        self.records.append(record)

    async def drain(self):
        if self._reads:
            await asyncio.gather(*self._reads, return_exceptions=True)
            self._reads = []


@contextlib.asynccontextmanager
async def _capture_auth_api(page, phase: str):
    """Attach a response listener for `phase`, then print what it caught."""
    cap = _AuthCapture()
    page.on("response", cap.on_response)
    try:
        yield cap
    finally:
        try:
            page.remove_listener("response", cap.on_response)
        except Exception:
            pass
        try:
            await cap.drain()
        except Exception as e:
            print(f"  🌐 [{phase}] capture drain failed: {e}")
        if cap.records:
            for rec in cap.records:
                print(f"  🌐 [{phase}] {rec['status']} {rec['url']}")
                print(f"     └─ {rec['body']}")
        else:
            print(f"  🌐 [{phase}] no auth-looking API response captured")


class CredentialsError(RuntimeError):
    """The portal rejected the staff code / password (not the OTP).

    Typed rather than string-matched by the caller: a wrong password can't be
    fixed by retrying the OTP, so dealer_login_service has to abandon the
    pending login and send the user back to the credentials form. That's a
    different outcome from a wrong OTP, where the browser stays open for a
    retry — so the distinction has to survive the trip up the stack.
    """


_CREDENTIAL_KEYWORDS = ("password", "credential", "staff code", "staffcode",
                        "username", "user name", "account", "账号", "密码")
_OTP_KEYWORDS = ("otp", "verification code", "sms code", "captcha", "验证码")


def _is_credentials_message(message: str) -> bool:
    """True when the portal's wording points at the staff code / password.

    OTP wording wins on a tie: a message naming both is far more likely to be
    "invalid otp for this account" than a password complaint, and misrouting a
    wrong-OTP user back to the credentials form (wiping their password) is the
    more annoying mistake of the two.
    """
    low = (message or "").lower()
    if any(k in low for k in _OTP_KEYWORDS):
        return False
    return any(k in low for k in _CREDENTIAL_KEYWORDS)


def _first_api_failure(records) -> dict:
    """Return the first captured response that is definitely a failure, or {}.

    Observed live (a rate-limited OTP request):

        417 https://dealer.unifi.com.my/portal/api/prod/genCaptcha
        {"code": "46410045",
         "message": "Access to otp code is too frequent, please try again later.",
         "type": 0, "stack": ""}

    Two signals, in order of confidence:

      1. Non-2xx. Unambiguous, and the only one that matters for the decision
         we make on it: if the OTP endpoint failed, no OTP was sent, so there
         is nothing to wait for regardless of *why* it failed.
      2. A 2xx carrying that same exception envelope (`message` + `stack`).
         Heuristic — kept narrow because a success payload with a `stack` key
         would be very strange — in case the portal reports a bad password as
         200-with-error-code. Remove it if it ever fires on a good login.

    We deliberately do NOT test `code` for a "success" value: the success shape
    is still unknown, and guessing it is exactly the false positive that would
    break working logins.
    """
    for rec in records:
        body = rec.get("body")
        message = body.get("message") if isinstance(body, dict) else None
        if rec.get("status", 0) >= 400:
            return {**rec, "message": message or f"HTTP {rec['status']}"}
        if isinstance(body, dict) and message and "stack" in body:
            return {**rec, "message": message}
    return {}


def _describe_otp_request_failure(message: str) -> str:
    """Lead with the portal's own wording — it's the most accurate thing we
    have — then name the credential to fix."""
    low = message.lower()
    if any(k in low for k in ("password", "credential", "staff code", "staffcode",
                              "username", "账号", "密码")):
        return f"{message} Check your staff code and password."
    if any(k in low for k in ("too frequent", "too many", "try again later",
                              "rate limit")):
        return (f"{message} The portal is limiting OTP requests — "
                "wait a few minutes before trying again.")
    return message


def _describe_login_failure(portal_error: str) -> str:
    """Report the portal's own wording, plus which credential it points at."""
    low = portal_error.lower()
    if any(k in low for k in ("password", "credential", "staff code", "staffcode",
                              "username", "账号", "密码")):
        hint = " Check your staff code and password."
    elif any(k in low for k in ("otp", "verification code", "sms code", "验证码")):
        hint = " Check the OTP — it may be wrong or expired."
    else:
        hint = ""
    return f"Portal said: {portal_error}.{hint}"


async def _save_session(context, session_path: str) -> None:
    """Persist the portal cookies to a per-user path (own copy — login_manager's
    save_session is hardcoded to the shared session file)."""
    os.makedirs(os.path.dirname(session_path), exist_ok=True)
    cookies = await context.cookies()
    payload = {"cookies": cookies, "last_login": time.time()}
    with open(session_path, "w") as f:
        json.dump(payload, f)
    print(f"Session cookies saved -> {session_path}")


async def _fill_login_form(page, staff_code: str, password: str, channel: str) -> None:
    """Fill staff code + password, pick the OTP channel, tick Remember Me + T&C.

    Idempotent: only fills the staff code if empty and only (re)selects the
    channel / (re)checks boxes if needed, so it works for both the first fill and
    the re-fill after the portal reloads the form on the GET click.
    """
    if not await page.input_value("#login-form_staffCode"):
        await page.fill("#login-form_staffCode", staff_code)
    await page.fill("#login-form_password", password)

    # OTP channel — match any known label so a localised option (e.g. "邮箱" for
    # Email) still gets selected.
    labels = _CHANNEL_LABELS.get(channel, [channel])
    try:
        dropdown = page.locator("#login-form_channel")
        if await dropdown.count() == 0:
            dropdown = page.locator(".ant-select-selection-item").last
        current = (await dropdown.inner_text()).strip()
        if not any(lbl in current for lbl in labels):
            await dropdown.click(force=True, timeout=5000)
            await page.wait_for_timeout(800)
            selected = False
            for lbl in labels:
                opt = page.locator(
                    f".ant-select-item-option-content:has-text('{lbl}')"
                ).first
                if await opt.count() > 0:
                    await opt.click(force=True, timeout=5000)
                    selected = True
                    print(f"  ✅ Selected OTP channel: {lbl}")
                    break
            if not selected:
                print(f"  ⚠️ No OTP channel option matched any of {labels}")
            await page.wait_for_timeout(500)
    except Exception as e:
        print(f"  ⚠️ channel select: {e}")

    # Remember Me
    try:
        rm = page.locator("input#login-form_rememerMe")
        if not await rm.is_checked():
            await rm.check(force=True, timeout=3000)
    except Exception:
        pass

    # Terms & Conditions
    for sel in _TC_SELECTORS:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                if not await loc.is_checked():
                    await loc.check(force=True, timeout=3000)
                break
        except Exception:
            continue


async def open_and_request_otp(
    page, staff_code: str, password: str, channel: str = "Email"
) -> None:
    """Phase 1: open login, fill creds, pick channel, click GET. Sends the OTP to
    the account owner's device. Does not read/fill the OTP."""
    channel = _normalize_channel(channel)
    print("Opening login page...")
    await page.goto(LOGIN_URL, timeout=45000, wait_until="domcontentloaded")
    if "no-devtool" in page.url.lower():
        raise RuntimeError("❌ Redirected to no-devtool on login load.")

    await page.wait_for_selector("#login-form_staffCode", state="visible", timeout=30000)
    try:
        await page.wait_for_selector("#login-form_smsCode", state="visible", timeout=15000)
    except Exception:
        await page.wait_for_timeout(5000)
    await page.wait_for_timeout(1500)

    await _fill_login_form(page, staff_code, password, channel)

    print("Requesting OTP...")
    async with _capture_auth_api(page, "GET") as otp_api:
        try:
            await page.click("text=GET", timeout=5000)
            print("✅ Clicked GET button")
        except Exception as e:
            print(f"⚠️ Warning clicking GET: {e}")

        await page.wait_for_timeout(2000)

    get_error = await _read_login_error(page)
    if get_error:
        print(f"  ⚠️ Portal message after GET: {get_error}")
    await page.screenshot(path=_shot_path("after_get_click"))

    # The portal DOES validate here, so stop rather than report "OTP sent" and
    # leave the user watching a countdown for a mail that was never sent (which
    # is what a rate-limited request did before this check existed).
    #
    # Raise only on the API signal. A visible DOM error alone is not enough:
    # `.ant-form-item-explain-error` covers ordinary field validation too, and
    # aborting a login on one of those is the false positive we can least
    # afford. The API message wins; the DOM text is only a fallback wording.
    failure = _first_api_failure(otp_api.records)
    if failure:
        await page.screenshot(path=_shot_path("otp_request_failed"))
        raise RuntimeError(
            _describe_otp_request_failure(failure.get("message") or get_error
                                          or "The portal rejected the OTP request.")
        )


async def submit_otp_and_finalize(
    page, context, staff_code: str, password: str, channel: str, otp: str,
    session_path: str,
) -> None:
    """Phase 2: re-fill the form (the GET-reload cleared it), submit the OTP,
    Sign In, and persist the per-user session. Raises on a bad/expired OTP."""
    channel = _normalize_channel(channel)
    print("Submitting OTP...")

    # The page reloaded after GET during phase 1 — wait for it and re-fill.
    try:
        await page.wait_for_selector("#login-form_staffCode", state="visible", timeout=15000)
    except Exception:
        print("  ⚠️ Login form not visible on OTP submit")
    try:
        await page.wait_for_selector("#login-form_smsCode", state="visible", timeout=15000)
    except Exception:
        await page.wait_for_timeout(3000)

    await _fill_login_form(page, staff_code, password, channel)

    try:
        otp_field = page.locator("input#login-form_smsCode")
        await otp_field.wait_for(state="visible", timeout=15000)
        await otp_field.fill(otp, force=True)
        print("✅ Filled OTP")
    except Exception as e:
        await page.screenshot(path=_shot_path("otp_fill_failed"))
        raise RuntimeError(f"Could not fill OTP field. Error: {e}")

    await page.screenshot(path=_shot_path("before_sign_in"))
    print("Clicking Sign In...")
    async with _capture_auth_api(page, "SIGN_IN") as sign_in_api:
        try:
            await page.click('button:has-text("Sign In")', force=True, timeout=5000)
        except Exception:
            await page.locator('button[type="submit"]').click(force=True)

        # Poll for the portal's own error while we wait, instead of one long
        # sleep. Ant toasts auto-dismiss after a few seconds, and the History
        # navigation below wipes the page — either would lose the message and
        # force us back to guessing "OTP wrong" even when the real problem was
        # the password. (The API capture above is the reliable one; this DOM
        # read stays as a second chance until the capture is proven.)
        portal_error = ""
        for _ in range(16):  # ~8s, same total budget as the previous fixed wait
            await page.wait_for_timeout(500)
            portal_error = await _read_login_error(page)
            if portal_error:
                print(f"  ⚠️ Portal error after Sign In: {portal_error}")
                break

    await page.screenshot(path=_shot_path("after_sign_in"))
    print(f"  📍 URL after sign in: {page.url}")

    # Prefer the API's message over the scraped one: it can't be lost to a
    # dismissed toast, and it's the portal's verbatim reason.
    api_failure = _first_api_failure(sign_in_api.records)
    failure_message = api_failure.get("message") or portal_error
    if failure_message:
        await page.screenshot(path=_shot_path("login_error"))
        described = _describe_login_failure(failure_message)
        if _is_credentials_message(failure_message):
            raise CredentialsError(described)
        raise RuntimeError(described)

    if "login" in page.url.lower():
        # Some flows land back on /login briefly; a nav to History confirms auth.
        await page.goto(HISTORY_URL, wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(3000)

    if "login" in page.url.lower():
        await page.screenshot(path=_shot_path("login_redirect"))
        raise RuntimeError(
            "Bounced back to login after Sign In, and the portal gave no "
            "specific reason — either the password or the OTP is wrong/expired."
        )

    # Same shell dialog the order flow trips over — cleared here so the session
    # is saved from a page that is actually usable. Non-fatal: a dialog we can't
    # dismiss doesn't invalidate the login, and the order flow checks again.
    cleared = await clear_shell_dialog(page, appear_ms=6000)
    if cleared["outcome"] != "none":
        print(f"  ↳ shell dialog at login: {cleared['outcome']} ({dialog_summary(cleared)})")

    await page.wait_for_load_state("networkidle", timeout=30000)
    await page.wait_for_timeout(2000)
    await _save_session(context, session_path)


async def check_session(session_path: str) -> bool:
    """Return True if the saved per-user session still authenticates.

    Loads the stored cookies into a fresh (stealth-patched) context and hits a
    portal page: if we get bounced to /login (or no-devtool), the session has
    timed out and the user must reconnect.
    """
    if not os.path.exists(session_path):
        return False
    try:
        with open(session_path) as f:
            cookies = json.load(f).get("cookies", [])
    except Exception:
        return False
    if not cookies:
        return False

    pw, browser, context, page = await login_manager._launch_browser_safe()
    try:
        await context.add_cookies(cookies)
        await page.goto(HISTORY_URL, timeout=30000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        url = page.url.lower()
        # Still authenticated only if we stayed on an app page (not the login form).
        if "login" in url or "no-devtool" in url:
            return False
        if await page.locator("input#login-form_staffCode").count() > 0:
            return False
        return True
    except Exception as e:
        print(f"  ⚠️ session check failed: {e}")
        return False
    finally:
        await safe_teardown(pw, browser, context)


async def open_context_from_session(session_path: str, landing_url: str = HISTORY_URL):
    """Launch a stealth browser, load a user's saved portal cookies, and return
    LIVE handles (pw, browser, context, page) positioned on the portal.

    `landing_url` is where we navigate to validate the session; the order flow
    passes the Order Entry URL so we land straight there instead of bouncing
    through Retail History first.

    Used by the order-entry flow so each order runs under the dealer account that
    user connected — never a shared credential. Raises if the session is missing
    or has expired (bounced to /login), so the caller can prompt a reconnect. On
    any failure the browser is torn down before raising.
    """
    if not os.path.exists(session_path):
        raise RuntimeError(f"No saved dealer session ({session_path}) — reconnect required.")
    try:
        with open(session_path) as f:
            cookies = json.load(f).get("cookies", [])
    except Exception as e:
        raise RuntimeError(f"Couldn't read dealer session: {e}")
    if not cookies:
        raise RuntimeError("Saved dealer session has no cookies — reconnect required.")

    pw, browser, context, page = await login_manager._launch_browser_safe()
    try:
        await context.add_cookies(cookies)
        await page.goto(landing_url, timeout=30000, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        url = page.url.lower()
        if (
            "login" in url
            or "no-devtool" in url
            or await page.locator("input#login-form_staffCode").count() > 0
        ):
            raise RuntimeError("Dealer session expired — reconnect required.")
    except Exception:
        await safe_teardown(pw, browser, context)
        raise
    return pw, browser, context, page


async def start_web_login(staff_code: str, password: str, channel: str = "Email"):
    """Phase 1 entry point. Returns LIVE handles the caller must keep alive and
    later pass to finish_web_login()."""
    # Runtime lookup (not a bound import) so a headed monkeypatch on
    # login_manager._launch_browser_safe takes effect for tests.
    pw, browser, context, page = await login_manager._launch_browser_safe()
    try:
        await open_and_request_otp(page, staff_code, password, channel)
    except Exception:
        # safe_teardown, not a bare close(): this path is now hit on every
        # rejected OTP request (bad password, rate limit), and a wedged
        # browser.close() would hang the caller until its 180s timeout.
        await safe_teardown(pw, browser, context)
        raise
    return pw, browser, context, page


async def finish_web_login(
    pw, browser, context, page, staff_code: str, password: str, channel: str,
    otp: str, session_path: str,
):
    """Phase 2 entry point. Submits the OTP on the still-open browser and saves the
    session. On SUCCESS the browser is torn down. On a wrong/expired OTP the browser
    is left OPEN so the caller can retry the OTP on the same portal page, and the
    error is re-raised. (A left-open browser is reaped when the pending login expires
    or is cancelled.)"""
    try:
        await submit_otp_and_finalize(
            page, context, staff_code, password, channel, otp, session_path
        )
    except Exception:
        # OTP wrong/expired — keep the browser alive for a retry; do NOT tear down.
        raise
    # Success: session persisted, browser no longer needed.
    try:
        await browser.close()
    finally:
        await pw.stop()
    return {"ok": True, "session_path": session_path}

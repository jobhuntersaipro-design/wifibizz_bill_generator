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
import json
import os
import time

import login_manager
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
    try:
        await page.click("text=GET", timeout=5000)
        print("✅ Clicked GET button")
    except Exception as e:
        print(f"⚠️ Warning clicking GET: {e}")

    await page.wait_for_timeout(2000)
    await page.screenshot(path=_shot_path("after_get_click"))


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
    try:
        await page.click('button:has-text("Sign In")', force=True, timeout=5000)
    except Exception:
        await page.locator('button[type="submit"]').click(force=True)

    await page.wait_for_timeout(8000)
    await page.screenshot(path=_shot_path("after_sign_in"))
    print(f"  📍 URL after sign in: {page.url}")

    if "login" in page.url.lower():
        # Some flows land back on /login briefly; a nav to History confirms auth.
        await page.goto(HISTORY_URL, wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(3000)

    if "login" in page.url.lower():
        await page.screenshot(path=_shot_path("login_redirect"))
        raise RuntimeError(
            "Bounced back to login after Sign In — OTP likely wrong or expired."
        )

    try:
        later_btn = page.locator('button.ant-btn:has-text("Later")')
        if await later_btn.is_visible(timeout=3000):
            await later_btn.click()
            await page.wait_for_timeout(1000)
    except Exception:
        pass

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
        await browser.close()
        await pw.stop()
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

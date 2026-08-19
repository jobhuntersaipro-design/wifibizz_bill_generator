"""
test_dealer_login.py - Standalone test for the per-user dealer web login.

Runs the full two-phase flow in ONE process (no Flask, no Next.js): logs in,
requests the OTP, waits for you to type the code you receive, then submits it and
saves the session. This isolates dealer_web_login so you can confirm the portal
login + OTP + reload re-fill work before testing through the whole stack.

Reads DEALER_STAFF_CODE / DEALER_PASSWORD from the project root .env
(or pass --staff / --password). Run from the scraper/ directory:

    python3 test_dealer_login.py                 # headless, Email OTP
    python3 test_dealer_login.py --headed        # watch the browser
    python3 test_dealer_login.py --channel SMS   # OTP via SMS
"""

import argparse
import asyncio
import os

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())

import dealer_web_login
import login_manager

SESSION_PATH = "sessions/dealer_test.json"


async def _wait_for_otp_file(otp_file: str, timeout: int = 240) -> str:
    """Poll a file for the OTP (so the run can be driven without a keyboard).
    asyncio.sleep keeps the loop pumping, so the browser stays alive."""
    if os.path.exists(otp_file):
        os.remove(otp_file)  # ignore any stale code
    print(f"Waiting for OTP — write the code into {otp_file} ...")
    for _ in range(timeout // 2):
        try:
            with open(otp_file) as f:
                val = f.read().strip()
            if val:
                return val
        except FileNotFoundError:
            pass
        await asyncio.sleep(2)
    raise SystemExit("Timed out waiting for the OTP file.")


async def main(staff, password, channel, headed, slow_mo, otp_file):
    if headed:
        # Same headed monkeypatch used by oe_dry_run.py — flips headless off.
        from devtools.oe_dry_run import _make_headed_launch

        login_manager._launch_browser_safe = _make_headed_launch(slow_mo)

    print(f"\n── Phase 1 ─ logging in as {staff}, requesting OTP via {channel} ──")
    pw, browser, context, page = await dealer_web_login.start_web_login(
        staff, password, channel
    )
    print(
        "\n✅ OTP requested.\n"
        "   • Check logs/after_get_click.png (should show the resend countdown)\n"
        f"   • Check your {channel} for the code.\n"
    )

    if otp_file:
        otp = await _wait_for_otp_file(otp_file)
    else:
        # Read the OTP off-thread so we don't block the event loop / browser keepalive.
        otp = (await asyncio.to_thread(input, "Enter the OTP you received: ")).strip()

    print("\n── Phase 2 ─ submitting OTP, signing in, saving session ──")
    try:
        result = await dealer_web_login.finish_web_login(
            pw, browser, context, page, staff, password, channel, otp, SESSION_PATH
        )
        print(f"\n✅ Connected. Session saved -> {result['session_path']}")
    except Exception as e:
        print(f"\n❌ Login failed: {e}")
        print("   See logs/before_sign_in.png / after_sign_in.png / login_redirect.png")
        raise SystemExit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--staff", default=os.getenv("DEALER_STAFF_CODE"))
    ap.add_argument("--password", default=os.getenv("DEALER_PASSWORD"))
    ap.add_argument("--channel", default="Email", choices=["Email", "SMS"])
    ap.add_argument("--headed", action="store_true", help="Show the browser window.")
    ap.add_argument("--slow-mo", type=int, default=150)
    ap.add_argument(
        "--otp-file",
        default=None,
        help="Poll this file for the OTP instead of prompting on the keyboard.",
    )
    args = ap.parse_args()

    if not args.staff or not args.password:
        raise SystemExit(
            "Set DEALER_STAFF_CODE and DEALER_PASSWORD in .env (or pass --staff/--password)."
        )

    asyncio.run(
        main(
            args.staff, args.password, args.channel,
            args.headed, args.slow_mo, args.otp_file,
        )
    )

"""DEV: one-shot dealer login with the shared-inbox Gmail auto-OTP.
Saves the session for the given user key. Usage:
    venv/bin/python -m devtools.auto_dealer_login sessions/dealer_<key>.json
"""
import asyncio, os, sys, time
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login

async def main(session_path):
    staff = os.environ["DEALER_STAFF_CODE"]
    password = os.environ["DEALER_PASSWORD"]
    registered = os.environ.get("DEALER_REGISTERED_EMAIL")
    pw, browser, context, page = await dealer_web_login.start_web_login(staff, password, "Email")
    print("OTP requested; reading Gmail...")
    from gmail_otp_reader import get_latest_otp
    otp = await asyncio.to_thread(
        get_latest_otp,
        sender_filter=os.environ.get("GMAIL_OTP_SENDER_FILTER", "@unifi.com.my"),
        to_filter=registered,
        max_age_seconds=240,
    )
    print(f"OTP read ({otp[:2]}****); signing in...")
    result = await dealer_web_login.finish_web_login(
        pw, browser, context, page, staff, password, "Email", otp, session_path)
    print("connected; session ->", result["session_path"])

asyncio.run(main(sys.argv[1]))

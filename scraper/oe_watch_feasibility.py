"""Headed WATCH run: drives feasibility slowly so you can see each step on
screen, clicks Order to reveal the customer-first 'Customer' dialog, then HOLDS
the window open (no order created — stops at the dialog). python oe_watch_feasibility.py <session.json>
"""
import asyncio
import os
import sys

import dealer_web_login
import login_manager
from inspect_order_entry import _headed_launch_safe
from oe_feasibility import open_feasibility, select_address, select_plan
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry

# login_manager launches headless=True. Flip it to the verified HEADED launch
# (headless=False + slow-mo) so a real Chromium window opens on screen to watch.
login_manager._launch_browser_safe = _headed_launch_safe

HOLD = int(os.environ.get("HOLD_SECONDS", "120"))


async def pause(page, label, secs=3):
    print(f"  … {label}")
    await page.wait_for_timeout(secs * 1000)


async def main(session_path):
    addr = {
        "state": os.environ.get("FEAS_STATE", "SELANGOR").upper(),
        "customer_type": "Consumer",
        "address_id": os.environ.get("FEAS_ADDRESS_ID") or None,
        "address_full": os.environ.get("FEAS_ADDRESS_FULL", ""),
        "keywords": os.environ.get("FEAS_ADDRESS_FULL", ""),
    }
    plan = {"name": os.environ.get("FEAS_OFFER", "")}
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await pause(page, "on Order Entry — opening Feasibility Check", 2)
        await open_feasibility(frame)
        await pause(page, "Feasibility Check open — selecting the address", 3)
        print("   ", await select_address(frame, addr))
        await pause(page, "address selected — plans should be listed; selecting the plan", 4)
        print("   ", await select_plan(frame, plan))
        await pause(page, "plan selected — about to click Order", 4)
        print("→ clicking Order (opens the customer-first 'Customer' dialog; no order created)…")
        await frame.locator(".js-orderNow").first.click()
        await pause(page, "Order clicked — the 'Customer' dialog should be showing", 3)
        print(f"\n🖥  Holding the window open for {HOLD}s so you can look. Ctrl-C to close early.")
        await page.wait_for_timeout(HOLD * 1000)
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess))

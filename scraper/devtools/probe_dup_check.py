"""DEV probe (read-only): open the Stage-1 Personal Customer creator, enter
ORD-0010's REAL IC + name, and report what the portal's duplicate check says.
Closes the dialog without saving — nothing is created."""
import asyncio, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import (ORDER_ENTRY_URL, _frame, ensure_on_order_entry,
                         choose_personal_customer, personal_customer_dialog,
                         _check_duplicate_records)
from oe_helpers import set_combobox
from oe_feasibility import _capture_dialog_message

async def main(session_path):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await frame.locator(".js-order-search").first.click()
        await frame.locator(".js-add-cust-btn").first.click()
        await choose_personal_customer(frame)
        dlg = personal_customer_dialog(frame)
        await dlg.wait_for(state="visible", timeout=15000)
        await set_combobox(frame, "certTypeId", "MyKad", scope=dlg)
        await dlg.locator('input[name="certNbr"]').first.fill("820505034434")
        await dlg.locator('input[name="custName"]').first.fill("HONG TUNG TUNG")
        dup = await _check_duplicate_records(frame)
        print("DUP CHECK:", repr(dup))
        print("TOP DIALOG:", repr((await _capture_dialog_message(page) or "")[:200]))
        await page.screenshot(path="logs/probe_dup_check.png")
        print("screenshot: logs/probe_dup_check.png — closing without saving")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

"""DEV probe: live-verify the NEW duplicate-IC picker attach path using the
production functions, stopping at the PII dialog (Cancel, never Proceed)."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import (ORDER_ENTRY_URL, _frame, ensure_on_order_entry,
                         choose_personal_customer, fill_and_submit_personal_customer)
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _open_advanced_query,
                            _dismiss_customer_not_exist_dialog, _close_advanced_query,
                            _select_existing_customer_from_dup)
from order_to_payload import order_to_payload
from devtools.probe_fallback_fill import ORD0010

async def main(session_path):
    payload = order_to_payload(ORD0010)
    cust = payload["customer"]
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        for attempt in range(4):
            await open_feasibility(frame); await asyncio.sleep(2)
            r = await select_address(frame, payload["address"])
            print(f"ADDRESS try {attempt+1}:", r.get("status"))
            if r.get("status") == "ok":
                break
            await asyncio.sleep(10)
            await ensure_on_order_entry(page)
            frame = _frame(page)
        print("PLAN:", (await select_plan(frame, payload["plan"], page=page)).get("status"))
        await asyncio.sleep(2)
        if not await customer_dialog_open(frame):
            await frame.locator(".js-orderNow").first.click(timeout=15000); await asyncio.sleep(4)
        await _open_advanced_query(frame, "MyKad")
        await frame.locator('input[name="certNbr"]:visible').first.fill(cust["id_number"])
        await frame.locator('input[name="custName"]:visible').first.fill(cust["name"])
        await frame.locator("button.js-query:visible").first.click(); await asyncio.sleep(5)
        print("not_exist:", await _dismiss_customer_not_exist_dialog(frame))
        await _close_advanced_query(frame)
        add = frame.locator(
            ".ui-dialog:visible .js-add-cust-btn:visible, .js-add-cust-btn:visible, "
            '.ui-dialog:visible [class*="add-cust"]:visible').first
        await add.click(timeout=8000, force=True)
        await choose_personal_customer(frame)

        # PRODUCTION fill — expected to stop at the duplicate-records Confirm.
        r = await fill_and_submit_personal_customer(frame, cust)
        print("FILL:", json.dumps({k: r.get(k) for k in ("status", "error", "warning")}))
        assert r.get("error") == "multiple_customer_records", "expected dup Confirm"

        # PRODUCTION picker — must land on the PII dialog.
        picked = await _select_existing_customer_from_dup(frame, cust)
        print("PICKER:", json.dumps(picked))
        pii = frame.locator(".ui-dialog:visible, .modal.in:visible").filter(
            has_text="Registered Customer Full Name").last
        print("PII visible:", await pii.count() > 0)
        await page.screenshot(path="logs/probe_picker_pii.png")
        # STOP: cancel the PII dialog — Proceed is the one step left to prod.
        await pii.locator('button:has-text("Cancel")').first.click(timeout=8000)
        print("screenshot: logs/probe_picker_pii.png — PII cancelled, nothing attached")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

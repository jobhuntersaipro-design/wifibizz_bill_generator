"""DEV probe (read-only): does Advanced Query find the record when searched with
the IC + the CRM's REGISTERED name (HONG LIONG TONG) instead of the draft's?
STOPS before the row dblclick — nothing attached, no order, no charge."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _open_advanced_query,
                            _dismiss_customer_not_exist_dialog)
from order_to_payload import order_to_payload
from devtools.probe_fallback_fill import ORD0010

REGISTERED = "HONG LIONG TONG"

async def search(frame, ic, name):
    await frame.locator('input[name="certNbr"]:visible').first.fill(ic, timeout=8000)
    await frame.locator('input[name="custName"]:visible').first.fill(name, timeout=8000)
    await frame.locator("button.js-query:visible").first.click(timeout=8000)
    await asyncio.sleep(6)
    not_exist = await _dismiss_customer_not_exist_dialog(frame)
    rows = frame.locator(".js-customer-result-grid tr.jqgrow")
    n = await rows.count()
    texts = [(await rows.nth(i).inner_text()).strip()[:150] for i in range(min(n, 4))]
    return {"rows": n, "not_exist": not_exist, "texts": texts}

async def main(session_path):
    payload = order_to_payload(ORD0010)
    ic = payload["customer"]["id_number"]
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        for attempt in range(4):
            await open_feasibility(frame); await asyncio.sleep(2)
            r = await select_address(frame, payload["address"])
            print(f"ADDRESS try {attempt+1}:", r.get("status"), flush=True)
            if r.get("status") == "ok":
                break
            await asyncio.sleep(10)
            await ensure_on_order_entry(page); frame = _frame(page)
        print("PLAN:", (await select_plan(frame, payload["plan"], page=page)).get("status"), flush=True)
        await asyncio.sleep(2)
        if not await customer_dialog_open(frame):
            await frame.locator(".js-orderNow").first.click(timeout=15000); await asyncio.sleep(4)
        await _open_advanced_query(frame, "MyKad")
        print("\n== IC + REGISTERED name ==")
        print(json.dumps(await search(frame, ic, REGISTERED), indent=1))
        await page.screenshot(path="logs/probe_aq_registered.png")
        print("screenshot: logs/probe_aq_registered.png — STOPPED, nothing selected")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

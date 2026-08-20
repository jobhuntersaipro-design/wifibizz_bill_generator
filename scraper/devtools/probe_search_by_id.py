"""DEV probe (read-only): switch the Customer dialog's search type to
"ID Number", search by the IC alone, and report the rows. This is the route
that can find a record whose registered NAME differs from the draft — which
Advanced Query (IC AND name, 3-criteria minimum) structurally cannot.
STOPS before selecting: no PII, no order, no charge."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _capture_dialog_message)
from order_to_payload import order_to_payload
from devtools.probe_fallback_fill import ORD0010

ROWS_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const vis=e=>e&&e.offsetParent!==null;
  const dl=[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis).pop();
  if(!dl) return {err:'no dialog'};
  return {title: ((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim(),
    rowCount: dl.querySelectorAll('tr.jqgrow').length,
    rows: [...dl.querySelectorAll('tr.jqgrow')].map(r=>(r.innerText||'').replace(/\s+/g,' ').slice(0,200)).slice(0,8),
    boxDisabled: (()=>{const i=dl.querySelector('.js-search-cust-top-t-param'); return i?i.disabled:null})(),
    boxValue: (()=>{const i=dl.querySelector('.js-search-cust-top-t-param'); return i?i.value:null})()};
})()"""

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

        # 1. search type -> "ID Number"
        trig = frame.locator('.js-cust-search-type [role="combobox"]:visible, '
                             '.js-cust-search-type .combobox-readonly:visible').first
        await trig.click(timeout=8000, force=True)
        await asyncio.sleep(1.5)
        await frame.locator('ul.combobox-dropdown:visible li[title="ID Number"]').first.click(timeout=8000)
        await asyncio.sleep(1.5)
        box = frame.locator('.js-search-cust-top-t-param:visible').first
        print("after mode switch — disabled:", await box.is_disabled())

        # 2. type the IC and search
        await box.fill(ic, timeout=15000)
        await frame.locator('.js-search-cust:visible').first.click(timeout=8000, force=True)
        await asyncio.sleep(6)
        print("POPUP:", repr((await _capture_dialog_message(page) or "")[:200]))
        print("RESULT:", json.dumps(await page.evaluate(ROWS_JS), indent=1)[:1500])
        await page.screenshot(path="logs/probe_search_by_id.png")
        print("screenshot: logs/probe_search_by_id.png — STOPPED, nothing selected")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

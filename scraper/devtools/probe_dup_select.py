"""DEV probe: in the ATTACH fallback context (feasibility -> Customer dialog ->
Add -> Personal Customer), enter the real IC so the duplicate Confirm pops, OK
it, select the existing record in Select Customer, OK — and dump what the
portal does next. STOPS there: no PII Proceed, no order, nothing saved."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import (ORDER_ENTRY_URL, _frame, ensure_on_order_entry,
                         choose_personal_customer, personal_customer_dialog)
from oe_helpers import set_combobox
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _open_advanced_query,
                            _dismiss_customer_not_exist_dialog, _close_advanced_query)
from order_to_payload import order_to_payload
from devtools.probe_fallback_fill import ORD0010

DUMP_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const vis=e=>e&&e.offsetParent!==null;
  const dls=[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis);
  return {dialogs: dls.map(dl=>({
    title: ((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim().slice(0,60),
    text: (dl.innerText||'').replace(/\s+/g,' ').slice(0,400),
    buttons: [...dl.querySelectorAll('button,a.btn')].filter(vis).map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,12),
  })),
  orderSearch: (()=>{const el=d.querySelector('.js-order-search'); return el?(el.innerText||el.value||'').replace(/\s+/g,' ').slice(0,200):null})()};
})()"""

async def main(session_path):
    payload = order_to_payload(ORD0010)
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await open_feasibility(frame); await asyncio.sleep(2)
        for attempt in range(4):
            r = await select_address(frame, payload["address"])
            print(f"ADDRESS try {attempt+1}:", json.dumps(r)[:160])
            if r.get("status") == "ok":
                break
            # the empty-result Select Address dialog stays up — cancel + reopen
            await asyncio.sleep(10)
            await ensure_on_order_entry(page)
            frame = _frame(page)
            await open_feasibility(frame); await asyncio.sleep(2)
        plan_r = await select_plan(frame, payload["plan"], page=page)
        print("PLAN   :", json.dumps(plan_r)[:300])
        await asyncio.sleep(2)
        print("STATE AFTER PLAN:", json.dumps(await page.evaluate(DUMP_JS), indent=1)[:2000])
        await page.screenshot(path="logs/probe_after_plan.png")
        if not await customer_dialog_open(frame):
            await frame.locator(".js-orderNow").first.click(timeout=15000)
            await asyncio.sleep(4)
        # not-found search, then the dialog's Add -> Personal Customer
        await _open_advanced_query(frame, "MyKad")
        await frame.locator('input[name="certNbr"]:visible').first.fill(ORD0010["idNumber"])
        await frame.locator('input[name="custName"]:visible').first.fill(ORD0010["fullName"])
        await frame.locator("button.js-query:visible").first.click(); await asyncio.sleep(5)
        print("not_exist:", await _dismiss_customer_not_exist_dialog(frame))
        await _close_advanced_query(frame)
        add = frame.locator(
            ".ui-dialog:visible .js-add-cust-btn:visible, .js-add-cust-btn:visible, "
            '.ui-dialog:visible [class*="add-cust"]:visible').first
        await add.click(timeout=8000, force=True)
        await choose_personal_customer(frame)
        dlg = personal_customer_dialog(frame)
        await dlg.wait_for(state="visible", timeout=15000)
        await set_combobox(frame, "certTypeId", "MyKad", scope=dlg)
        await dlg.locator('input[name="certNbr"]').first.fill(ORD0010["idNumber"])
        await dlg.locator('input[name="custName"]').first.fill(ORD0010["fullName"])
        confirm = frame.locator('.ui-dialog:visible, .modal.in:visible').filter(
            has_text="Multiple customer records").last
        await confirm.wait_for(state="visible", timeout=15000)
        print("dup Confirm visible -> OK")
        await confirm.locator('button:has-text("OK")').first.click()
        sel = frame.locator('.ui-dialog:visible, .modal.in:visible').filter(
            has_text="Select Customer").last
        await sel.wait_for(state="visible", timeout=15000)
        row = sel.locator("tr.jqgrow").first
        await row.click(); await asyncio.sleep(1)
        print("row clicked -> OK")
        await sel.locator('button:has-text("OK")').last.click()
        await asyncio.sleep(5)
        print("AFTER SELECT:", json.dumps(await page.evaluate(DUMP_JS), indent=1))
        await page.screenshot(path="logs/probe_dup_select.png")
        print("screenshot: logs/probe_dup_select.png — STOPPED, nothing proceeded")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

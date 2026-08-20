"""DEV probe (read-only): at the duplicate-IC Confirm, click OK and dump what
the portal shows (record picker?). Cancels everything, saves nothing."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import (ORDER_ENTRY_URL, _frame, ensure_on_order_entry,
                         choose_personal_customer, personal_customer_dialog)
from oe_helpers import set_combobox

DUMP_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const vis=e=>e&&e.offsetParent!==null;
  const dls=[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis);
  return dls.map(dl=>({
    title: ((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim().slice(0,60),
    text: (dl.innerText||'').replace(/\s+/g,' ').slice(0,600),
    buttons: [...dl.querySelectorAll('button,a.btn')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,15),
    gridRows: [...dl.querySelectorAll('tr.jqgrow')].map(r=>(r.innerText||'').replace(/\s+/g,' ').slice(0,200)).slice(0,8),
  }));
})()"""

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
        confirm = frame.locator('.ui-dialog:visible, .modal.in:visible').filter(
            has_text="Multiple customer records").last
        await confirm.wait_for(state="visible", timeout=15000)
        await confirm.locator('button:has-text("OK")').first.click()
        await asyncio.sleep(4)
        print("AFTER OK:", json.dumps(await page.evaluate(DUMP_JS), indent=1))
        await page.screenshot(path="logs/probe_dup_ok.png", full_page=True)
        print("screenshot: logs/probe_dup_ok.png — nothing saved")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

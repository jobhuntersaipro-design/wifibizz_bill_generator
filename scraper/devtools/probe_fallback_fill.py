"""DEV probe: reproduce ORD-0010's attach-time create-fallback context live and
verify the SCOPED Personal Customer fill. Read-only against the CRM: searches,
opens dialogs, fills the create form with fill_only=True and NEVER clicks OK.

    venv/bin/python -m devtools.probe_fallback_fill sessions/dealer_<key>.json
"""
import asyncio, json, sys, time
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry, \
    choose_personal_customer, fill_and_submit_personal_customer
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _open_advanced_query,
                            _dismiss_customer_not_exist_dialog,
                            _close_advanced_query)
from order_to_payload import order_to_payload
from oe_feasibility import _capture_dialog_message


async def dismiss_any_dialog_over_backdrop(frame, page):
    """Read + close whatever popup a Query left (info/warning), generically."""
    msg = await _capture_dialog_message(page)
    try:
        btn = frame.locator(
            '.ui-dialog:visible button:has-text("OK"), .modal.in:visible button:has-text("OK")').last
        if await btn.count():
            await btn.click(timeout=3000)
            await asyncio.sleep(1)
    except Exception:
        pass
    return msg

ORD0010 = {
    "id": "probe", "idType": "MyKad", "idNumber": "820505034434",
    "fullName": "HONG TUNG TUNG", "gender": "Female", "birthday": "05-05-1982",
    "race": "Chinese", "nationality": "Malaysia",
    "mobilePrefix": "60", "mobile": "148892210", "email": "jjll1132@gmail.com",
    "street": "29 JALAN CV 1/2D -  CASA VIEW CYBERSOUTH DENGKIL SELANGOR MALAYSIA 43800",
    "postcode": "43800", "city": "DENGKIL", "state": "Selangor", "country": "Malaysia",
    "offerCategory": "unifi Home Bundle Sale Catg",
    "offerName": "Unifi Home 500Mbps Premium Value With Device (36M)",
    "documents": [
        {"type": "mykad", "key": "orders/cmrabw266000104ldltneycfy/820505034434_mykad_1.png"},
    ],
}
RANDOM_IC = "731102086134"
PAGE = None  # fill-test IC: syntactically valid, unlikely used

COLLIDE_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const vis=e=>e&&e.offsetParent!==null;
  const info=n=>[...d.querySelectorAll(`input[name="${n}"]`)].map((i,ix)=>({
    ix, visible: vis(i), inCustForm: !!i.closest('form.js-cust-form'),
    dialogTitle: (()=>{const dl=i.closest('.ui-dialog,.modal');
      return dl?((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim().slice(0,40):null})(),
  }));
  return {certNbr: info('certNbr'), custName: info('custName'),
          jsOk: [...d.querySelectorAll('.js-ok')].map(b=>({visible: vis(b),
            dlg: (b.closest('.ui-dialog,.modal')?.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||''})),
          qryForms: [...d.querySelectorAll('form.js-qry-form')].map(f2=>({visible: vis(f2),
            dlg: (f2.closest('.ui-dialog,.modal')?.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||''}))};
})()"""

async def search(frame, ic, name):
    await frame.locator('input[name="certNbr"]:visible').first.fill(ic, timeout=8000)
    await frame.locator('input[name="custName"]:visible').first.fill(name, timeout=8000)
    await frame.locator("button.js-query:visible").first.click(timeout=8000)
    await asyncio.sleep(5)
    not_exist = await _dismiss_customer_not_exist_dialog(frame)
    other_popup = None
    if not not_exist:
        other_popup = await dismiss_any_dialog_over_backdrop(frame, PAGE)
    rows = frame.locator(".js-customer-result-grid tr.jqgrow")
    n = await rows.count()
    texts = []
    for i in range(min(n, 5)):
        texts.append((await rows.nth(i).inner_text()).strip()[:120])
    return {"rows": n, "not_exist": not_exist, "other_popup": other_popup, "texts": texts}

async def main(session_path):
    payload = order_to_payload(ORD0010)
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        global PAGE
        PAGE = page
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await open_feasibility(frame); await asyncio.sleep(2)
        print("ADDRESS:", json.dumps(await select_address(frame, payload["address"]))[:200])
        print("PLAN   :", json.dumps(await select_plan(frame, payload["plan"], page=page))[:200])
        await asyncio.sleep(2)
        if not await customer_dialog_open(frame):
            print("Customer dialog not auto-open -> clicking Order")
            await frame.locator(".js-orderNow").first.click(); await asyncio.sleep(4)
        print("customer_dialog_open:", await customer_dialog_open(frame))
        await _open_advanced_query(frame, "MyKad")

        print("\n== probe 1: real IC + real name ==")
        print(json.dumps(await search(frame, ORD0010["idNumber"], ORD0010["fullName"]), indent=1))
        print("\n== probe 2: real IC, name blank ==")
        print(json.dumps(await search(frame, ORD0010["idNumber"], ""), indent=1))
        await page.screenshot(path="logs/probe_aq_ic_only.png")

        print("\n== probe 3: random IC (reset to not-found state) ==")
        print(json.dumps(await search(frame, RANDOM_IC, "HONG TUNG TUNG"), indent=1))

        print("\n== fallback: close AQ, Add, Personal Customer ==")
        await _close_advanced_query(frame)
        add = frame.locator(
            ".ui-dialog:visible .js-add-cust-btn:visible, .js-add-cust-btn:visible, "
            '.ui-dialog:visible [class*="add-cust"]:visible').first
        print("add button count:", await add.count())
        await add.click(timeout=8000, force=True)
        await choose_personal_customer(frame)
        await asyncio.sleep(2)
        print("COLLISIONS:", json.dumps(await page.evaluate(COLLIDE_JS), indent=1))

        cust = dict(payload["customer"])
        cust["id_number"] = RANDOM_IC        # avoid the duplicate-IC dialog
        r = await fill_and_submit_personal_customer(frame, cust, fill_only=True)
        print("\nFILL RESULT:", json.dumps(r))
        stamp = time.strftime("%H%M%S")
        await page.evaluate(r"""(() => {const f=document.querySelector('#myIframe');
          const d=f&&f.contentDocument; if(!d) return;
          const dls=[...d.querySelectorAll('.ui-dialog')].filter(e=>e.offsetParent!==null);
          const dl=dls[dls.length-1]; const b=dl&&dl.querySelector('.modal-body,.ui-dialog-content');
          if(b) b.scrollTop=0;})()""")
        await asyncio.sleep(1)
        await page.screenshot(path=f"logs/probe_fill_top_{stamp}.png")
        # scroll the dialog to photograph the lower half (contact + attachment)
        await page.evaluate(r"""(() => {const f=document.querySelector('#myIframe');
          const d=f&&f.contentDocument; if(!d) return;
          const dls=[...d.querySelectorAll('.ui-dialog')].filter(e=>e.offsetParent!==null);
          const dl=dls[dls.length-1]; const b=dl&&dl.querySelector('.modal-body,.ui-dialog-content');
          if(b) b.scrollTop=b.scrollHeight;})()""")
        await asyncio.sleep(1)
        await page.screenshot(path=f"logs/probe_fill_bottom_{stamp}.png")
        print(f"screenshots: logs/probe_fill_top_{stamp}.png / probe_fill_bottom_{stamp}.png")
        print("STOPPED — fill_only, nothing created.")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

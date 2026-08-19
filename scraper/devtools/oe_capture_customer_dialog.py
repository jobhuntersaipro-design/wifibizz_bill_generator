"""DEV capture (read-only): drive feasibility to the Order click, then dump the
full structure of the 'Customer' dialog that gates the order id — its inputs
(customer search), buttons, tabs, and any result grid. STOPS there; nothing is
created. python oe_capture_customer_dialog.py <session.json>
"""
import asyncio
import json
import os
import sys
import time

import dealer_web_login
from oe_feasibility import open_feasibility, select_address, select_plan
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry

DUMP_JS = r"""(() => {
  const f = document.querySelector('#myIframe'); const d = f && f.contentDocument;
  if (!d) return {err:'no iframe doc'};
  const dlgs = [...d.querySelectorAll('.ui-dialog')].filter(e => e.offsetParent !== null);
  const dlg = dlgs[dlgs.length - 1];
  if (!dlg) return {err:'no visible dialog', totalDialogs: d.querySelectorAll('.ui-dialog').length};
  const T = el => ((el && el.innerText) || '').trim();
  return {
    title: T(dlg.querySelector('.ui-dialog-title, .modal-title, .modal-header')),
    inputs: [...dlg.querySelectorAll('input,select,textarea')].map(i => ({
      tag: i.tagName, name: i.getAttribute('name'), cls: i.className, id: i.id, type: i.type,
      placeholder: i.getAttribute('placeholder'), role: i.getAttribute('role'),
      disabled: i.disabled, visible: i.offsetParent !== null })),
    comboDisplays: [...dlg.querySelectorAll('input[role="combobox"], .combobox, .ui-select, [class*="select"]')]
      .map(e => ({tag: e.tagName, cls: e.className, text: T(e).slice(0,40), ph: e.getAttribute && e.getAttribute('placeholder')})).slice(0, 15),
    clickable: [...new Set([...dlg.querySelectorAll('button, a, label, .btn, [onclick], .radio, .checkbox')].map(T).filter(Boolean))].slice(0, 40),
    buttons: [...dlg.querySelectorAll('button, a.btn')].map(b => ({text: T(b), cls: b.className})).filter(b => b.text),
    gridHeaders: [...new Set([...dlg.querySelectorAll('th, .ui-jqgrid-htable td')].map(T).filter(Boolean))].slice(0, 25),
    html: dlg.innerHTML.slice(0, 4000),
  };
})()"""


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
        await open_feasibility(frame); await asyncio.sleep(2)
        print("select_address:", await select_address(frame, addr))
        print("select_plan:", await select_plan(frame, plan))
        print("→ clicking Order to reveal the Customer dialog…")
        await frame.locator(".js-orderNow").first.click()
        await asyncio.sleep(4)
        info = await page.evaluate(DUMP_JS)
        print("\n=== CUSTOMER DIALOG ===")
        print("title  :", info.get("title"))
        print("inputs :")
        for i in info.get("inputs", []):
            print("   ", i)
        print("comboDisplays:", info.get("comboDisplays"))
        print("clickable:", info.get("clickable"))
        print("buttons:", info.get("buttons"))
        print("grid headers:", info.get("gridHeaders"))
        print("\n--- HTML (first 4000) ---\n", info.get("html", "")[:4000])
        stamp = time.strftime("%H%M%S")
        await page.screenshot(path=f"logs/custdlg_{stamp}.png", full_page=True)
        with open(f"logs/custdlg_{stamp}.json", "w") as fh:
            json.dump(info, fh, indent=2)
        print(f"\nscreenshot: logs/custdlg_{stamp}.png · dump: logs/custdlg_{stamp}.json (STOPPED — nothing created)")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess))

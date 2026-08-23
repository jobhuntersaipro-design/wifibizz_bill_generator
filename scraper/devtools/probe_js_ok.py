"""DEV probe (SAFE — creates NO customer, clicks no OK): open the Personal
Customer form and dump every `.js-ok` in it.

Why: a live submit (job 2e0c330d, 2026-08-23) filled the whole form, clicked
`dlg.locator(".js-ok").first`, and came back with the card-reader dialog open
("Fail to read card!") and customer_create_timeout. Nothing else clicks at that
moment, so the suspicion is that `.first` is matching the Read Card button. This
prints the candidates in DOM order so that stops being a suspicion.

    python devtools/probe_js_ok.py sessions/dealer_<userId>.json
"""
import asyncio
import sys

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, _frame

DUMP_JS = r"""(() => {
  const f = document.querySelector('#myIframe');
  if (!f || !f.contentDocument) return {error: 'no iframe'};
  const d = f.contentDocument;
  const vis = e => {
    if (!e) return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return (e.offsetParent !== null || s.position === 'fixed')
        && s.visibility !== 'hidden' && s.display !== 'none'
        && r.width > 0 && r.height > 0;
  };
  const txt = e => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
  const dialogs = [...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis);
  const dlg = dialogs.filter(x => x.querySelector('form.js-cust-form')).pop();
  const describe = e => ({
    text: txt(e).slice(0, 40),
    cls: (e.className || '').slice(0, 90),
    visible: vis(e),
    inReadCardPanel: !!e.closest('.js-read-card, .read-card, [class*="readCard"], [class*="read-card"]'),
    parentCls: ((e.parentElement || {}).className || '').slice(0, 90),
  });
  return {
    dialogCount: dialogs.length,
    dialogTitles: dialogs.map(x => txt(x.querySelector('.modal-title,.ui-dialog-title')).slice(0, 40)),
    jsOk: dlg ? [...dlg.querySelectorAll('.js-ok')].map(describe) : [],
    allButtons: dlg ? [...dlg.querySelectorAll('button, .btn')].filter(vis).map(describe) : [],
  };
})()"""


async def main(session_path):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        print("→ open Personal Customer form")
        await frame.locator(".js-order-search").first.click()
        await frame.locator(".js-add-cust-btn").first.click()
        await frame.locator(".show-customer-left").first.wait_for(state="visible", timeout=15000)
        await frame.locator(".show-customer-left").first.click()
        await asyncio.sleep(4)

        info = await page.evaluate(DUMP_JS)
        print(f"\n=== visible dialogs: {info.get('dialogCount')} {info.get('dialogTitles')}")
        print(f"\n=== .js-ok in the customer dialog, DOM order ({len(info.get('jsOk', []))}):")
        for i, b in enumerate(info.get("jsOk", [])):
            print(f"  [{i}] text={b['text']!r} vis={b['visible']} readCardPanel={b['inReadCardPanel']}")
            print(f"      cls={b['cls']!r} parent={b['parentCls']!r}")
        print(f"\n=== every visible button in the dialog ({len(info.get('allButtons', []))}):")
        for i, b in enumerate(info.get("allButtons", [])):
            print(f"  [{i}] text={b['text']!r} cls={b['cls']!r}")

        import os
        import time
        os.makedirs("logs", exist_ok=True)
        shot = f"logs/probe_js_ok_{time.strftime('%H%M%S')}.png"
        await page.screenshot(path=shot, full_page=True)
        print(f"\nscreenshot: {shot}")
    finally:
        for c in ((context.close if context else None),
                  (browser.close if browser else None),
                  (pw.stop if pw else None)):
            if c:
                try:
                    await c()
                except Exception:
                    pass


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

"""DEV test (SAFE — creates NO customer): open Personal Customer form, set ID
Type, immediately click OK (.js-ok). Expect the "data is incomplete" Warning,
which proves .js-ok is the correct element (button fires + validates)."""
import asyncio, sys
import dealer_web_login
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, _frame
from oe_helpers import set_combobox

DIALOG_JS = r"""(() => {
  const f = document.querySelector('#myIframe');
  if (!f || !f.contentDocument) return [];
  const d = f.contentDocument;
  return [...d.querySelectorAll('.ui-dialog')].filter(x => x.offsetParent !== null).map(x => ({
    title: (x.querySelector('.modal-title,.ui-dialog-title')||{}).textContent||'',
    msg: (x.querySelector('.modal-message,.modal-body')||{}).textContent||'',
    cls: x.className,
  }));
})()"""

async def main(session_path):
    pw=browser=context=page=None
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
        await asyncio.sleep(2)
        print("→ set ID Type = MyKad")
        try:
            await set_combobox(frame, "certTypeId", "MyKad")
        except Exception as e:
            print(f"  ⚠ set ID type: {e}")
        print("→ click OK (.js-ok) immediately")
        await frame.locator(".js-ok").first.click(timeout=8000)
        await asyncio.sleep(3)
        dialogs = await page.evaluate(DIALOG_JS)
        print(f"\n=== visible dialogs after OK ({len(dialogs)}): ===")
        for d in dialogs:
            print(f"  title={d['title'].strip()!r} msg={d['msg'].strip()[:120]!r}")
        import os, time
        os.makedirs("logs", exist_ok=True)
        shot=f"logs/ok_button_test_{time.strftime('%H%M%S')}.png"
        await page.screenshot(path=shot, full_page=True)
        print(f"screenshot: {shot}")
        hit = any('incomplete' in (d['msg']+d['title']).lower() or 'warning' in d['title'].lower() for d in dialogs)
        print("\nRESULT:", "✓ .js-ok is CORRECT — validation popup shown, NO customer created"
              if hit else "⚠ no warning popup detected — inspect screenshot")
    finally:
        for c in ((context.close if context else None),(browser.close if browser else None),(pw.stop if pw else None)):
            if c:
                try: await c()
                except Exception: pass

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv)>1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"))

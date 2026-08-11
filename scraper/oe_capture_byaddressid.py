"""DEV capture (read-only): map the 'By Address Id' search tab of the feasibility
Select Address modal, and pull real resourceInstIds. STOPS before OK / Order —
nothing selected, no order. Run from scraper/:  python oe_capture_byaddressid.py <session.json> <STATE> <keyword>
"""
import asyncio
import json
import sys
import time

import dealer_web_login
from oe_helpers import set_combobox
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, open_feasibility, _frame

# Lists every input/button inside the Select Address modal so we can see the
# real field name/id of the "By Address Id" tab.
FORM_JS = r"""(() => {
  const f = document.querySelector('#myIframe'); const d = f && f.contentDocument;
  if (!d) return {err:'no iframe doc'};
  const form = d.querySelector('form.js-address-form') || d;
  const inputs = [...form.querySelectorAll('input')].map(i => ({
    name: i.getAttribute('name'), id: i.id, type: i.type,
    placeholder: i.getAttribute('placeholder'), visible: i.offsetParent !== null,
  }));
  const tabs = [...form.querySelectorAll('a,button,label')].map(b => (b.innerText||'').trim()).filter(Boolean);
  return { inputs, tabs: [...new Set(tabs)] };
})()"""


async def read_rows(frame):
    rows = frame.locator(".js-address-grid tr.jqgrow")
    n = await rows.count()
    out = []
    for i in range(min(n, 8)):
        tds = rows.nth(i).locator("td[title]")
        titles = []
        for j in range(await tds.count()):
            t = ((await tds.nth(j).get_attribute("title")) or "").strip()
            if t:
                titles.append(t)
        out.append(titles)
    return n, out


async def main(session_path, state, keyword):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await open_feasibility(frame)
        await asyncio.sleep(2)

        # Open the Select Address modal via the expand icon.
        await frame.locator('.js-address-pop span.input-group-addon:has(.glyphicon-new-window)').first.click(timeout=8000, force=True)
        await asyncio.sleep(2)
        await set_combobox(frame, "custType", "Consumer")
        await set_combobox(frame, "state", state)

        # 1) Keyword search to harvest real resourceInstIds (last column).
        await frame.locator("#byKeywords").first.click()
        await frame.locator('input[name="keywords"]').first.fill(keyword)
        await frame.locator(".js-address-form .js-query").first.click()
        await asyncio.sleep(6)
        n, rows = await read_rows(frame)
        print(f"=== keyword '{keyword}' -> {n} rows (last value in each row = resourceInstId) ===")
        for i, r in enumerate(rows):
            print(f"  row{i}: {r}")
        first_id = rows[0][-1] if rows and rows[0] else None

        # 2) Inspect the 'By Address Id' tab: click it, dump form fields.
        print("\n=== switching to 'By Address Id' tab ===")
        clicked = False
        for sel in ('#byAddressId', 'a:has-text("By Address Id")', 'button:has-text("By Address Id")', 'label:has-text("By Address Id")'):
            loc = frame.locator(sel).first
            if await loc.count() > 0:
                try:
                    await loc.click(timeout=4000)
                    clicked = True
                    print(f"  clicked tab via {sel}")
                    break
                except Exception as e:
                    print(f"  {sel} click failed: {str(e)[:80]}")
        await asyncio.sleep(1.5)
        form = await page.evaluate(FORM_JS)
        print("  address-form inputs:")
        for i in form.get("inputs", []):
            print("   ", i)
        print("  tab labels:", form.get("tabs"))

        # 3) If we found the id field + a real id, query By Address Id.
        if clicked and first_id:
            print(f"\n=== querying By Address Id = {first_id} ===")
            idfield = None
            for cand in ('input[name="addressId"]', 'input[name="resourceInstId"]', 'input[name="addrId"]'):
                if await frame.locator(cand).count() > 0 and await frame.locator(cand).first.is_visible():
                    idfield = cand
                    break
            print(f"  id field selector: {idfield}")
            if idfield:
                await frame.locator(idfield).first.fill(str(first_id))
                await frame.locator(".js-address-form .js-query").first.click()
                await asyncio.sleep(6)
                n2, rows2 = await read_rows(frame)
                print(f"  By Address Id -> {n2} row(s):")
                for r in rows2:
                    print("   ", r)

        stamp = time.strftime("%H%M%S")
        await page.screenshot(path=f"logs/byaddrid_{stamp}.png", full_page=True)
        with open(f"logs/byaddrid_{stamp}.json", "w") as fh:
            json.dump({"keyword_rows": rows, "form": form, "first_id": first_id}, fh, indent=2)
        print(f"\nscreenshot: logs/byaddrid_{stamp}.png  (STOPPED — nothing selected/ordered)")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    st = sys.argv[2] if len(sys.argv) > 2 else "SELANGOR"
    kw = sys.argv[3] if len(sys.argv) > 3 else "SIMFONI HEIGHTS"
    asyncio.run(main(sess, st, kw))

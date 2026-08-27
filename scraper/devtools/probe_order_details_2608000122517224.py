"""DEV probe (read-only): open OrderDetails for order 2608000122517224 and dump
the Attachment section (rows, selected types, filenames, dropdown options) and
the Appointment table. Pure GET + read — no clicks that change state."""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from oe_feasibility import _order_detail_url

ORDER_ID = "2608000122517224"

READ_JS = """
() => {
  const out = {rows: [], appointment: [], selects_sample: null};
  // Attachment rows: find every select near an upload control
  const selects = Array.from(document.querySelectorAll('select'));
  out.select_count = selects.length;
  selects.forEach((sel, i) => {
    const opts = Array.from(sel.options).map(o => ({v: o.value, t: o.textContent.trim(), sel: o.selected}));
    // climb to a row container and read any filename text
    let row = sel.closest('div');
    for (let k = 0; k < 6 && row; k++) {
      if (row.textContent.includes('File Name') || row.querySelector('input[type=file]')) break;
      row = row.parentElement;
    }
    const rowText = row ? row.innerText.replace(/\\s+/g, ' ').slice(0, 300) : '';
    out.rows.push({i, selected: (sel.selectedOptions[0]||{}).textContent||'', options: opts.map(o=>o.t), rowText});
  });
  // also non-native comboboxes (ant/fish style)
  out.comboboxes = Array.from(document.querySelectorAll('.ui-combobox, [class*="combobox"]')).slice(0,20)
    .map(el => el.innerText.replace(/\\s+/g,' ').slice(0,120));
  // appointment table text
  const bodies = Array.from(document.querySelectorAll('table'));
  out.tables = bodies.map(t => t.innerText.replace(/\\s+/g,' ').slice(0,400));
  return out;
}
"""

async def main(session_path):
    pw = browser = context = page = None
    try:
        url = _order_detail_url(ORDER_ID)
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=url)
        await page.wait_for_timeout(6000)
        print("URL:", page.url)
        await page.screenshot(path="logs/probe_2517224_full.png", full_page=True)
        print("screenshot: logs/probe_2517224_full.png")
        # the portal often renders inside an iframe — check frames
        for fr in page.frames:
            try:
                txt = await fr.locator("body").first.inner_text(timeout=3000)
            except Exception:
                continue
            if "Attachment" in txt or "Customer Order Number" in txt:
                print("=== frame:", fr.url[:120])
                data = await fr.evaluate(READ_JS)
                print(json.dumps(data, indent=1)[:8000])
        # top-level fallback
        txt = await page.locator("body").first.inner_text()
        print("----- BODY TEXT (first 3000) -----")
        print(txt[:3000])
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

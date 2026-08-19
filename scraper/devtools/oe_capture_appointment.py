"""oe_capture_appointment.py — READ-ONLY capture of the Appointment calendar.

Answers the one question Phase 5 cannot answer from a fixture: what the live
Appointment dialog's markup actually is. The reader currently reports "no
available slots" for a calendar that, opened by hand, offers four slots a day —
and the cause could be the day-cell selector, the event selector, the dialog
container, or the geometry. This dumps all four so it stops being a guess.

STRICTLY read-only. It opens an EXISTING order, clicks "+ Add" to open the
calendar, and dumps the DOM. It never fills `firstPreferredDatetime`, never
clicks OK/Save/Next, and never creates an order. Clicking Add opens a dialog;
it does not book anything.

Run from scraper/:
    venv/bin/python oe_capture_appointment.py --order 2608000121381702 \
        --session sessions/dealer_<userkey>.json
"""

import argparse
import asyncio
import json
import os

DUMP_DIR = "logs"

ORDER_DETAIL_URL = ("https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails"
                    "?custOrderId={oid}&custOrderNbr={oid}")


# Everything a diagnosis could need, from BOTH documents: which containers are
# visible, every element carrying a date, every FullCalendar-ish class in play,
# and the text of the nodes that look like slots.
_CALENDAR_DUMP_JS = r"""(() => {
  const lines = [];
  function scan(doc, label) {
    if (!doc) { lines.push(label + ': <no document>'); return; }
    lines.push('===== ' + label + ' =====');

    const vis = e => e && e.offsetParent !== null;
    const desc = e => '<' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
      (e.className ? ' .' + String(e.className).trim().split(/\s+/).join('.') : '') + '>';

    // 1. Visible dialog-like containers, and their titles.
    const dsel = '.ui-dialog, .modal, [role="dialog"], .ant-modal, .el-dialog, [class*="dialog"]';
    const dlgs = [...doc.querySelectorAll(dsel)].filter(vis);
    lines.push('dialog-like visible containers: ' + dlgs.length);
    dlgs.forEach((n, i) => {
      const t = n.querySelector('.modal-title,.ui-dialog-title,.ant-modal-title,.el-dialog__title');
      lines.push('  [' + i + '] ' + desc(n) + '  title=' +
        JSON.stringify(((t || {}).innerText || '').trim().slice(0, 80)));
      lines.push('       text: ' +
        (n.innerText || '').trim().replace(/\n+/g, ' | ').slice(0, 200));
    });

    // 2. Anything carrying a date — the day cells, whatever they are called.
    const dated = [...doc.querySelectorAll('[data-date]')];
    lines.push('elements with [data-date]: ' + dated.length);
    const byCls = {};
    dated.forEach(e => {
      const k = e.tagName.toLowerCase() + '.' + String(e.className || '').trim();
      byCls[k] = (byCls[k] || 0) + 1;
    });
    Object.entries(byCls).forEach(([k, n]) => lines.push('  ' + n + ' x  ' + k));
    if (dated.length) {
      lines.push('  first: ' + desc(dated[0]) + ' data-date=' + dated[0].getAttribute('data-date'));
      lines.push('  visible: ' + dated.filter(vis).length + ' of ' + dated.length);
    }

    // 3. Every distinct fc-* class present, so a FullCalendar version change is
    //    obvious at a glance.
    const fc = new Set();
    doc.querySelectorAll('[class*="fc-"]').forEach(e =>
      String(e.className).split(/\s+/).filter(c => c.startsWith('fc-')).forEach(c => fc.add(c)));
    lines.push('fc-* classes present (' + fc.size + '): ' + [...fc].sort().join(' '));

    // 4. Slot-shaped nodes: anything whose own text looks like a time range.
    const timeRe = /\d{2}:\d{2}/;
    const cands = [...doc.querySelectorAll('a,div,span,td,li')].filter(e => {
      if (!timeRe.test(e.textContent || '')) return false;
      return ![...e.children].some(c => timeRe.test(c.textContent || ''));  // leaf-most
    });
    lines.push('leaf nodes containing a HH:MM (' + cands.length + '):');
    cands.slice(0, 12).forEach(e => lines.push('  ' + (vis(e) ? 'vis ' : 'HID ') + desc(e) +
      ' text=' + JSON.stringify((e.innerText || e.textContent || '').trim().slice(0, 50)) +
      ' parent=' + desc(e.parentElement || e)));

    // 5. Is the slot input there at all? Its presence is how the booking step
    //    knows the dialog is the right one.
    const inp = doc.querySelector('input[name="firstPreferredDatetime"]');
    lines.push('input[name=firstPreferredDatetime]: ' +
      (inp ? desc(inp) + ' visible=' + vis(inp) + ' value=' + JSON.stringify(inp.value) : 'ABSENT'));

    // 6. The Add control the flow clicks.
    const adds = [...doc.querySelectorAll('.js-add-date')];
    lines.push('.js-add-date: ' + adds.length + (adds.length ? '  visible=' +
      adds.filter(vis).length + '  ' + desc(adds[0]) : ''));
  }

  scan(document, 'OUTER PAGE');
  const f = document.querySelector('#myIframe');
  scan(f && f.contentDocument, 'IFRAME #myIframe');
  return lines.join('\n');
})()"""


async def _dump(page, label):
    os.makedirs(DUMP_DIR, exist_ok=True)
    try:
        text = await page.evaluate(_CALENDAR_DUMP_JS)
    except Exception as e:  # noqa: BLE001
        text = f"<dump JS failed: {type(e).__name__}: {e}>"
    path = os.path.join(DUMP_DIR, f"appt_{label}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        await page.screenshot(path=os.path.join(DUMP_DIR, f"appt_{label}.png"), full_page=True)
    except Exception as e:  # noqa: BLE001
        print(f"  [dump] screenshot failed: {e}")
    print(f"\n===== {label} =====\n{text}\n  -> {path}")
    return text


async def main(order: str, session_path: str, headless: bool, hold: int) -> int:
    from playwright.async_api import async_playwright

    with open(session_path, encoding="utf-8") as f:
        cookies = json.load(f)["cookies"]
    print(f"session {session_path}: {len(cookies)} cookies")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless, slow_mo=0 if headless else 120)
        context = await browser.new_context(viewport={"width": 1600, "height": 1000})
        await context.add_cookies(cookies)
        page = await context.new_page()
        try:
            url = ORDER_DETAIL_URL.format(oid=order)
            print(f"opening {url}")
            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_timeout(6000)
            print(f"landed on {page.url}")
            if "login" in page.url.lower():
                print("⚠ bounced to login — the session is dead. Reconnect and retry.")
                await _dump(page, "00_bounced_to_login")
                return 2

            # What the page looks like BEFORE Add, so a missing .js-add-date is
            # distinguishable from a calendar that opened empty.
            await _dump(page, "01_before_add")

            clicked = await page.evaluate(r"""(() => {
              const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
              const vis=e=>e&&e.offsetParent!==null;
              for (const doc of [d, document]) {
                if (!doc) continue;
                const b=[...doc.querySelectorAll('.js-add-date')].filter(vis)[0];
                if (b) { b.click(); return doc===d ? 'iframe' : 'outer'; }
              }
              return 'noadd';
            })()""")
            print(f"\nAdd click: {clicked}")
            if clicked == "noadd":
                print("⚠ No visible .js-add-date on this page. The Appointment section may "
                      "only exist inside the New Connection wizard, not on OrderDetails — "
                      "see appt_01_before_add.txt.")
                await _dump(page, "02_no_add_control")
                return 3

            await page.wait_for_timeout(5000)
            await _dump(page, "03_calendar_open")

            # Finally, run the REAL reader against the real DOM and print what it
            # decided — the whole point of the exercise.
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from appointment_policy import choose_slot, describe_read_failure
            from oe_feasibility import _APPT_READ_JS

            diag = await page.evaluate(_APPT_READ_JS)
            print("\n===== _APPT_READ_JS against the LIVE dialog =====")
            print(json.dumps(diag, indent=2)[:2000])
            if diag.get("slots"):
                print("would book:", choose_slot(diag["slots"]))
            else:
                print("would fail with:", describe_read_failure(diag))

            if hold:
                print(f"\nHolding {hold}s for manual inspection. NOTHING has been booked.")
                await page.wait_for_timeout(hold * 1000)
        finally:
            await context.close()
            await browser.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--order", required=True, help="Customer Order Number to open.")
    ap.add_argument("--session", required=True, help="Path to sessions/dealer_<userkey>.json")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--hold", type=int, default=0, help="Seconds to hold the window open.")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.order, a.session, a.headless, a.hold)))

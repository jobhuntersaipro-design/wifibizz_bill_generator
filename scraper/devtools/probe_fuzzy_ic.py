"""DEV probe (read-only): in the Customer (Fuzzy Search) dialog, search by the
IC ALONE and report what comes back. Advanced Query refuses fewer than three
criteria; the fuzzy box takes "Customer Name / ID Number / Service Number /
Old BRN", so it may find a record whose NAME differs from the draft — exactly
ORD-0010's case. STOPS before selecting anything: no order, no PII, no charge.
"""
import asyncio, json, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            customer_dialog_open, _capture_dialog_message)
from order_to_payload import order_to_payload
from devtools.probe_fallback_fill import ORD0010

GRID_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
  const vis=e=>e&&e.offsetParent!==null;
  const dl=[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis).pop();
  if(!dl) return {err:'no dialog'};
  return {
    title: ((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim(),
    grids: [...dl.querySelectorAll('table')].map(t=>({cls:t.className.slice(0,60),
      rows:[...t.querySelectorAll('tr.jqgrow')].length})).filter(g=>g.rows>0).slice(0,6),
    rows: [...dl.querySelectorAll('tr.jqgrow')].map(r=>(r.innerText||'').replace(/\s+/g,' ').slice(0,180)).slice(0,8),
    inputs: [...dl.querySelectorAll('input')].filter(vis).map(i=>({
      name:i.getAttribute('name'), cls:i.className.slice(0,50),
      ph:i.getAttribute('placeholder'), val:i.value})).slice(0,8),
  };
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
        print("customer dialog open:", await customer_dialog_open(frame))
        print("BEFORE:", json.dumps(await page.evaluate(GRID_JS), indent=1)[:900], flush=True)

        # The fuzzy box: the visible text input in the Customer dialog that is
        # not part of Advanced Query (which is closed at this point).
        DUMP = r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis).pop();
          return {
            selects: [...dl.querySelectorAll('select')].map(s=>({name:s.getAttribute('name'),
              cls:s.className.slice(0,60), disabled:s.disabled, visible:vis(s),
              options:[...s.options].map(o=>o.text.trim()).slice(0,10), value:s.value})),
            combo: [...dl.querySelectorAll('input[role=combobox], .ui-combobox-fish input')].map(i=>({
              cls:i.className.slice(0,50), val:i.value, ph:i.getAttribute('placeholder')})),
            inputs: [...dl.querySelectorAll('input')].map(i=>({name:i.getAttribute('name'),
              cls:i.className.slice(0,60), disabled:i.disabled, visible:vis(i),
              ph:(i.getAttribute('placeholder')||'').slice(0,40)})),
            clickables: [...dl.querySelectorAll('button,a,span[class*=glyph],i,.btn')].filter(vis)
              .map(b=>({tag:b.tagName, cls:b.className.slice(0,60), text:(b.innerText||'').trim().slice(0,20)})).slice(0,20),
            html: dl.innerHTML.slice(0, 2500),
          };
        })()"""
        print("DIALOG DUMP:", json.dumps(await page.evaluate(DUMP), indent=1)[:4000], flush=True)

        # The search-type combobox ("Fuzzy Search") is a readonly combobox; open
        # it and list every mode this dealer actually has.
        trig = frame.locator('.js-cust-search-type [role="combobox"]:visible, '
                             '.js-cust-search-type .combobox-readonly:visible').first
        print("type combobox count:", await trig.count())
        await trig.click(timeout=8000, force=True)
        await asyncio.sleep(1.5)
        opts = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
          const vis=e=>e&&e.offsetParent!==null;
          const menus=[...d.querySelectorAll('ul.combobox-dropdown')].filter(vis);
          return menus.map(m=>[...m.querySelectorAll('li')].map(li=>({
            title: li.getAttribute('title'), text:(li.innerText||'').trim()})));
        })()""")
        print("SEARCH MODES:", json.dumps(opts, indent=1))
        await page.screenshot(path="logs/probe_search_modes.png")

        popup = await _capture_dialog_message(page)
        print("POPUP:", repr((popup or "")[:200]))
        print("AFTER:", json.dumps(await page.evaluate(GRID_JS), indent=1)[:1600], flush=True)
        await page.screenshot(path="logs/probe_fuzzy_ic.png")
        print("screenshot: logs/probe_fuzzy_ic.png — STOPPED, nothing selected")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

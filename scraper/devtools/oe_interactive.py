"""Interactive, PERSISTENT New Connection driver — reach the page ONCE, keep the
browser alive, then run one step at a time so a failure never costs a new order.

Start (background, headed):
  OE_TEST_PROD unused. FEAS_OFFER=<pkg> python3 oe_interactive.py --headed &

Drive it by writing a command to logs/oe_cmd.json (seq must increase); the runner
executes it, screenshots to logs/oe_step_<seq>.png, and writes logs/oe_result.json.

Commands (JSON): {"seq":N,"op":...}
  shot                                  – screenshot
  dump                                  – list visible dialogs (title/rows/buttons/inputs)
  eval  {"js":"<expr>"}                 – run JS inside the #myIframe document, return value
  jsclick {"sel":"<css>"}               – JS-click the first VISIBLE match in the iframe
  topdialog_newwindow                   – JS-click the new-window icon in the topmost dialog
  click {"sel":"<css>"}                 – Playwright click (frame-scoped)
  fill  {"sel":"<css>","val":"..."}     – Playwright fill
  cancelpopup                           – cancel the stray "Customer" popup
  func  {"name":"<fn>"}                 – run a production function (see FUNCS)
  quit                                  – teardown + exit
"""
import asyncio
import json
import os
import sys
import time

import login_manager
import dealer_web_login
import dealer_address_search as das
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry
from oe_feasibility import (open_feasibility, select_plan, attach_customer,
                            cancel_customer_popup, complete_new_connection,
                            fill_subproduct_tabs, set_installation_contact,
                            create_billing_account, set_winback_tagging,
                            select_device, fill_customer_order_info,
                            pay_and_submit, submit_new_connection, click_next_newconn)
from devtools.oe_capture_newconn import _pick_orderable_address

CMD = os.environ.get("OE_CMD", "logs/oe_cmd.json")
RES = os.environ.get("OE_RES", "logs/oe_result.json")
IC = os.environ.get("FEAS_IC", "900808076666")
NAME = os.environ.get("FEAS_NAME", "HOR HO HO")
EMAIL = os.environ.get("FEAS_EMAIL", "HOHOHO@HH.COM")
PAYLOAD = {
    "customer": {"contact": {"email": EMAIL, "mobile_prefix": "60", "mobile": "137089093"}},
    # Device from the draft (with-device offer). 445446 = Premium Value Samsung
    # TV 43inch 1 (RM20) — the one that took no rejection popup on window 1.
    "deviceCode": os.environ.get("FEAS_DEVICE_CODE", "445446"),
    "deviceName": os.environ.get("FEAS_DEVICE_NAME", "Premium Value Samsung TV 43inch 1"),
}
IM_FILES = [p for p in ["logs/testfiles/im_conversation.png"] if os.path.exists(p)]
ID_FILES = [p for p in ["logs/testfiles/id_copy.png"] if os.path.exists(p)]


def _wrap(js_expr):
    return ("(() => { const f=document.querySelector('#myIframe'), "
            "d=f&&f.contentDocument; if(!d) return {err:'nodoc'}; "
            f"return ({js_expr}); }})()")


async def shot(page, tag):
    p = f"logs/oe_step_{tag}.png"
    await page.screenshot(path=p, full_page=True)
    return p


async def dump_dialogs(page):
    return await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return {err:'nodoc'};
      const vis=e=>e&&e.offsetParent!==null;
      const T=e=>((e&&e.innerText)||'').trim().slice(0,50);
      return {count:[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis).length,
        dialogs:[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis).map(dl=>({
          title:T(dl.querySelector('.ui-dialog-title,.modal-title')),
          rows:[...dl.querySelectorAll('tr.jqgrow')].slice(0,6).map(r=>[...r.querySelectorAll('td[title]')].map(td=>td.getAttribute('title')).filter(Boolean).slice(0,4)),
          inputs:[...dl.querySelectorAll('input[name],select[name]')].slice(0,20).map(i=>i.name),
          buttons:[...dl.querySelectorAll('button,a.btn,span.input-group-addon')].slice(0,20).map(b=>({t:T(b),cls:b.className})).filter(b=>b.t||b.cls.includes('addon')||b.cls.includes('new-window')),
        }))};
    })()""")


FUNCS = {
    "complete_new_connection": lambda page, frame: complete_new_connection(page, PAYLOAD),
    "select_device":           lambda page, frame: select_device(page, PAYLOAD),
    "fill_subproduct_tabs":    lambda page, frame: fill_subproduct_tabs(page, PAYLOAD),
    "click_next":              lambda page, frame: click_next_newconn(page),
    "fill_customer_order_info":lambda page, frame: fill_customer_order_info(page, PAYLOAD, IM_FILES, ID_FILES),
    "pay_and_submit_gated":    lambda page, frame: pay_and_submit(page, do_pay=False),
    # Full New Connection detail flow, SAFE gate (stops at Pay).
    "submit_new_connection":   lambda page, frame: submit_new_connection(
        page, PAYLOAD, im_paths=IM_FILES, id_paths=ID_FILES, do_pay=False),
    "set_installation_contact":lambda page, frame: set_installation_contact(frame, page),
    "create_billing_account": lambda page, frame: create_billing_account(frame, page),
    "set_winback_tagging":     lambda page, frame: set_winback_tagging(frame, page),
    "cancel_customer_popup":   lambda page, frame: cancel_customer_popup(page),
    # Phase 5 diagnosis: open the Appointment calendar and report what is really
    # in it. Read-only — clicks Add (which opens a dialog and books nothing),
    # never fills firstPreferredDatetime and never clicks OK.
    "dump_calendar":           lambda page, frame: dump_calendar(page),
}


async def dump_calendar(page):
    """Click "+ Add", wait for the calendar, and return both the raw markup and
    what the production reader makes of it.

    This is the one question a fixture cannot answer: which day-cell and event
    selectors the live FullCalendar emits. Doing it here rather than in a submit
    is the point — the order already exists, so this can be repeated as often as
    needed without costing another one.
    """
    from appointment_policy import choose_slot, describe_read_failure
    from oe_feasibility import _APPT_READ_JS, _read_calendar

    clicked = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const b=[...d.querySelectorAll('.js-add-date')].filter(vis)[0];
      if(!b) return 'noadd'; b.click(); return 'ok';
    })()""")
    if clicked != "ok":
        return {"add_click": clicked, "note": "no visible .js-add-date on this page"}

    # Same polling read the submit flow now uses, so this reproduces the real
    # behaviour rather than a friendlier version of it.
    diag = await _read_calendar(page)

    markup = await page.evaluate(r"""(() => {
      const out={};
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
      if(!d) return {err:'nodoc'};
      const vis=e=>e&&e.offsetParent!==null;
      const desc=e=>'<'+e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+
        (e.className?' .'+String(e.className).trim().split(/\s+/).join('.'):'')+'>';
      out.dialogs=[...d.querySelectorAll('.ui-dialog,.modal,[role=dialog],.ant-modal,.el-dialog')]
        .filter(vis).map(n=>({node:desc(n),
          title:((n.querySelector('.modal-title,.ui-dialog-title,.ant-modal-title')||{}).innerText||'').trim().slice(0,60),
          text:(n.innerText||'').trim().replace(/\n+/g,' | ').slice(0,150)}));
      const dated=[...d.querySelectorAll('[data-date]')];
      out.datedCount=dated.length;
      out.datedVisible=dated.filter(vis).length;
      out.datedKinds={};
      dated.forEach(e=>{const k=e.tagName.toLowerCase()+'.'+String(e.className||'').trim();
        out.datedKinds[k]=(out.datedKinds[k]||0)+1;});
      const fc=new Set();
      d.querySelectorAll('[class*="fc-"]').forEach(e=>String(e.className).split(/\s+/)
        .filter(c=>c.startsWith('fc-')).forEach(c=>fc.add(c)));
      out.fcClasses=[...fc].sort();
      const timeRe=/\d{2}:\d{2}/;
      out.timeLeaves=[...d.querySelectorAll('a,div,span,td,li')]
        .filter(e=>timeRe.test(e.textContent||'')
          && ![...e.children].some(c=>timeRe.test(c.textContent||'')))
        .slice(0,10).map(e=>({vis:vis(e), node:desc(e),
          text:(e.innerText||e.textContent||'').trim().slice(0,40),
          parent:desc(e.parentElement||e)}));
      const inp=d.querySelector('input[name="firstPreferredDatetime"]');
      out.slotInput=inp?{node:desc(inp),visible:vis(inp),value:inp.value}:'ABSENT';
      return out;
    })()""")

    verdict = (f"would book {choose_slot(diag['slots'])}" if diag.get("slots")
               else f"would fail: {describe_read_failure(diag)}")
    return {"reader": diag, "markup": markup, "verdict": verdict}


async def do(cmd, page):
    frame = _frame(page)
    op = cmd.get("op")
    if op == "shot":
        return {"shot": await shot(page, str(cmd["seq"]))}
    if op == "dump":
        return await dump_dialogs(page)
    if op == "eval":
        return {"value": await page.evaluate(_wrap(cmd["js"]))}
    if op == "jsclick":
        return {"result": await page.evaluate(
            """(sel)=>{const d=document.querySelector('#myIframe').contentDocument;
               const vis=e=>e&&e.offsetParent!==null;
               const el=[...d.querySelectorAll(sel)].find(vis);
               if(!el) return 'notfound'; (el.closest('.input-group-addon')||el).click(); return 'clicked';}""",
            cmd["sel"])}
    if op == "topdialog_newwindow":
        return {"result": await page.evaluate(r"""(() => {
            const d=document.querySelector('#myIframe').contentDocument;
            const vis=e=>e&&e.offsetParent!==null;
            const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
            const top=dlgs[dlgs.length-1]; if(!top) return 'nodialog';
            const icon=[...top.querySelectorAll('.glyphicon-new-window')].find(vis);
            if(!icon) return 'noicon'; (icon.closest('.input-group-addon')||icon).click(); return 'clicked';
        })()""")}
    if op == "click":
        await frame.locator(cmd["sel"]).first.click(timeout=cmd.get("timeout", 8000),
                                                     force=cmd.get("force", False))
        return {"result": "clicked"}
    if op == "fill":
        await frame.locator(cmd["sel"]).first.fill(cmd["val"], timeout=8000)
        return {"result": "filled"}
    if op == "setfiles":
        # cmd["val"] = local file path (download from R2 first). Sets files on the
        # hidden <input type=file> directly (no native dialog).
        await frame.locator(cmd["sel"]).first.set_input_files(cmd["val"], timeout=8000)
        return {"result": f"files set: {cmd['val']}"}
    if op == "cancelpopup":
        return {"cancelled": await cancel_customer_popup(page)}
    if op == "func":
        fn = FUNCS.get(cmd["name"])
        if not fn:
            return {"error": f"unknown func {cmd['name']}"}
        return {"func_result": await fn(page, frame)}
    return {"error": f"unknown op {op}"}


async def reach(page):
    """Search address -> By Address Id (first orderable) -> Order -> attach -> land."""
    state = os.environ.get("FEAS_STATE", "SELANGOR").upper()
    street = os.environ.get("FEAS_ADDRESS_FULL", "PERSIARAN SAUJANA PUTRA UTAMA 7")
    # FEAS_ADDRESS_ID skips the search entirely and uses the portal's own
    # resourceInstId — the exact unit, no keyword matching involved. Use it when
    # reproducing a specific stored order, where "the same building" is not the
    # same thing as "the same unit".
    fixed_id = os.environ.get("FEAS_ADDRESS_ID", "").strip()
    if fixed_id:
        print(f"→ using address id {fixed_id} directly (no keyword search)")
        ids = [fixed_id]
    else:
        query_by = os.environ.get("FEAS_QUERY_BY", "keyword")
        print(f"→ resolve address ids for {street!r} (query_by={query_by})")
        sr = await das.search_address(os.environ["OE_SESSION"], state=state, value=street,
                                      query_by=query_by)
        ids = [str(a["addressId"]) for a in (sr.get("addresses") or []) if a.get("addressId")][:15]
        print(f"   portal returned {len(ids)} address id(s)")
        if not ids:
            # Fails BEFORE .js-orderNow, so a bad keyword costs no order.
            raise RuntimeError(
                f"address search returned nothing for {street!r}. The portal's keyword "
                "search matches street/building tokens, not a whole concatenated "
                "address — pass FEAS_ADDRESS_ID=<resourceInstId> instead.")
    await ensure_on_order_entry(page)
    frame = _frame(page)
    await open_feasibility(frame); await asyncio.sleep(2)
    ok = await _pick_orderable_address(frame, {"state": state, "customer_type": "Consumer", "address_ids": ids})
    if not ok:
        raise RuntimeError("no orderable address")
    sp = await select_plan(frame, {"name": os.environ.get("FEAS_OFFER", "")})
    if sp.get("status") != "ok":
        row = frame.locator(".js-offer-grid tr.jqgrow").first
        await row.click(); await asyncio.sleep(1)
    await frame.locator(".js-orderNow").first.click(); await asyncio.sleep(4)
    r = await attach_customer(frame, IC, NAME, "MyKad")
    print("attach:", r)
    await asyncio.sleep(3)
    await cancel_customer_popup(page)
    print("✅ landed on New Connection — interactive. Order:", end=" ")
    try:
        oid = await frame.locator("body").first.inner_text()
        import re
        m = re.search(r"Order Number\s*([A-Z0-9]{6,})", oid)
        print(m.group(1) if m else "?")
    except Exception:
        print("?")


async def main(session_path, headed):
    if headed:
        from inspect_order_entry import _headed_launch_safe
        login_manager._launch_browser_safe = _headed_launch_safe
    os.makedirs("logs", exist_ok=True)
    os.environ["OE_SESSION"] = session_path
    for f in (CMD, RES):
        if os.path.exists(f):
            os.remove(f)
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await reach(page)
        await shot(page, "landed")
        last = 0
        print("READY — write commands to logs/oe_cmd.json")
        while True:
            try:
                if os.path.exists(CMD):
                    cmd = json.load(open(CMD))
                    if cmd.get("seq") and cmd["seq"] != last:
                        last = cmd["seq"]
                        if cmd.get("op") == "quit":
                            json.dump({"seq": last, "result": {"bye": True}}, open(RES, "w"))
                            break
                        print(f"[{last}] {cmd.get('op')} {cmd.get('name') or cmd.get('sel') or ''}")
                        try:
                            result = await do(cmd, page)
                        except Exception as e:
                            result = {"error": f"{type(e).__name__}: {e}"}
                        try:
                            await shot(page, str(last))
                        except Exception:
                            pass
                        json.dump({"seq": last, "result": result}, open(RES, "w"), default=str)
                        print(f"    => {json.dumps(result, default=str)[:300]}")
            except Exception as loop_err:
                print("loop error:", loop_err)
            await asyncio.sleep(0.5)
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") \
        else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess, headed=("--headed" in sys.argv)))

"""Stage 2 (REAL): feasibility -> Order -> attach the now-existing customer by IC
in the Customer dialog -> capture the Customer Order Number. Heavy diagnostics +
screenshots at each step (the search->select->order-id tail is being mapped).
Headed with --headed.  python oe_feasibility_order.py <session.json> [--headed]
"""
import asyncio
import json
import os
import re
import sys
import time

import login_manager
import dealer_web_login
from oe_feasibility import open_feasibility, select_address, select_plan
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry

IC = os.environ.get("FEAS_IC", "900808076666")
NAME = os.environ.get("FEAS_NAME", "HOR HO HO")


async def shot(page, tag):
    p = f"logs/order_{tag}_{time.strftime('%H%M%S')}.png"
    await page.screenshot(path=p, full_page=True)
    print(f"    [shot] {p}")


async def dialog_dump(page, tag):
    js = r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return {err:'no doc'};
      const dl=[...d.querySelectorAll('.ui-dialog')].filter(e=>e.offsetParent!==null).pop();
      if(!dl) return {noDialog:true};
      const T=e=>((e&&e.innerText)||'').trim();
      return {
        title:T(dl.querySelector('.ui-dialog-title,.modal-title,.modal-header')),
        rows:[...dl.querySelectorAll('tr.jqgrow')].map(r=>[...r.querySelectorAll('td[title]')].map(td=>td.getAttribute('title')).filter(Boolean)),
        buttons:[...dl.querySelectorAll('button,a.btn')].map(T).filter(Boolean),
      };
    })()"""
    info = await page.evaluate(js)
    print(f"    [dialog:{tag}] {json.dumps(info)[:400]}")
    return info


async def find_order_id(frame):
    txt = await frame.locator("body").first.inner_text()
    m = re.search(r"(?:Customer\s+)?Order\s+N(?:o|umber)\.?\s*[:：]?\s*([A-Z0-9]{6,})", txt, re.I)
    return m.group(1) if m else None


async def main(session_path, headed):
    if headed:
        from inspect_order_entry import _headed_launch_safe
        login_manager._launch_browser_safe = _headed_launch_safe
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
        print("→ click Order"); await frame.locator(".js-orderNow").first.click(); await asyncio.sleep(4)
        await shot(page, "customer_dialog"); await dialog_dump(page, "opened")

        # The top search input is disabled — the real lookup is Advanced Query
        # (>>): pick ID Type, fill IC + name, run query. (Selectors from
        # check_status.py's Advanced Query form.)
        print("→ open Advanced Query (>>)")
        # Visible one (hidden duplicate behind the modal), force-click because the
        # child <img> icon (hover-swaps arr-double-right.svg) intercepts pointer events.
        await frame.locator(".js-advanced-query-btn:visible").first.click(timeout=8000, force=True)
        await asyncio.sleep(2)
        await shot(page, "adv_query"); await dialog_dump(page, "adv_query")

        print("→ select ID Type = MyKad")
        sel = frame.locator('select[name="certTypeId"]:visible, select.js-cert-type-id:visible').first
        if await sel.count():
            try:
                await sel.select_option(label="MyKad", timeout=5000)
            except Exception:
                await sel.select_option(value="1", timeout=5000)
        else:
            trig = frame.locator('.js-cert-type-id-content:visible .btn-group .btn, .js-cert-type-id-content:visible .glyphicon-triangle-bottom').first
            if await trig.count():
                await trig.click(); await asyncio.sleep(1)
                await frame.locator('a:has-text("MyKad"):visible, li:has-text("MyKad"):visible').first.click()

        # Use the VISIBLE fields — certNbr/custName also exist on the (hidden)
        # customer-create form and Read Card.
        print(f"→ fill IC={IC}, name={NAME}, run query")
        await frame.locator('input[name="certNbr"]:visible').first.fill(IC, timeout=8000)
        await frame.locator('input[name="custName"]:visible').first.fill(NAME, timeout=8000)
        await frame.locator("button.js-query:visible").first.click(timeout=8000)
        await asyncio.sleep(6)
        await shot(page, "adv_results"); await dialog_dump(page, "adv_results")

        # Active Subscribers grid. The customer name/IC are MASKED here, but the
        # IC+name+type search returns the single matching customer -> first row.
        grid_rows = frame.locator(".js-customer-result-grid tr.jqgrow")
        n = await grid_rows.count()
        print(f"   active subscriber rows: {n}")
        if n == 0:
            print("   ⚠ no customer rows — see screenshots. Stopping.")
            return
        print("→ double-click the customer row")
        await grid_rows.first.dblclick()
        await asyncio.sleep(3)
        await shot(page, "pii_form"); await dialog_dump(page, "pii_form")

        # PII mandatory-questions form -> tick ALL checkboxes, then Proceed.
        checks = frame.locator('form.js-mandatory-question-form input[name="answerCheck"]')
        cn = await checks.count()
        print(f"→ ticking {cn} PII checkbox(es)")
        for i in range(cn):
            try:
                await checks.nth(i).check(timeout=3000)
            except Exception:
                await checks.nth(i).click(force=True)
        await shot(page, "pii_checked")
        print("→ click Proceed")
        # 'Proceed' is unique to the (topmost) PII dialog — target it directly so
        # we don't hit the Advanced Query dialog's OK button under the backdrop.
        await frame.locator('button:has-text("Proceed"):visible').first.click(timeout=8000)
        await asyncio.sleep(4)
        await shot(page, "after_proceed"); await dialog_dump(page, "after_proceed")

        # New Connection order-detail page: confirm the required Installation Contact.
        await asyncio.sleep(3)
        from oe_feasibility import finalize_install_contact
        print("finalize install contact:", await finalize_install_contact(frame))
        await shot(page, "after_install_contact")

        # Handle any confirm/OK dialog that gates order creation.
        for step in range(3):
            oid = await find_order_id(frame)
            if oid:
                print(f"\n✅ ORDER ID: {oid}"); await shot(page, "order_id"); return
            confirm = frame.locator(
                '.ui-dialog:visible .modal-footer .btn-primary, '
                '.ui-dialog:visible button:has-text("Confirm"), '
                '.ui-dialog:visible button:has-text("OK"), '
                '.ui-dialog:visible button:has-text("Yes")').first
            if await confirm.count() and await confirm.is_visible():
                lbl = (await confirm.inner_text()).strip()
                print(f"   → confirm '{lbl}'"); await confirm.click(); await asyncio.sleep(4)
                await shot(page, f"after_confirm_{step}"); continue
            break

        oid = await find_order_id(frame)
        body = (await frame.locator("body").first.inner_text())[:1500]
        with open(f"logs/order_body_{time.strftime('%H%M%S')}.txt", "w") as fh:
            fh.write(body)
        print(f"\n{'✅ ORDER ID: '+oid if oid else '⚠ no order id captured — see logs/order_body_*.txt + screenshots'}")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess, headed=("--headed" in sys.argv)))

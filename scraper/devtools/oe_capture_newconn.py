"""Self-driving CAPTURE of the New Connection detail page (PDF pages 26+).

Reaches the New Connection page via the proven feasibility -> Order -> attach
tail (reusing the HOR HO HO customer), then walks the operator's 12-step guide,
AUTO-DUMPING the outer HTML + a screenshot of the newest visible dialog after
every action. The dumps give exact selectors so complete_new_connection() can be
written against real DOM instead of guesses.

  python oe_capture_newconn.py <session.json> [--headed]

Env (reuse the same serviceable address/offer as the existing test draft):
  FEAS_STATE, FEAS_ADDRESS_ID | FEAS_ADDRESS_FULL, FEAS_OFFER, FEAS_IC, FEAS_NAME
"""
import asyncio
import json
import os
import sys
import time

import login_manager
import dealer_web_login
from oe_feasibility import (open_feasibility, select_address, select_plan,
                            attach_customer, _open_address_modal, _grid_rows)
from oe_helpers import set_combobox
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry


async def _cancel_customer_popup(page) -> bool:
    """The 'Customer' fuzzy-search popup re-appears after Order and blocks the New
    Connection form. Find any visible dialog whose title contains 'Customer' and
    click its Cancel (data-dismiss / text Cancel), via JS so Playwright selector
    quirks don't matter. Loops a few times in case it re-renders."""
    js = r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
      if(!d) return false;
      const vis = e => e && e.offsetParent !== null;
      for (const dl of [...d.querySelectorAll('.ui-dialog')].filter(vis)) {
        const t = ((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim();
        if (!/customer/i.test(t)) continue;
        const cancel = [...dl.querySelectorAll('button, a.btn')].find(
          b => /cancel/i.test((b.innerText||'').trim()) || b.getAttribute('data-dismiss')==='modal');
        if (cancel) { cancel.click(); return true; }
      }
      return false;
    })()"""
    any_cancelled = False
    for _ in range(4):
        clicked = await page.evaluate(js)
        if not clicked:
            break
        any_cancelled = True
        print("   ↳ cancelled stray Customer popup")
        await asyncio.sleep(1.0)
    return any_cancelled


async def _danger(frame):
    """Return the visible modal-danger message, or None."""
    d = frame.locator(".ui-dialog.modal-danger:visible .modal-message").first
    try:
        if await d.count() and await d.is_visible():
            return (await d.inner_text()).strip()
    except Exception:
        pass
    return None


async def _dismiss_danger(frame):
    try:
        await frame.locator(
            '.ui-dialog.modal-danger:visible .btn-danger, '
            '.ui-dialog.modal-danger:visible button:has-text("OK")'
        ).first.click(timeout=4000)
        await asyncio.sleep(1)
    except Exception:
        pass


async def _try_address_id(frame, ctype, state, address_id) -> str:
    """Open the address modal, select By Address Id, Query, pick the single row,
    OK. Returns 'ok' | 'taken' | 'none' | 'err'."""
    await _open_address_modal(frame); await asyncio.sleep(1.5)
    await set_combobox(frame, "custType", ctype)
    await set_combobox(frame, "state", state)
    await frame.locator("#byAddressId").first.click()
    await frame.locator('input[name="addressId"]').first.fill(str(address_id))
    await frame.locator(".js-address-form .js-query").first.click(); await asyncio.sleep(4)
    rows = await _grid_rows(frame)
    if not rows:
        # close the modal before the next attempt
        await _dismiss_danger(frame)
        return "none"
    await rows[0][0].click()
    await frame.locator(
        '.ui-dialog:has(form.js-address-form) .js-ok, .js-ok').first.click(timeout=8000)
    await asyncio.sleep(3)
    msg = await _danger(frame)
    if msg:
        await _dismiss_danger(frame)
        return "taken" if "already has" in msg.lower() else "err"
    try:
        await frame.locator(".js-offer-grid").first.wait_for(state="visible", timeout=8000)
        return "ok"
    except Exception:
        return "err"


async def _pick_orderable_address(frame, addr) -> bool:
    """Iterate By Address Id over the resolved resourceInstIds until one is
    ORDERABLE (offers load, not 'already has TM services')."""
    state = addr["state"]
    ctype = addr.get("customer_type", "Consumer")
    ids = addr.get("address_ids") or ([addr["address_id"]] if addr.get("address_id") else [])
    if not ids:
        print("   no candidate address ids"); return False
    for i, aid in enumerate(ids):
        r = await _try_address_id(frame, ctype, state, aid)
        print(f"   [{i}] addressId={aid} -> {r}")
        if r == "ok":
            print(f"   ✓ orderable unit: {aid}")
            return True
    return False

IC = os.environ.get("FEAS_IC", "900808076666")
NAME = os.environ.get("FEAS_NAME", "HOR HO HO")
OUT = "logs/newconn"


async def shot(page, tag):
    p = f"{OUT}_{tag}_{time.strftime('%H%M%S')}.png"
    await page.screenshot(path=p, full_page=True)
    print(f"    [shot] {p}")


async def dump(page, tag):
    """Dump EVERY visible real .ui-dialog (popedit inputs excluded) so nested
    dialogs are all captured. Saves each dialog's outerHTML + a JSON summary."""
    js = r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
      if(!d) return {err:'no iframe doc'};
      const vis = e => e && e.offsetParent !== null;
      const T = e => ((e && e.innerText) || '').trim().slice(0,60);
      const dialogs = [...d.querySelectorAll('.ui-dialog, .modal.in, [role="dialog"]')].filter(vis);
      return {
        count: dialogs.length,
        dialogs: dialogs.map(dl => ({
          title: T(dl.querySelector('.ui-dialog-title,.modal-title,.modal-header')),
          cls: dl.className,
          rows: [...dl.querySelectorAll('tr.jqgrow')].slice(0,10)
                  .map(r=>[...r.querySelectorAll('td[title]')].map(td=>td.getAttribute('title')).filter(Boolean)),
          inputs: [...dl.querySelectorAll('input[name],select[name],textarea[name]')].slice(0,40)
                  .map(i=>({name:i.name, type:i.type, role:i.getAttribute('role'), cls:i.className, ph:i.placeholder})),
          buttons: [...dl.querySelectorAll('button, a.btn, span.input-group-addon')].slice(0,40)
                  .map(b=>({t:T(b), cls:b.className})).filter(b=>b.t||b.cls.includes('addon')||b.cls.includes('new-window')),
          html: dl.outerHTML.slice(0, 60000),
        })),
      };
    })()"""
    info = await page.evaluate(js)
    fn = f"{OUT}_{tag}_{time.strftime('%H%M%S')}"
    dialogs = info.get("dialogs", [])
    summary = {"count": info.get("count", 0),
               "dialogs": [{k: v for k, v in dl.items() if k != "html"} for dl in dialogs]}
    with open(fn + ".json", "w") as fh:
        json.dump(summary, fh, indent=2)
    for i, dl in enumerate(dialogs):
        if dl.get("html"):
            with open(f"{fn}_dlg{i}.html", "w") as fh:
                fh.write(dl["html"])
    titles = [f"{dl['title']!r}({len(dl['rows'])}r)" for dl in dialogs]
    print(f"    [dump:{tag}] {info.get('count',0)} dialog(s): {titles}")
    return info


async def step(page, n, desc):
    print(f"\n=== STEP {n}: {desc} ===")
    # Defensive: the Customer popup can re-appear between steps.
    await _cancel_customer_popup(page)


async def main(session_path, headed):
    if headed:
        from inspect_order_entry import _headed_launch_safe
        login_manager._launch_browser_safe = _headed_launch_safe
    os.makedirs("logs", exist_ok=True)
    state = os.environ.get("FEAS_STATE", "SELANGOR").upper()
    street = os.environ.get("FEAS_ADDRESS_FULL", "PERSIARAN SAUJANA PUTRA UTAMA 7")

    # Resolve the street to candidate resourceInstIds via the QryNIGAddress search
    # (the "previous address search"), then iterate By Address Id until orderable.
    ids = [x for x in os.environ.get("FEAS_ADDRESS_IDS", "").split(",") if x]
    if not ids:
        import dealer_address_search as das
        print(f"→ QryNIGAddress search: state={state} value={street!r}")
        sr = await das.search_address(session_path, state=state, value=street, query_by="keyword")
        cands = sr.get("addresses") or []
        print(f"   {sr.get('count')} candidates; trying up to 15")
        ids = [str(a["addressId"]) for a in cands if a.get("addressId")][:15]
    addr = {
        "state": state,
        "customer_type": "Consumer",
        "address_ids": ids,
    }
    plan = {"name": os.environ.get("FEAS_OFFER", "")}
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)

        # ---- reach the New Connection page (proven tail) ----
        await open_feasibility(frame); await asyncio.sleep(2)

        # Address: iterate the serviceable rows until one is ORDERABLE (offers
        # load, no "already has TM services" danger). Prior test orders consumed
        # some SAUJANA PUTRA units, so pick_first hits a taken one.
        if not await _pick_orderable_address(frame, addr):
            await shot(page, "address_exhausted"); await dump(page, "address_exhausted"); return

        # Offers now loaded — take the requested plan or the first row.
        sp = await select_plan(frame, plan)
        print("select_plan:", sp)
        if sp.get("status") != "ok":
            print("   → plan not matched, picking first offer row")
            first_offer = frame.locator(".js-offer-grid tr.jqgrow").first
            if await first_offer.count():
                nm = await first_offer.locator("td[title]").first.get_attribute("title")
                print(f"   first offer = {nm!r}")
                await first_offer.click(); await asyncio.sleep(1)
            else:
                await shot(page, "no_offers"); await dump(page, "no_offers"); return
        print("→ Order"); await frame.locator(".js-orderNow").first.click(); await asyncio.sleep(4)
        r = await attach_customer(frame, IC, NAME, "MyKad")
        print("attach_customer:", r)
        if r.get("status") != "ok":
            await shot(page, "attach_failed"); await dump(page, "attach_failed"); return
        await asyncio.sleep(3)
        # After Order/attach a redundant "Customer" fuzzy-search popup re-appears
        # (title "Customer", only Cancel) and covers the whole form — dismiss it,
        # else every subsequent step clicks through its backdrop.
        await _cancel_customer_popup(page)
        await shot(page, "00_newconn_landed"); await dump(page, "00_newconn_landed")

        # ---- enumerate the sub-product tabs (Bundle/Broadband/Voice/TV) ----
        # The 4th tab (Unifi TV) is hidden behind the tab pager '>' arrow
        # (.ui-tabs-paging-next). Dump each tab's fields (esp. the per-tab
        # js-acct-combobox account field).
        tabjs = r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
          if(!d) return {err:'no doc'};
          return {
            tabs: [...d.querySelectorAll('.ui-tabs-nav li, [role=tab], .nav-tabs li')]
                    .map(t=>((t.innerText||'').trim())).filter(Boolean),
            pager: !!d.querySelector('.ui-tabs-paging-next'),
            acctFields: [...d.querySelectorAll('input[name="acctId"]')]
                    .map(i=>({cls:i.className, val:(i.value||'').slice(0,40), vis:i.offsetParent!==null})),
          };
        })()"""
        print("   tabs:", json.dumps(await page.evaluate(tabjs)))

        # ---- PRODUCTION test: run the real functions instead of the inline steps ----
        if os.environ.get("OE_TEST_PROD"):
            from oe_feasibility import complete_new_connection, fill_subproduct_tabs
            payload = {"customer": {"contact": {"email": "HOHOHO@HH.COM"}}}
            print("\n### complete_new_connection (page 1) ###")
            r1 = await complete_new_connection(page, payload)
            print("   =>", json.dumps(r1)[:400])
            await shot(page, "prod_page1"); await dump(page, "prod_page1")
            print("\n### fill_subproduct_tabs (Broadband/Voice/TV) ###")
            r2 = await fill_subproduct_tabs(page, payload)
            print("   =>", json.dumps(r2)[:600])
            await shot(page, "prod_subtabs"); await dump(page, "prod_subtabs")
            print("\n✅ production test complete")
            return

        # =========================================================
        # 12-step guide — click, then DUMP whatever dialog appears.
        # Selectors are best-guess; the dumps confirm/correct them.
        # =========================================================

        await step(page, 1, "expand Installation Contact")
        # The popedit binds click handlers that a Playwright force-click doesn't
        # fire; dispatch a real click via JS on the expand icon, then (if nothing
        # opened) on the input itself. Report which opened a dialog.
        open1 = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const inp=d.querySelector('input[name="installationContact"]'); if(!inp) return 'noinput';
          const grp=inp.closest('.input-group')||inp.parentElement;
          const icon=grp && [...grp.querySelectorAll('.glyphicon-new-window')].find(vis);
          const before=d.querySelectorAll('.ui-dialog,.modal.in').length;
          const target=(icon&&(icon.closest('.input-group-addon')||icon))||inp;
          target.click();
          return 'clicked:'+(icon?'icon':'input');
        })()""")
        print("   install-contact expand:", open1)
        await asyncio.sleep(1.5)
        # Fallback: if no dialog/modal appeared, click the input directly.
        n = await page.evaluate("""(() => { const d=document.querySelector('#myIframe').contentDocument;
            return d ? d.querySelectorAll('.ui-dialog,.modal.in,[role=dialog]').length : -1; })()""")
        if n == 0:
            await page.evaluate("""(() => { const d=document.querySelector('#myIframe').contentDocument;
                const i=d&&d.querySelector('input[name="installationContact"]'); if(i) i.click(); })()""")
            await asyncio.sleep(1.5)
        await shot(page, "01_addmode"); await dump(page, "01_addmode")

        await step(page, 2, "expand 'Select Existing...' inside Add Mode dialog")
        # Click the visible new-window icon in the TOPMOST dialog (Add Mode) via
        # JS — the child <span> glyph intercepts pointer events, and there are
        # hidden addons elsewhere that a plain locator picks by mistake.
        clicked = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
          const top=dlgs[dlgs.length-1]; if(!top) return 'nodialog';
          const icon=[...top.querySelectorAll('.glyphicon-new-window')].find(vis);
          if(!icon) return 'noicon';
          (icon.closest('.input-group-addon')||icon).click(); return 'clicked';
        })()""")
        print("   select-existing expand:", clicked)
        await asyncio.sleep(2.5)
        await shot(page, "02_selectexisting"); await dump(page, "02_selectexisting")

        await step(page, 3, "click first contact row + OK (Select Existing Contact grid)")
        # Verified DOM: grid=.js-contact-grid, search=input[name=contactManName],
        # OK=.js-btn-ok, Query=.js-btn-qry, Cancel=.js-btn-cancel.
        row = frame.locator('.js-contact-grid tr.jqgrow').first
        try:
            await row.click(timeout=6000)
            await asyncio.sleep(0.6)
        except Exception as e:
            print("   row click failed:", e)
        await dump(page, "03a_rowselected")
        ok1 = frame.locator('.js-contact-grid').locator(
            'xpath=ancestor::div[contains(@class,"ui-dialog")]').locator(
            '.js-btn-ok, button:has-text("OK")').last
        try:
            await ok1.click(timeout=6000)
        except Exception as e:
            print("   OK(grid) failed, trying generic .js-btn-ok:", e)
            try:
                await frame.locator('.ui-dialog:visible .js-btn-ok').last.click(timeout=5000)
            except Exception as e2:
                print("   generic .js-btn-ok failed:", e2)
        await asyncio.sleep(2)
        await shot(page, "03_after_grid_ok"); await dump(page, "03_after_grid_ok")

        await step(page, 4, "OK on Add Mode dialog")
        ok2 = frame.locator('.ui-dialog:visible button:has-text("OK"), '
                            '.ui-dialog:visible .js-ok').last
        try:
            await ok2.click(timeout=6000)
        except Exception as e:
            print("   OK(addmode) failed:", e)
        await asyncio.sleep(2)
        await shot(page, "04_after_addmode_ok"); await dump(page, "04_after_addmode_ok")

        await step(page, 5, "expand Account field")
        acct_input = frame.locator('input[name="acctId"]:not(.js-acct-combobox)').first
        acct_addon = acct_input.locator(
            'xpath=following-sibling::span[contains(@class,"input-group-addon")]').first
        try:
            await acct_addon.click(timeout=6000, force=True)
        except Exception as e:
            print("   acct addon failed:", e)
        await asyncio.sleep(2.5)
        await shot(page, "05_account_info"); await dump(page, "05_account_info")

        await step(page, 6, "click + Add (new account form)")
        addbtn = frame.locator(
            '.ui-dialog:visible a:has-text("Add"), .ui-dialog:visible .js-add, '
            '.ui-dialog:visible :text("+ Add")').first
        try:
            await addbtn.click(timeout=6000)
        except Exception as e:
            print("   +Add failed:", e)
        await asyncio.sleep(2.5)
        await shot(page, "06_add_account"); await dump(page, "06_add_account")

        await step(page, 7, "Account Name = HOR HO HO (rest default)")
        name_field = frame.locator(
            '.ui-dialog:visible input[name="accName"], '
            '.ui-dialog:visible input[name="accountName"], '
            '.ui-dialog:visible input[name="acctName"]').first
        try:
            if await name_field.count():
                await name_field.fill(NAME)
                print("   filled account name")
            else:
                print("   account-name field not matched — see dump 06")
        except Exception as e:
            print("   name fill failed:", e)
        await dump(page, "07_name_filled")

        await step(page, 9, "OK / Save the Add Account form")
        save = frame.locator('.ui-dialog:visible button:has-text("OK"), '
                             '.ui-dialog:visible .js-ok, '
                             '.ui-dialog:visible button:has-text("Save")').last
        try:
            await save.click(timeout=6000)
        except Exception as e:
            print("   save account failed:", e)
        await asyncio.sleep(3)
        await shot(page, "09_after_save_account"); await dump(page, "09_after_save_account")

        await step(page, 10, "dismiss Success -> select account row -> OK")
        # After Add Account saves, a 'Success' dialog sits on top of Account Info.
        # Dismiss it, then pick a row in the Account Info grid and click its .js-ok.
        try:
            await frame.locator(
                '.ui-dialog.modal-success:visible button, '
                '.ui-dialog:visible button:has-text("OK")').first.click(timeout=4000)
            await asyncio.sleep(1.2)
        except Exception as e:
            print("   success-dismiss:", e)
        # Select the last (newest) account row in the Account Info grid.
        arow = frame.locator('.ui-dialog:visible tr.jqgrow').last
        try:
            await arow.click(timeout=6000)
            await asyncio.sleep(0.6)
        except Exception as e:
            print("   acct row click failed:", e)
        # Account Info OK = .js-ok inside the Account Info dialog.
        try:
            await frame.locator('.ui-dialog:visible .js-ok').last.click(timeout=6000)
        except Exception as e:
            print("   OK(account) failed:", e)
        await asyncio.sleep(2)
        await shot(page, "10_after_account_ok"); await dump(page, "10_after_account_ok")

        await step(page, 11, "Winback Tagging = HSBA Wireless Access")
        # Winback is an INLINE ui-combobox-fish on the page (not a dialog). Open its
        # dropdown by clicking the caret in the Winback Tagging form-group via JS,
        # then click the body-appended option.
        opened = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const lbl=[...d.querySelectorAll('label')].find(l=>/winback/i.test(l.title||l.textContent||''));
          if(!lbl) return 'nolabel';
          const grp=lbl.closest('.form-group'); if(!grp) return 'nogroup';
          const caret=grp.querySelector('.ui-combobox-fish .input-group-addon, .input-group-addon');
          const disp=grp.querySelector('input[role="combobox"]');
          (caret||disp).click(); return 'opened';
        })()""")
        print("   winback open:", opened)
        await asyncio.sleep(1)
        try:
            opt = frame.locator('ul.combobox-dropdown:visible li[title="HSBA Wireless Access"]').first
            await opt.click(timeout=6000)
            print("   winback selected")
        except Exception as e:
            print("   winback option click failed:", e)
        await dump(page, "11_winback")
        await shot(page, "11_winback")

        await step(page, 12, "Next  (screenshot only — do NOT click; next page mapped separately)")
        await shot(page, "12_ready_for_next")
        nextbtn = frame.locator('.js-btn-next:visible')
        print("   .js-btn-next present:", await nextbtn.count())

        print("\n✅ capture complete — see logs/newconn_*.{json,html,png}")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") \
        else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess, headed=("--headed" in sys.argv)))

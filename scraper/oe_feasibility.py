"""Feasibility -> order id (production stage functions + orchestrator).

Flow (all selectors verified live via oe_feasibility_dryrun / oe_capture_byaddressid):
  ensure_on_order_entry
  -> open_feasibility            (.js-anonymous-add-survey "Feasibility Check")
  -> select_address             (Select Address modal via the expand icon)
       By Address Id  when a resourceInstId is stored  -> exactly 1 row (exact unit)
       else keyword + EXACT match of the Address column vs the stored full address
       (never rows.first — that picks the wrong unit in a multi-unit building)
  -> select_plan                (inline "Subscription Plan List" .js-offer-grid)
  -> dry_run? STOP with Order-enabled check ; else click .js-orderNow + capture id

Returns dicts, never raises for expected flow errors; InfraError only on lost
session. dry_run=True is the safety gate — it never clicks Order (no order created).
"""
import asyncio
import re

import dealer_web_login
from oe_helpers import set_combobox
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry


# ─────────────────────────────────────────────────────────────────────────────
# Clicking through the portal's busy overlay.
#
# The portal uses jQuery blockUI: while an AJAX call is in flight it lays a
# `.blockUI.ui-widget-overlay.blocking` (and/or a Bootstrap `.modal-backdrop`)
# over everything. Playwright's actionability check still reports the button
# underneath as "visible, enabled and stable", so it tries to click, the overlay
# eats the pointer event, and it retries until the timeout — producing a
# 40-line "intercepts pointer events" dump that says nothing to an agent.
#
# So: wait for the overlay to clear first, and if it never does, click through
# the DOM (a JS .click() dispatches straight to the element and ignores pointer
# interception). Only when BOTH fail is it a real error.
# ─────────────────────────────────────────────────────────────────────────────
_OVERLAY_SEL = ".blockUI, .ui-widget-overlay.blocking, .modal-backdrop.in"


def humanize_error(e) -> str:
    """Turn a raw Playwright failure into one sentence an agent can act on.

    Playwright's timeouts carry a 40-line "Call log:" dump naming CSS selectors
    and retry counts. That is the right thing in a job log and the wrong thing in
    the UI, where it reads as a crash rather than as "the portal was busy". The
    full text is always kept alongside, under `exception`, for debugging.
    """
    text = str(e) or type(e).__name__
    low = text.lower()
    if "intercepts pointer events" in low or "blockui" in low or "modal-backdrop" in low:
        return ("The portal was still busy (its loading overlay was up) and didn't "
                "accept the click. It may be under load — try again in a moment.")
    if "timeout" in low and "exceeded" in low:
        # Name the element it was waiting for, if the selector hints at one.
        what = ("the confirmation dialog" if "js-ok" in low else
                "a portal field" if "locator(" in low else "the portal")
        return (f"Timed out waiting for {what} to respond. The portal may be slow "
                "or the page may have changed — try again.")
    if "target closed" in low or "browser has been closed" in low:
        return "The portal session ended mid-order. Reconnect and try again."
    if "net::" in low or "econnrefused" in low:
        return "Lost the connection to the portal. Check the network and try again."
    # Unrecognised: keep it, but trim the call log so the UI stays readable.
    return text.split("Call log:")[0].strip()[:300] or type(e).__name__


async def _wait_unblocked(frame, timeout_ms: int = 15000) -> bool:
    """Wait until no busy overlay is visible. True if clear, False if it stayed."""
    step, waited = 250, 0
    while waited < timeout_ms:
        try:
            if await frame.locator(_OVERLAY_SEL).filter(visible=True).count() == 0:
                return True
        except Exception:
            return True  # can't inspect it — let the caller try the click
        await asyncio.sleep(step / 1000)
        waited += step
    return False


async def _click_dialog_ok(frame, page, timeout_ms: int = 8000) -> dict:
    """OK the topmost visible dialog, tolerating the busy overlay.

    Returns {"status": "ok", "how": "click"|"js"} or {"status": "error", ...}
    with a message written for a human, not a stack trace.
    """
    sel = '.ui-dialog:visible .js-ok, .ui-dialog:visible button:has-text("OK")'
    cleared = await _wait_unblocked(frame)
    try:
        await frame.locator(sel).last.click(timeout=timeout_ms)
        return {"status": "ok", "how": "click"}
    except Exception:
        pass

    # Fall back to a direct DOM click — immune to pointer-event interception.
    clicked = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return 'nodialog';
      const b=dl.querySelector('.js-ok')
        || [...dl.querySelectorAll('button, a.btn')].find(x=>/^ok$/i.test((x.innerText||'').trim()));
      if(!b) return 'nobutton'; b.click(); return 'ok';
    })()""")
    if clicked == "ok":
        return {"status": "ok", "how": "js"}

    # Both paths failed — say WHY in the portal's own terms.
    if not cleared:
        msg = ("The portal stayed busy (loading overlay never cleared) and wouldn't "
               "accept the OK click. It may be under load — try again in a moment.")
    elif clicked == "nodialog":
        msg = "The dialog closed before it could be confirmed."
    else:
        msg = f"Couldn't confirm the dialog (OK button: {clicked})."
    return {"status": "error", "message": msg}


async def open_feasibility(frame) -> dict:
    btn = frame.locator(".js-anonymous-add-survey").first
    await btn.wait_for(state="visible", timeout=45000)
    await btn.click()
    return {"status": "ok", "stage": "open_feasibility"}


async def _open_address_modal(frame):
    # The modal opens via the expand icon (glyphicon-new-window), NOT .js-address-pop.
    await frame.locator('input[name="installationAddress"]').first.wait_for(
        state="attached", timeout=30000)
    await frame.locator(
        '.js-address-pop span.input-group-addon:has(.glyphicon-new-window)'
    ).first.click(timeout=8000, force=True)


async def _grid_rows(frame):
    """Return [(row_locator, [td titles...]), ...] for the address results grid."""
    rows = frame.locator(".js-address-grid tr.jqgrow")
    n = await rows.count()
    out = []
    for i in range(n):
        tds = rows.nth(i).locator("td[title]")
        titles = []
        for j in range(await tds.count()):
            t = ((await tds.nth(j).get_attribute("title")) or "").strip()
            if t:
                titles.append(t)
        out.append((rows.nth(i), titles))
    return out


async def select_address(frame, addr: dict) -> dict:
    """addr: {state, customer_type?, address_id?, address_full?, keywords?}."""
    await _open_address_modal(frame)
    await asyncio.sleep(1.5)
    await set_combobox(frame, "custType", addr.get("customer_type", "Consumer"))
    # The Select-Address state combobox options are UPPERCASE ("SELANGOR"); the
    # BizzFlow draft may store title-case ("Selangor"), so normalise here.
    await set_combobox(frame, "state", (addr["state"] or "").upper())

    address_id = addr.get("address_id")
    if address_id:
        await frame.locator("#byAddressId").first.click()
        await frame.locator('input[name="addressId"]').first.fill(str(address_id))
    else:
        kw = addr.get("keywords") or addr.get("address_full") or ""
        if not kw:
            return {"status": "error", "error": "address_missing",
                    "stage": "select_address", "message": "No address_id or keywords."}
        await frame.locator("#byKeywords").first.click()
        await frame.locator('input[name="keywords"]').first.fill(kw)

    await frame.locator(".js-address-form .js-query").first.click()
    await asyncio.sleep(5)

    rows = await _grid_rows(frame)
    if not rows:
        return {"status": "error", "error": "address_not_found",
                "stage": "select_address", "message": "No serviceable address returned."}

    if address_id:
        target = rows[0][0]  # By Address Id returns exactly one row.
    elif addr.get("pick_first"):
        # Capture/dev only: any serviceable row is fine (exact unit doesn't matter
        # when we just need to reach the New Connection page). NEVER set in prod.
        target = rows[0][0]
    else:
        want = (addr.get("address_full") or addr.get("keywords") or "").strip().upper()
        target = None
        for loc, titles in rows:
            if any(t.strip().upper() == want and len(t) > 20 for t in titles):
                target = loc
                break
        if target is None:
            return {"status": "error", "error": "address_not_matched",
                    "stage": "select_address",
                    "message": f"None of {len(rows)} rows' Address == stored address."}

    await target.click()
    await frame.locator(
        '.ui-dialog:has(form.js-address-form) .js-ok, .js-ok'
    ).first.click(timeout=8000)
    await asyncio.sleep(3)
    return {"status": "ok", "stage": "select_address", "candidates": len(rows)}


async def select_plan(frame, plan: dict) -> dict:
    """plan: {name}. Offers are INLINE in .js-offer-grid (no Main Offer modal).
    Matching is case/space-insensitive; on a miss we log the offers the address
    ACTUALLY serves so the mismatch is obvious (the draft package must match one
    of the serviceable offers for the picked address)."""
    await frame.locator(".js-offer-grid").first.wait_for(state="visible", timeout=20000)
    name = plan["name"]
    row = frame.locator(f'.js-offer-grid tr.jqgrow:has(td[title="{name}"])').first
    if await row.count() == 0:
        row = frame.locator(f'.js-offer-grid tr.jqgrow:has(td[title*="{name}"])').first
    if await row.count() == 0:
        # Case/whitespace-insensitive match against the actual offer titles.
        picked = await frame.page.evaluate(r"""((want) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return {i:-1,offers:[]};
          const norm=s=>(s||'').replace(/\s+/g,' ').trim().toLowerCase();
          const w=norm(want);
          const rows=[...d.querySelectorAll('.js-offer-grid tr.jqgrow')];
          const offers=rows.map(r=>{const td=[...r.querySelectorAll('td[title]')].find(t=>(t.getAttribute('title')||'').length>8);return td?td.getAttribute('title'):'';}).filter(Boolean);
          // Exact, else an offer that CONTAINS the wanted name. Do NOT match the
          // other direction (want.includes(offer)) — that grabs a shorter, wrong
          // offer (e.g. plain "Unifi Home 300Mbps" when we want the with-device
          // bundle), which lands us on an offer with no device/tabs.
          let idx=offers.findIndex(o=>norm(o)===w);
          if(idx<0) idx=offers.findIndex(o=>norm(o).includes(w));
          if(idx>=0) rows[idx].click();
          return {i:idx, offers:offers.slice(0,25)};
        })""", name)
        if picked.get("i", -1) < 0:
            print(f"  ⚠ offer '{name}' not found. Address serves: {picked.get('offers')}", flush=True)
            return {"status": "error", "error": "offer_not_found", "stage": "select_plan",
                    "message": f"Plan '{name}' not serviceable here. Available: {picked.get('offers')}"}
        await asyncio.sleep(1)
        return {"status": "ok", "stage": "select_plan"}
    await row.click()
    await asyncio.sleep(1)
    return {"status": "ok", "stage": "select_plan"}


async def _capture_order_id(frame) -> str | None:
    """After Order is clicked, read the 'Customer Order Number' from the header."""
    import re
    for _ in range(20):
        txt = await frame.locator("body").first.inner_text()
        m = re.search(r"(?:Customer\s+)?Order\s+N(?:o|umber)\.?\s*[:：]?\s*([A-Z0-9]{6,})", txt, re.I)
        if m:
            return m.group(1)
        await asyncio.sleep(1)
    return None


async def attach_customer(frame, ic: str, name: str, id_type: str = "MyKad") -> dict:
    """Customer dialog (after Order) -> Advanced Query: pick ID Type, fill IC +
    name, Query, double-click the customer row, tick the PII mandatory-question
    checkboxes, Proceed. Retries the search — a just-created customer can take a
    moment to become searchable. Verified selectors (iframe->>form/active-subs/
    checkbox-form)."""
    # Open Advanced Query (>>); its child <img> intercepts clicks -> force.
    await frame.locator(".js-advanced-query-btn:visible").first.click(timeout=8000, force=True)
    await asyncio.sleep(2)

    # ID Type (native <select> or a custom combobox fallback).
    sel = frame.locator('select[name="certTypeId"]:visible, select.js-cert-type-id:visible').first
    if await sel.count():
        try:
            await sel.select_option(label=id_type, timeout=5000)
        except Exception:
            await sel.select_option(value="1", timeout=5000)  # 1 = MyKad
    else:
        trig = frame.locator('.js-cert-type-id-content:visible .btn-group .btn, .js-cert-type-id-content:visible .glyphicon-triangle-bottom').first
        if await trig.count():
            await trig.click(); await asyncio.sleep(1)
            await frame.locator(f'a:has-text("{id_type}"):visible, li:has-text("{id_type}"):visible').first.click()

    rows = frame.locator(".js-customer-result-grid tr.jqgrow")
    n = 0
    for _ in range(6):
        await frame.locator('input[name="certNbr"]:visible').first.fill(ic, timeout=8000)
        await frame.locator('input[name="custName"]:visible').first.fill(name, timeout=8000)
        await frame.locator("button.js-query:visible").first.click(timeout=8000)
        await asyncio.sleep(5)
        n = await rows.count()
        if n:
            break
        await asyncio.sleep(3)  # let a just-created customer propagate, then retry
    if not n:
        return {"status": "error", "error": "customer_not_found", "stage": "attach_customer",
                "message": f"Customer {ic} not searchable after create."}

    await rows.first.dblclick()  # IC+name+type search returns the single customer
    await asyncio.sleep(3)

    # PII mandatory-questions form -> tick ALL -> Proceed.
    checks = frame.locator('form.js-mandatory-question-form input[name="answerCheck"]')
    for i in range(await checks.count()):
        try:
            await checks.nth(i).check(timeout=3000)
        except Exception:
            await checks.nth(i).click(force=True)
    # 'Proceed' is unique to the topmost PII dialog.
    await frame.locator('button:has-text("Proceed"):visible').first.click(timeout=8000)
    await asyncio.sleep(4)
    return {"status": "ok", "stage": "attach_customer"}


async def finalize_install_contact(frame) -> dict:
    """On the New Connection order-detail page, confirm the required Installation
    Contact: click its pop-edit expand icon, then OK. Scoped to .js-contact-info
    so it's not the Maintenance Contact field. Best-effort — skips if absent."""
    exp = frame.locator('.js-contact-info span.input-group-addon:has(.glyphicon-new-window)').first
    try:
        if await exp.count() == 0:
            return {"status": "ok", "note": "no install-contact expand — skipped"}
        await exp.click(timeout=8000, force=True)
        await asyncio.sleep(2)
        await frame.locator('.ui-dialog:visible .js-ok, .js-ok:visible').first.click(timeout=8000)
        await asyncio.sleep(2)
        return {"status": "ok", "stage": "finalize_install_contact"}
    except Exception as e:  # non-fatal — the order id is already minted
        return {"status": "ok", "note": f"install-contact confirm skipped: {str(e)[:80]}"}


async def run_feasibility(page, payload: dict, dry_run: bool = True,
                          continue_to_submit: bool = False, do_pay: bool = False,
                          im_paths: list = None, id_paths: list = None,
                          on_stage=None) -> dict:
    def stage(n):
        if on_stage:
            try: on_stage(n)
            except Exception: pass

    await ensure_on_order_entry(page)
    frame = _frame(page)

    r = await open_feasibility(frame)
    if r["status"] != "ok":
        return r
    await asyncio.sleep(2)

    # Each step below is reported so a failure names the step it happened on.
    # Emission is additive — it must never change what the portal flow does.
    stage("checking_address")
    r = await select_address(frame, payload["address"])
    if r["status"] != "ok":
        return r

    stage("checking_plan")
    r = await select_plan(frame, payload["plan"])
    if r["status"] != "ok":
        return r

    stage("placing_order")
    order_btn = frame.locator(".js-orderNow").first
    order_ready = (await order_btn.is_enabled()) if await order_btn.count() else False

    if dry_run:
        # SAFETY GATE: never click Order on a dry-run.
        return {"status": "dry_run", "order_ready": order_ready,
                "stage": "feasibility_dry_run",
                "message": "Address + plan selected; Order button "
                           + ("ENABLED — ready to mint order id." if order_ready
                              else "NOT enabled.")}

    if not order_ready:
        return {"status": "error", "error": "order_not_ready", "stage": "click_order"}
    await order_btn.click()
    await asyncio.sleep(4)

    # Order is customer-first: attach the (already-created) customer by IC.
    cust = payload.get("customer", {})
    ic = cust.get("id_number")
    if ic:
        stage("attaching_customer")
        r = await attach_customer(frame, ic, cust.get("name", ""), cust.get("id_type", "MyKad"))
        if r["status"] != "ok":
            return r

    stage("capturing_order_no")
    await asyncio.sleep(3)  # let the New Connection order-detail page render
    order_id = await _capture_order_id(frame)
    if not order_id:
        return {"status": "error", "error": "order_id_not_found", "stage": "capture_order_id"}

    if not continue_to_submit:
        # Legacy path: confirm install contact + stop at the minted order id.
        await finalize_install_contact(frame)
        return {"status": "success", "order_id": order_id, "stage": "order_id",
                "order_url": _order_detail_url(order_id)}

    # Full path: drive the whole New Connection detail flow -> Pay/Submit.
    await cancel_customer_popup(page)
    sub = await submit_new_connection(page, payload, im_paths=im_paths,
                                      id_paths=id_paths, do_pay=do_pay, on_stage=on_stage)
    sub.setdefault("order_id", order_id)
    sub.setdefault("order_url", _order_detail_url(sub.get("order_id") or order_id))
    return sub


async def enter_feasibility(payload: dict, dry_run: bool = True, user_key: str = None) -> dict:
    """Public entry: open the user's saved dealer session and run the flow."""
    import dealer_login_service
    session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        return await run_feasibility(page, payload, dry_run=dry_run)
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


async def _capture_dialog_message(page) -> str | None:
    """Read the topmost VISIBLE portal dialog's text (Error/Warning/Success popup)
    so a raw exception can be replaced with the real popup message. Read-only."""
    try:
        return await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return null;
          const title=((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim();
          const body=((dl.querySelector('.modal-message,.modal-body')||dl).innerText||'').replace(/\s+/g,' ').trim();
          // Prefer the body message; fall back to the title. Cap length.
          const msg=(body && body.length>title.length ? body : (title||body)).slice(0, 300);
          return msg || null;
        })()""")
    except Exception:
        return None


async def enter_full_order(payload: dict, user_key: str = None, dry_run: bool = False,
                           submit: bool = True, do_pay: bool = False,
                           on_stage=None) -> dict:
    """The full per-order flow in ONE dealer session:
        create the customer profile -> feasibility -> Order -> attach -> order id
        -> New Connection detail (contact/account/winback/device/sub-tabs/
           attachments/appointment/delivery) -> Terms -> Pay/Submit

    `submit` drives the New Connection detail flow after the order id is minted;
    `do_pay` gates the real, billable Pay click (do_pay=False stops at the Pay
    page and returns status 'ready_to_pay'). `dry_run` stops even earlier (before
    Order). on_stage(name) fires at each milestone for live status. Returns
    {status:'submitted', order_id, order_url, advance_payment} on a real submit, or
    a return-not-raise error whose `message` carries the portal popup text (device
    rejection, address-taken, …) so BizzFlow can surface it and let the agent edit
    the draft and resubmit with fresh data.
    """
    import dealer_login_service
    from order_entry import create_personal_customer

    def stage(name):
        if on_stage:
            try:
                on_stage(name)
            except Exception:
                pass

    # Download the required attachments (IM Conversation + ID copy) from R2.
    im_paths, id_paths = [], []
    if submit and not dry_run:
        try:
            import r2_download
            cust = payload.get("customer", {}) or {}
            im_keys = cust.get("im_doc_keys") or []
            id_keys = cust.get("id_doc_keys") or []
            if im_keys:
                im_paths = r2_download.download_many(im_keys)
            if id_keys:
                id_paths = r2_download.download_many(id_keys)
        except Exception as e:
            return {"status": "error", "error": "doc_download_failed",
                    "stage": "documents", "message": f"R2 download: {e}"}

    session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)

        # Stage 1 — create the customer profile for real.
        stage("creating_customer")
        r = await create_personal_customer(frame, payload["customer"], fill_only=False)
        # A clean create returns status="ok" (from _await_customer_create_result);
        # a customer whose IC is already in the CRM returns the
        # "multiple_customer_records" warning. BOTH mean the customer now exists and
        # can be attached in feasibility — the reuse path (re-running a test draft
        # doesn't re-fill order details, so the same name/IC/address is reusable).
        # Anything else (data incomplete / validation / stage error) is fatal.
        customer_existed = r.get("error") == "multiple_customer_records"
        if r.get("status") not in ("ok", "success") and not customer_existed:
            return r
        stage("order_entered")

        # Stage 2 — feasibility -> Order -> attach -> order id -> (submit ->
        # New Connection detail -> Pay/Submit). run_feasibility re-navigates to
        # Order Entry via ensure_on_order_entry, so the create screen is left clean.
        stage("feasibility")
        result = await run_feasibility(
            page, payload, dry_run=dry_run,
            continue_to_submit=(submit and not dry_run), do_pay=do_pay,
            im_paths=im_paths, id_paths=id_paths, on_stage=on_stage)
        if result.get("status") in ("submitted", "success"):
            stage("submitted")
        result["customer_created"] = not customer_existed
        result["customer_existed"] = customer_existed
        return result
    except Exception as e:
        # A step threw (e.g. a combobox couldn't open) — often because a portal
        # Error/Warning popup is covering the form. Capture THAT popup's text and
        # return it as the status, instead of the raw Playwright error, so the
        # agent sees the real reason (e.g. "…already exists in the system.").
        import traceback
        traceback.print_exc()  # full traceback -> job log for debugging
        popup = await _capture_dialog_message(page) if page is not None else None
        # Prefer the portal's own popup text; otherwise a humanised summary. The
        # verbatim exception still rides along for the job log.
        return {"status": "error", "stage": "order_entry",
                "error": "portal_error" if popup else "exception",
                "message": popup or humanize_error(e),
                "exception": f"{type(e).__name__}: {e}"}
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


# ─────────────────────────────────────────────────────────────────────────────
# New Connection detail page 1 (after the order id is minted)  — VERIFIED live
# via oe_capture_newconn.py.  Sets Installation Contact (Select Existing), picks
# an existing billing Account (no create), and Winback Tagging (Home bundles).
# Stops BEFORE Next.  All popedit/combobox triggers use JS .click() because the
# jQuery popedit handlers don't fire on a Playwright force-click.
# ─────────────────────────────────────────────────────────────────────────────
async def cancel_customer_popup(page) -> bool:
    """After Order/attach a redundant 'Customer' fuzzy-search popup re-appears and
    covers the New Connection form. Cancel any visible dialog whose title matches
    /customer/i. Loops a few times in case it re-renders. Safe — the order is
    already created (the account field is already populated)."""
    js = r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return false;
      const vis=e=>e&&e.offsetParent!==null;
      for (const dl of [...d.querySelectorAll('.ui-dialog')].filter(vis)) {
        const t=((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim();
        if(!/customer/i.test(t)) continue;
        const c=[...dl.querySelectorAll('button, a.btn')].find(
          b=>/cancel/i.test((b.innerText||'').trim()) || b.getAttribute('data-dismiss')==='modal');
        if(c){c.click(); return true;}
      }
      return false;
    })()"""
    any_cancelled = False
    for _ in range(4):
        if not await page.evaluate(js):
            break
        any_cancelled = True
        await asyncio.sleep(1.0)
    return any_cancelled


async def _js_click_new_window(page, input_name) -> str:
    """JS-click the expand (glyphicon-new-window) icon next to input[name=<name>]."""
    return await page.evaluate(
        """(name) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const inp=d.querySelector('input[name="'+name+'"]'); if(!inp) return 'noinput';
          const grp=inp.closest('.input-group')||inp.parentElement;
          const icon=grp && [...grp.querySelectorAll('.glyphicon-new-window')].find(vis);
          const target=(icon&&(icon.closest('.input-group-addon')||icon))||inp;
          target.click(); return 'ok';
        }""", input_name)


async def _js_click_top_dialog_new_window(page) -> str:
    """JS-click the visible new-window icon in the TOPMOST visible dialog."""
    return await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
      const top=dlgs[dlgs.length-1]; if(!top) return 'nodialog';
      const icon=[...top.querySelectorAll('.glyphicon-new-window')].find(vis);
      if(!icon) return 'noicon';
      (icon.closest('.input-group-addon')||icon).click(); return 'ok';
    })()""")


async def set_installation_contact(frame, page) -> dict:
    """Installation Contact -> Add Mode dialog -> expand Select Existing -> pick
    the first contact row -> OK (grid) -> OK (Add Mode)."""
    r = await _js_click_new_window(page, "installationContact")
    if r == "noinput":
        return {"status": "skipped", "stage": "install_contact",
                "message": "no installationContact field on this offer"}
    if r != "ok":
        return {"status": "error", "error": "install_contact_expand_failed",
                "stage": "install_contact", "message": r}
    # Wait for the Add Mode dialog to actually render before expanding Select
    # Existing (a fixed sleep races a slow dialog).
    addmode = frame.locator(".ui-dialog:visible")
    for _ in range(20):
        if await addmode.count():
            break
        await asyncio.sleep(0.3)
    await asyncio.sleep(0.8)
    # Expand the "Select Existing..." field, retrying until the grid appears.
    grid_row = frame.locator(".js-contact-grid tr.jqgrow").first
    for attempt in range(4):
        await _js_click_top_dialog_new_window(page)
        try:
            await grid_row.wait_for(state="visible", timeout=5000)
            break
        except Exception:
            if attempt == 3:
                return {"status": "error", "error": "select_existing_grid_not_found",
                        "stage": "install_contact",
                        "message": "Select Existing Contact grid did not appear."}
            await asyncio.sleep(1)
    await grid_row.click()
    await asyncio.sleep(0.5)
    await frame.locator('.ui-dialog:visible .js-btn-ok').last.click(timeout=8000)
    await asyncio.sleep(1.5)
    # Add Mode dialog OK (its OK is a generic .js-ok / button OK).
    try:
        await frame.locator('.ui-dialog:visible .js-ok, '
                            '.ui-dialog:visible button:has-text("OK")').last.click(timeout=6000)
    except Exception:
        pass
    await asyncio.sleep(1.5)
    return {"status": "ok", "stage": "install_contact"}


async def create_billing_account(frame, page, acct_name: str = "") -> dict:
    """Create a NEW billing account per order. VERIFIED simple sequence (with
    GENEROUS waits — rushing makes the Reason/Success popups stack and one gets
    left open, covering page-1): open Account Infomation dialog -> '+ Add' -> fill
    Account Name -> OK the Add Account form -> the "Reason" popup appears -> OK ->
    final OK. The account then applies and every dialog closes. Skips cleanly when
    the offer has no account field."""
    acct_input = frame.locator('input[name="acctId"]:not(.js-acct-combobox)').first
    if not await acct_input.count():
        return {"status": "skipped", "stage": "account", "note": "no account field"}
    addon = acct_input.locator(
        'xpath=following-sibling::span[contains(@class,"input-group-addon")]').first
    try:
        await addon.click(timeout=6000, force=True)
    except Exception:
        await _js_click_new_window(page, "acctId")
    await asyncio.sleep(3)

    # '+ Add' -> Add Account form.
    added = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis).pop(); if(!dl) return 'nodialog';
      const add=[...dl.querySelectorAll('a,span,button')].filter(vis)
        .find(x=>/^\+?\s*add$/i.test((x.innerText||'').trim()));
      if(!add) return 'noadd'; add.click(); return 'ok';
    })()""")
    if added != "ok":
        # No +Add — fall back to selecting the existing/auto account row + OK.
        row = frame.locator('.ui-dialog:visible tr.jqgrow').first
        if await row.count():
            await row.click(); await asyncio.sleep(0.5)
        try:
            await frame.locator('.ui-dialog:visible .js-ok, '
                                '.ui-dialog:visible button:has-text("OK")').last.click(timeout=5000)
        except Exception:
            pass
        await asyncio.sleep(2)
        return {"status": "ok", "stage": "account", "note": f"no add ({added}); selected existing"}
    await asyncio.sleep(3.5)  # let the Add Account FORM fully render

    # Fill Account Name (the VISIBLE form field), then OK the form.
    name_inp = frame.locator('input[name="acctName"]:visible').first
    if await name_inp.count() and acct_name:
        await name_inp.fill(acct_name, timeout=5000)
    await asyncio.sleep(2)
    await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return;
      const vis=e=>e&&e.offsetParent!==null;
      const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis).pop(); if(!dl) return;
      const b=[...dl.querySelectorAll('button,a.btn')].filter(vis)
        .find(x=>/^(ok|save)$/i.test((x.innerText||'').trim())) || dl.querySelector('.js-ok');
      if(b) b.click();
    })()""")
    await asyncio.sleep(3.5)  # let the "Reason" popup appear

    # OK the follow-up popups (Reason, then Confirm/Success) — ONE at a time with a
    # generous wait so the next fully renders before we click. Do NOT OK the Account
    # LIST here (that's handled last, so the account is applied not cancelled).
    for _ in range(3):
        clicked = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis).pop(); if(!dl) return 'none';
          if(dl.querySelector('tr.jqgrow')) return 'list';  // account list — leave for last
          const b=[...dl.querySelectorAll('button,a.btn')].find(x=>/^(ok|yes)$/i.test((x.innerText||'').trim()));
          if(b){ b.click(); return 'ok'; }
          return 'nobtn';
        })()""")
        if clicked in ("list", "none", "nobtn", "nodoc"):
            break
        await asyncio.sleep(3)  # generous — don't rush the next popup

    # Finally apply + close the Account Infomation list if it's still open: select
    # the newest row + OK. Verify NO dialog remains (else it covers page-1).
    closed = False
    for _ in range(4):
        if await frame.locator('.ui-dialog:visible').count() == 0:
            closed = True
            break
        rows = frame.locator('.ui-dialog:visible tr.jqgrow')
        m = await rows.count()
        if m:
            try:
                await rows.nth(m - 1).click(timeout=3000)
                await asyncio.sleep(0.6)
            except Exception:
                pass
        try:
            await frame.locator('.ui-dialog:visible .js-ok, '
                                '.ui-dialog:visible button:has-text("OK")').last.click(timeout=5000)
        except Exception:
            pass
        await asyncio.sleep(2.5)
    return {"status": "ok", "stage": "account", "created": True, "closed": closed}


async def set_winback_tagging(frame, page, value: str = "HSBA Wireless Access") -> dict:
    """Winback Tagging inline combobox (Home bundles only — absent on Business
    offers). Returns status 'skipped' if the field isn't present."""
    # Look for the Winback field FIRST (retry a few times — the page may still be
    # settling), and only skip if it genuinely isn't there. Open its combobox.
    opened = "nolabel"
    for _ in range(6):
        opened = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const lbl=[...d.querySelectorAll('label')].find(l=>/winback/i.test(l.title||l.textContent||''));
          if(!lbl) return 'nolabel';
          const grp=lbl.closest('.form-group'); if(!grp) return 'nogroup';
          const caret=grp.querySelector('.ui-combobox-fish .input-group-addon, .input-group-addon');
          const disp=grp.querySelector('input[role="combobox"]');
          (caret||disp).click(); return 'opened';
        })()""")
        if opened == "opened":
            break
        await asyncio.sleep(0.5)
    # Field genuinely absent (e.g. Unifi Home 100Mbps PrimePromo has no Winback) OR
    # can't open → SKIP, never block the flow (fields differ per offer; don't lock).
    if opened != "opened":
        return {"status": "skipped", "stage": "winback", "message": f"winback not applicable ({opened})"}
    await asyncio.sleep(1)
    try:
        await frame.locator(
            f'ul.combobox-dropdown:visible li[title="{value}"]').first.click(timeout=6000)
    except Exception as e:
        return {"status": "skipped", "stage": "winback",
                "message": f"winback option '{value}' not found ({type(e).__name__})"}
    await asyncio.sleep(0.5)
    return {"status": "ok", "stage": "winback"}


async def complete_new_connection(page, payload: dict = None, on_stage=None) -> dict:
    """New Connection page 1: Installation Contact + NEW billing Account + Winback.
    Stops before Next. Fields differ per offer — each step skips cleanly if its
    field is absent. Returns {status:'ok'|'error', steps:{...}}."""
    def stage(n):
        if on_stage:
            try: on_stage(n)
            except Exception: pass

    frame = _frame(page)
    await cancel_customer_popup(page)
    payload = payload or {}
    cust = payload.get("customer", {}) or {}
    acct_name = cust.get("name") or (cust.get("contact", {}) or {}).get("name", "") or ""

    steps = {}
    await cancel_customer_popup(page)
    stage("installation_contact")
    steps["install_contact"] = await set_installation_contact(frame, page)
    await cancel_customer_popup(page)
    stage("billing_account")
    steps["account"] = await create_billing_account(frame, page, acct_name)
    await cancel_customer_popup(page)
    stage("winback_tagging")
    steps["winback"] = await set_winback_tagging(frame, page)

    for name, r in steps.items():
        if r.get("status") not in ("ok", "skipped"):
            return {"status": "error", "stage": r.get("stage", name),
                    "error": r.get("error"), "message": r.get("message"), "steps": steps}
    return {"status": "ok", "stage": "new_connection_page1", "steps": steps}


# ─────────────────────────────────────────────────────────────────────────────
# Sub-product tabs (Broadband / Voice / TV) — each needs its own Installation
# Contact + Service Number.  Broadband/TV: type a username + Check.  Voice: pick
# an available number via the 3-dots -> Query -> confirm -> first cell -> OK.
# Selectors from order-2..5.html; the voice post-query grid is verified live.
# ─────────────────────────────────────────────────────────────────────────────
import random as _random


def _service_username(email: str) -> str:
    """email-local-part (before @, uppercased) + 3 random digits — a unique-ish
    broadband/TV service username (random digits dodge 'already taken')."""
    local = (email or "user").split("@")[0]
    local = "".join(ch for ch in local if ch.isalnum()).upper() or "USER"
    return f"{local}{_random.randint(100, 999)}"


async def _active_subproduct_panel(frame):
    """The visible sub-product tab panel (jQuery UI tab body currently shown)."""
    return frame.locator('.ui-tabs-panel:visible, .tab-pane.active:visible').last


async def _set_service_number_username(frame, page, email: str) -> dict:
    """Broadband/TV: type the username into the active tab's Service Number
    (input[name=accNbr]) then click its Check button (.js-search-number)."""
    uname = _service_username(email)
    fld = frame.locator('input[name="accNbr"]:visible:not([readonly])').last
    try:
        await fld.click(timeout=6000)
        await fld.fill(uname, timeout=6000)
    except Exception as e:
        return {"status": "error", "error": "service_number_fill_failed",
                "stage": "service_number", "message": f"{uname}: {e}"}
    try:
        await frame.locator('button.js-search-number:visible').last.click(timeout=6000)
    except Exception as e:
        return {"status": "error", "error": "service_check_failed",
                "stage": "service_number", "message": str(e)}
    await asyncio.sleep(2)
    return {"status": "ok", "stage": "service_number", "username": uname}


async def _pick_voice_number(frame, page) -> dict:
    """Voice: 3-dots -> Query -> confirm popup OK -> first number cell -> OK."""
    # Open the Select-Number popup via the 3-dots on the visible accNbr field.
    opened = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dots=[...d.querySelectorAll('span.icon-option-horizontal')].filter(vis);
      if(!dots.length) return 'nodots';
      dots[dots.length-1].click(); return 'ok';
    })()""")
    if opened != "ok":
        return {"status": "error", "error": "voice_dots_failed", "stage": "voice_number", "message": opened}
    await asyncio.sleep(2)
    # Query all available numbers (no condition).
    try:
        await frame.locator(
            'button.js-search-whp-number:visible, .ui-dialog:visible button:has-text("Query")'
        ).last.click(timeout=8000)
    except Exception as e:
        return {"status": "error", "error": "voice_query_failed", "stage": "voice_number", "message": str(e)}
    await asyncio.sleep(2)
    # Confirm popup: "It will take a bit long time … continue?" -> OK.
    try:
        await frame.locator(
            '.ui-dialog:visible button:has-text("OK"), .ui-dialog:visible .btn-primary'
        ).last.click(timeout=6000)
    except Exception:
        pass
    # The number query is slow — WAIT for the `.number-card`s to actually render
    # (clicking before they load is why the number didn't stick).
    card = frame.locator('.ui-dialog:visible .number-card').first
    try:
        await card.wait_for(state="visible", timeout=25000)
    except Exception:
        return {"status": "error", "error": "voice_no_numbers", "stage": "voice_number",
                "message": "number cards did not load after Query"}
    # The selection handler fires on `.number-card` with a REAL Playwright click (a
    # JS click doesn't add the `selected` class). Click + verify it's selected;
    # retry a couple of cards if the first doesn't take.
    selected = False
    for i in range(3):
        try:
            await frame.locator('.ui-dialog:visible .number-card').nth(i).click(timeout=6000)
            await asyncio.sleep(0.6)
        except Exception:
            continue
        if await frame.locator('.ui-dialog:visible .number-card.selected').count() > 0:
            selected = True
            break
    if not selected:
        return {"status": "error", "error": "voice_number_not_selected",
                "stage": "voice_number", "message": "no number card became 'selected'"}
    ok = await _click_dialog_ok(frame, page, timeout_ms=6000)
    if ok["status"] != "ok":
        return {"status": "error", "error": "voice_ok_failed", "stage": "voice_number",
                "message": f"Confirming the voice number failed. {ok['message']}"}
    await asyncio.sleep(2)
    return {"status": "ok", "stage": "voice_number"}


async def _subproduct_tabs(frame):
    """[(index, text, locator)] for the sub-product tab headers (offer tabs),
    excluding the top-level Subscriber/Account/... tabs."""
    anchors = frame.locator('.ui-tabs-nav .ui-tabs-anchor')
    out = []
    for i in range(await anchors.count()):
        txt = ((await anchors.nth(i).inner_text()) or "").strip()
        if any(k in txt for k in ("Broadband", "Voice", "TV", "Bundle")):
            out.append((i, txt, anchors.nth(i)))
    return out


async def fill_subproduct_tabs(page, payload: dict, on_stage=None) -> dict:
    """Fill Broadband / Voice / TV tabs (Bundle already done on page 1). Reveals
    the 4th (TV) tab via the pager. Returns {status, tabs:{...}}."""
    def stage(n):
        if on_stage:
            try: on_stage(n)
            except Exception: pass

    frame = _frame(page)
    email = (payload.get("customer", {}).get("contact", {}) or {}).get("email", "") if payload else ""
    results = {}
    # Reveal all tabs by paging right if a pager exists.
    for _ in range(4):
        pager = frame.locator('.ui-tabs-paging-next:visible, .glyphicon-chevron-right:visible').first
        if await pager.count() and await pager.is_visible():
            try:
                await pager.click(timeout=3000); await asyncio.sleep(0.8)
            except Exception:
                break
        else:
            break
    tabs = await _subproduct_tabs(frame)
    for idx, txt, loc in tabs:
        if "Bundle" in txt:
            continue  # done on page 1
        # Switch tabs via a JS click on the anchor. The TV tab hides behind the
        # tab-pager, so a Playwright click (which requires visibility) times out;
        # a JS .click() fires the jQuery-UI tab activation regardless of whether
        # the anchor is scrolled into the visible pager window.
        switched = await page.evaluate(r"""((txt) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const anchors=[...d.querySelectorAll('.ui-tabs-nav .ui-tabs-anchor')];
          const a=anchors.find(x=>(x.innerText||'').trim()===txt)
               || anchors.find(x=>(x.innerText||'').includes(txt));
          if(!a) return 'notab'; a.click(); return 'ok';
        })""", txt)
        if switched != "ok":
            results[txt] = {"tab_switch": switched}
            continue
        await asyncio.sleep(2)
        await cancel_customer_popup(page)
        # Install Contact is a SHARED field at the top of the page (set on page 1),
        # not per-tab — only set it if it's still empty.
        ic_val = await frame.locator(
            'input[name="installationContact"]').first.input_value()
        if ic_val.strip():
            ic = {"status": "ok", "stage": "install_contact", "note": "already set"}
        else:
            ic = await set_installation_contact(frame, page)
        # Service number.
        if "Voice" in txt:
            sn = await _pick_voice_number(frame, page)
        else:
            sn = await _set_service_number_username(frame, page, email)
        results[txt] = {"install_contact": ic.get("status"), "service_number": sn}
        if sn.get("status") != "ok":
            return {"status": "error", "stage": "subproduct_tab",
                    "tab": txt, "message": sn.get("message"), "tabs": results}
        # Device selection lives on the BROADBAND tab only (verified live) — its
        # "Select Offer" opens the 126-row device picker. Voice/TV have no device.
        if "Broadband" in txt:
            stage("selecting_device")
            dev = await select_device(page, payload)
            results[txt]["device"] = dev
            if dev.get("status") not in ("ok", "skipped"):
                return {"status": "error", "stage": "device", "tab": txt,
                        "error": dev.get("error"), "message": dev.get("message"),
                        "tabs": results}
    return {"status": "ok", "stage": "subproduct_tabs", "tabs": results}


# ─────────────────────────────────────────────────────────────────────────────
# Device selection (any with-device offer MUST go through this) — VERIFIED live
# via oe_interactive.  The active tab's "Select Offer" section has an Add button;
# clicking it opens an "Offer" dialog (a jqGrid of ~126 device rows).  Each row's
# first td[title] is the offer code  O-<deviceCode>-<groupId>  — <deviceCode>
# matches src/lib/dealer-devices.ts.  Rejections are per-device AND per-account
# (surface, don't retry blindly).
# ─────────────────────────────────────────────────────────────────────────────
async def _dismiss_popup_ok(frame, page, exclude_title_re=r"offer") -> str | None:
    """If a Warning/Error dialog is up (NOT the given one, e.g. the Offer picker),
    read its message, click its OK, and return the message. Else None."""
    msg = await page.evaluate(r"""((excl) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
      const vis=e=>e&&e.offsetParent!==null;
      const rx=new RegExp(excl,'i');
      const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
      for(const dl of dlgs.reverse()){
        const t=((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim();
        if(rx.test(t)) continue;
        if(/warn|error|danger|prompt|confirm/i.test(dl.className)||/warn|error/i.test(t)){
          const m=((dl.querySelector('.modal-message,.modal-body')||dl).innerText||'').replace(/\s+/g,' ').trim();
          const ok=[...dl.querySelectorAll('button,a.btn')].find(b=>/^ok$/i.test((b.innerText||'').trim()))
                 ||dl.querySelector('.btn-danger,.btn-primary');
          if(ok){ok.click(); return m.slice(0,200)||'(dismissed)';}
        }
      }
      return null;
    })""", exclude_title_re)
    return msg


async def _dismiss_success_popups(frame, page, tries: int = 8) -> int:
    """Close ALL open 'Succeed in uploading attachment' / Success info popups.
    These are NOT warn/error dialogs, so `_dismiss_popup_ok` skips them — each file
    upload stacks its own Success popup, so with 3 docs you get 3 popups. Sweep them
    all (repeatedly, since they can appear a beat after the upload), clicking OK.
    Leaves warn/error/appointment/offer/form dialogs untouched. Returns count closed."""
    closed = 0
    for _ in range(tries):
        n = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 0;
          const vis=e=>e&&e.offsetParent!==null;
          const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
          let hit=0;
          for(const dl of dlgs){
            const t=((dl.querySelector('.ui-dialog-title,.modal-title')||{}).innerText||'').trim();
            const body=((dl.querySelector('.modal-message,.modal-body')||dl).innerText||'').replace(/\s+/g,' ').trim();
            if(/warn|error|danger/i.test(dl.className)||/warn|error/i.test(t)) continue; // not ours
            const isSuccess=/^\s*success\s*$/i.test(t)
                          || /succeed in uploading|uploaded successfully|upload success|上传成功/i.test(body)
                          || /modal-success/i.test(dl.className);
            if(!isSuccess) continue;
            const ok=[...dl.querySelectorAll('button,a.btn')]
                       .find(b=>/^\s*(ok|close|confirm|确定)\s*$/i.test((b.innerText||'').trim()))
                   || dl.querySelector('.modal-footer .btn, .ui-dialog-buttonpane button');
            if(ok){ ok.click(); hit++; }
          }
          return hit;
        })()""")
        closed += (n or 0)
        if not n:
            break
        await asyncio.sleep(0.5)
    return closed


async def select_device(page, payload: dict) -> dict:
    """Open Select Offer -> Add -> Offer dialog, tick the device matching the
    order's deviceCode (offer code O-<code>-...) or deviceName, dismiss any
    per-device rejection popup (return error with the portal message), then OK.
    No-op (status 'skipped') when the order carries no device."""
    frame = _frame(page)
    dev_code = str(payload.get("deviceCode") or payload.get("device_code") or "").strip()
    dev_name = (payload.get("deviceName") or payload.get("device_name") or "").strip()
    if not dev_code and not dev_name:
        return {"status": "skipped", "stage": "device", "message": "no device on order"}

    # Click the Add that belongs to "Select Offer" (there's also an Order-Comments
    # Add). Scope by walking up for a "Select Offer" label.
    opened = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const adds=[...d.querySelectorAll('span.add.js-add, .js-add')].filter(vis);
      let target=null;
      for(const a of adds){ let p=a;
        for(let i=0;i<6&&p;i++){ if(/select\s*offer/i.test(p.innerText||'')){target=a;break;} p=p.parentElement; }
        if(target) break; }
      const el=target||adds[0]; if(!el) return 'noadd'; el.click(); return target?'ok':'fallback';
    })()""")
    if opened in ("nodoc", "noadd"):
        return {"status": "error", "error": "select_offer_add_not_found",
                "stage": "device", "message": opened}
    await asyncio.sleep(2)

    # Offer dialog: the jqGrid of device rows.
    dlg = frame.locator('.ui-dialog:visible').last
    try:
        await dlg.locator('tr.jqgrow').first.wait_for(state="visible", timeout=15000)
    except Exception:
        return {"status": "error", "error": "offer_dialog_no_rows",
                "stage": "device", "message": "Offer dialog did not populate."}

    # Find the row by offer code (td[title^="O-<code>-"]) first, else by device name.
    ticked = await page.evaluate(r"""(([code, name]) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dlgs=[...d.querySelectorAll('.ui-dialog')].filter(vis);
      const dl=dlgs[dlgs.length-1]; if(!dl) return 'nodialog';
      const rows=[...dl.querySelectorAll('tr.jqgrow')];
      const norm=s=>(s||'').replace(/\s+/g,' ').trim().toLowerCase();
      let row=null;
      if(code){ row=rows.find(r=>[...r.querySelectorAll('td[title]')].some(td=>
        (td.getAttribute('title')||'').startsWith('O-'+code+'-'))); }
      if(!row && name){ const n=norm(name);
        row=rows.find(r=>norm(r.innerText).includes(n))
          || rows.find(r=>{const t=norm(r.innerText); return n.split(' ').filter(w=>w.length>3).every(w=>t.includes(w));}); }
      if(!row) return 'notfound';
      const cb=row.querySelector('input[type=checkbox]');
      if(!cb) return 'nocheckbox';  // rows without a checkbox aren't selectable
      // NEVER touch pre-ticked items (e.g. "Promo Discount RM10 (Perpetual)") —
      // only tick our target if it isn't already ticked (a 2nd click would untick).
      if(cb.checked) return 'already';
      cb.click(); return 'ticked';
    })""", [dev_code, dev_name])
    if ticked == "notfound":
        return {"status": "error", "error": "device_not_in_offer_list",
                "stage": "device", "message": f"code={dev_code} name={dev_name!r} not in Offer list."}
    if ticked == "nocheckbox":
        return {"status": "error", "error": "device_not_selectable",
                "stage": "device", "message": f"{dev_name or dev_code} has no checkbox (not orderable)."}
    if ticked == "already":
        # Already selected — just OK the dialog (don't re-click / untick).
        try:
            await frame.locator('.ui-dialog:visible .js-ok, '
                                '.ui-dialog:visible button:has-text("OK")').last.click(timeout=8000)
        except Exception:
            pass
        return {"status": "ok", "stage": "device", "device": dev_name or dev_code, "note": "already ticked"}
    if ticked != "ticked":
        return {"status": "error", "error": "device_tick_failed", "stage": "device", "message": ticked}

    # A rejection popup can appear immediately or after a beat.
    await asyncio.sleep(1.5)
    rej = await _dismiss_popup_ok(frame, page, exclude_title_re=r"offer")
    if rej:
        return {"status": "error", "error": "device_rejected", "stage": "device",
                "message": rej, "device": dev_name or dev_code}

    # OK the Offer dialog. Ticking the device fires an AJAX price refresh, so the
    # busy overlay is very often still up at this exact moment — this is the click
    # that produced the "intercepts pointer events" timeouts.
    ok = await _click_dialog_ok(frame, page)
    if ok["status"] != "ok":
        return {"status": "error", "error": "device_ok_failed", "stage": "device",
                "message": f"Confirming the device selection failed. {ok['message']}",
                "device": dev_name or dev_code}
    await asyncio.sleep(2)
    # A rejection can also surface only after OK.
    rej = await _dismiss_popup_ok(frame, page, exclude_title_re=r"offer")
    if rej:
        return {"status": "error", "error": "device_rejected", "stage": "device",
                "message": rej, "device": dev_name or dev_code}
    return {"status": "ok", "stage": "device", "device": dev_name or dev_code}


async def click_next_newconn(page, expect_sel: str = None, timeout_ms: int = 20000) -> dict:
    """Click the New Connection Next (.js-btn-next). A "Subscription … incomplete"
    Warning may pop — dismiss it and report. Optionally wait for expect_sel to
    appear (the next page's landmark)."""
    frame = _frame(page)
    # JS-click the Next button — it is often scrolled out of the viewport (a
    # Playwright click then times out as "element is outside of the viewport").
    clicked = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const b=[...d.querySelectorAll('.js-btn-next')].filter(vis).pop();
      if(!b) return 'nonext'; b.click(); return 'ok';
    })()""")
    if clicked != "ok":
        return {"status": "error", "error": "next_click_failed", "message": clicked}
    await asyncio.sleep(3)
    warn = await _dismiss_popup_ok(frame, page, exclude_title_re=r"$^")
    if warn:
        return {"status": "warning", "stage": "next", "message": warn}
    if expect_sel:
        try:
            await frame.locator(expect_sel).first.wait_for(state="visible", timeout=timeout_ms)
        except Exception:
            return {"status": "error", "error": "next_page_not_reached",
                    "stage": "next", "message": f"expected {expect_sel}"}
    return {"status": "ok", "stage": "next"}


# ─────────────────────────────────────────────────────────────────────────────
# Customer Order Information page (after the sub-tabs Next) — attachments (IM +
# ID split across containers), appointment (earliest >12h), Default From Billing
# Address, contact number/email, "Has confirmed the order" gate.  Selectors
# mapped live 2026-08-04; the ID-copy option value + appointment dialog are
# finalized on the first watched run (marked TODO-VERIFY).
# ─────────────────────────────────────────────────────────────────────────────
async def _set_attach_file(page, container_key: str, local_path) -> str:
    """Set files on the hidden <input type=file> inside the attachment container
    with the given key (Playwright set_input_files — the upload icon only triggers
    the same input). Dismisses the 'Succeed in uploading attachment' Success popup
    that fires after each upload."""
    frame = _frame(page)
    inp = frame.locator(
        f'.js-attchment-container[key="{container_key}"] input[type=file].js-file-upload').first
    if not await inp.count():
        inp = frame.locator('input[type=file].js-file-upload').last
    # The container/input can still be rendering — wait for it to attach before
    # setting the file, and give set_input_files a longer grace window.
    try:
        await inp.wait_for(state="attached", timeout=30000)
    except Exception:
        pass
    await inp.set_input_files(local_path, timeout=30000)
    await asyncio.sleep(2)
    await _dismiss_success_popups(frame, page)  # close the upload "Success" popup(s)
    return "set"


async def _select_attach_type(page, container_key: str, label_re: str) -> str:
    """Open the attachType combobox in the given container and pick the option
    whose text matches label_re (e.g. 'id\\s*copy')."""
    return await page.evaluate(r"""(([key, rx]) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const cont=[...d.querySelectorAll('.js-attchment-container')].find(c=>c.getAttribute('key')===key)
              || [...d.querySelectorAll('.js-attchment-container')].filter(vis).pop();
      if(!cont) return 'nocontainer';
      const combo=cont.querySelector('.ui-combobox-fish input[role=combobox], input.js-attachType, input[name=attachType]');
      if(!combo) return 'nocombo';
      combo.removeAttribute('disabled'); combo.click();
      return 'opened';
    })""", container_key, label_re)


async def fill_customer_order_info(page, payload: dict,
                                   im_paths: list = None, id_paths: list = None,
                                   on_stage=None) -> dict:
    """Fill the Customer Order Information page. im_paths/id_paths are local files
    (downloaded from R2). IM Conversation goes in container 1 (locked type); each
    ID file gets its own container with Attachment Type = 'ID copy'."""
    def stage(n):
        if on_stage:
            try: on_stage(n)
            except Exception: pass

    frame = _frame(page)
    im_paths = im_paths or []
    id_paths = id_paths or []
    steps = {}

    # The Customer Order Information page is AJAX-heavy and can still be rendering
    # when we arrive from Next — grabbing the file input too early fails the upload.
    # Wait for the attachments block (container 1 = the always-present locked IM
    # Conversation slot, or its hidden file input) to actually render, then settle.
    try:
        await frame.locator(
            '.js-attchment-container[key="1"], input[type=file].js-file-upload'
        ).first.wait_for(state="attached", timeout=45000)
    except Exception:
        pass
    await asyncio.sleep(2.5)  # let the page finish laying out before we touch fields

    # ── Attachments ──────────────────────────────────────────────────────────
    stage("uploading_attachments")
    # Container 1 is locked to IM Conversation. Set the IM file there.
    if im_paths:
        try:
            await _set_attach_file(page, "1", im_paths[0])
            steps["im_attach"] = "ok"
        except Exception as e:
            return {"status": "error", "error": "im_attach_failed",
                    "stage": "attachments", "message": str(e)}
    # Each ID file: '+ Add' (new container) -> Attachment Type 'ID copy' -> file.
    for i, idp in enumerate(id_paths):
        # The Attachment '+ Add' (`.js-order-add-icon`) needs a REAL Playwright
        # click (a JS .click() does not add a container).
        add = frame.locator(
            '.oe-order-preview-title .js-order-add-icon, '
            '.js-attachment-list .js-order-add-icon').first
        if not await add.count():
            add = frame.locator('.js-attachment-list .js-add').last
        if not await add.count():
            steps[f"id_attach_{i}"] = "skipped: no attachment Add"
            continue
        try:
            await add.click(timeout=6000)
        except Exception as e:
            return {"status": "error", "error": "attach_add_failed",
                    "stage": "attachments", "message": f"id#{i}: {e}"}
        await asyncio.sleep(1.5)
        key = str(i + 2)  # container 1 = IM, so ID files start at key 2
        # Open the new container's Attachment Type dropdown via its CARET (the
        # display input doesn't open it) and pick "ID copy" (attachType 15001).
        caret = frame.locator(
            f'.js-attchment-container[key="{key}"] '
            '.input-group-addon:has(.glyphicon-triangle-bottom)').first
        try:
            await caret.click(timeout=5000)
            await asyncio.sleep(0.6)
            await frame.locator(
                'ul.combobox-dropdown:visible li[title="ID copy"]').first.click(timeout=5000)
        except Exception:
            try:
                await frame.locator('ul.combobox-dropdown:visible li'
                                    ).filter(has_text="ID copy").first.click(timeout=4000)
            except Exception:
                pass
        await asyncio.sleep(0.5)
        try:
            await _set_attach_file(page, key, idp)
            steps[f"id_attach_{i}"] = "ok"
        except Exception as e:
            return {"status": "error", "error": "id_attach_failed",
                    "stage": "attachments", "message": f"id#{i}: {e}"}

    # ── Appointment (earliest available slot > 12h) ──────────────────────────
    stage("appointment")
    appt = await _set_appointment(page)
    steps["appointment"] = appt.get("status")
    if appt.get("status") not in ("ok", "skipped"):
        return {"status": "error", "error": "appointment_failed",
                "stage": "appointment", "message": appt.get("message"), "steps": steps}

    # ── Delivery details + order confirmation ────────────────────────────────
    stage("delivery_terms")
    # ── Default From Billing Address (check -> "Enter Address" popup -> OK) ────
    # The popup is a plain form dialog (NOT warn/error), so _dismiss_popup_ok
    # won't touch it — explicitly OK the "Enter Address" dialog (its fields are
    # pre-filled from the billing address).
    try:
        cb = frame.locator('input[name="defaultBillingAddress"]').first
        if await cb.count() and not await cb.is_checked():
            await cb.check(timeout=5000)
            await asyncio.sleep(1.5)
            await page.evaluate(r"""(() => {
              const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return;
              const vis=e=>e&&e.offsetParent!==null;
              const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis)
                .find(x=>/Enter Address/i.test(((x.querySelector('.modal-title,.ui-dialog-title')||{}).innerText)||''));
              if(dl){ const ok=[...dl.querySelectorAll('button,a.btn')].find(b=>/^ok$/i.test((b.innerText||'').trim())); if(ok) ok.click(); }
            })()""")
            await asyncio.sleep(1)
        steps["billing_addr"] = "ok" if await cb.count() else "skipped"
    except Exception as e:
        steps["billing_addr"] = f"skipped: {str(e)[:60]}"

    # ── Delivery Phone (areaCode + number) + Email — the EDITABLE delivery fields
    # (the greyed Contact Number/Email name_<id> attrs are DISABLED display only).
    # mobilePhone is `disabled` by default; force-enable + set value. Skip-if-absent.
    contact = (payload.get("customer", {}).get("contact", {}) or {})
    area = contact.get("mobile_prefix", "60") or "60"
    number = re.sub(r"\D", "", contact.get("mobile", "") or "")
    email = contact.get("email", "")
    steps["contacts"] = await page.evaluate(r"""(([area, number, email]) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const set=(name,val)=>{const el=d.querySelector('input[name='+name+']');
        if(!el) return false; if(val){el.removeAttribute('disabled'); el.disabled=false; el.value=val;
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          el.dispatchEvent(new Event('blur',{bubbles:true}));} return true;};
      const a=set('mobileAreaCode',area), p=set('mobilePhone',number), e=set('email',email);
      return (a||p||e) ? 'ok' : 'skipped';
    })""", [area, number, email])

    # ── Has confirmed the order with customer (iCheck widget — click the WRAPPER;
    # the hidden input is off-viewport for a normal click). Skip-if-absent. ──
    steps["confirm"] = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const s=d.querySelector('input[name=sure]'); if(!s) return 'skipped';
      if(s.checked) return 'already';
      const wrap=s.closest('div[class*=icheckbox]'); const helper=wrap&&wrap.querySelector('.iCheck-helper');
      (helper||wrap||s).click(); return s.checked ? 'ok' : 'clicked';
    })()""")

    return {"status": "ok", "stage": "customer_order_info", "steps": steps}


# JS that reads the Appointment FullCalendar's REAL available slots. Events are
# absolutely positioned by pixel (not nested in day cells), so each event's
# (left,top) is matched to the day cell that contains it to recover its date.
# Returns ascending "YYYY-MM-DD HH:MM:SS" slots strictly more than 12h from now.
_APPT_SLOTS_JS = r"""(() => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return [];
  const vis=e=>e&&e.offsetParent!==null;
  const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis)
    .find(x=>/Appointment/i.test(((x.querySelector('.modal-title,.ui-dialog-title')||{}).innerText)||''));
  if(!dl) return [];
  const days=[...dl.querySelectorAll('.fc-day[data-date]')].map(c=>{const r=c.getBoundingClientRect();
    return {date:c.getAttribute('data-date'), l:r.left, r:r.right, t:r.top, b:r.bottom};});
  const slots=[...dl.querySelectorAll('.fc-event')].filter(vis).map(ev=>{
    const r=ev.getBoundingClientRect(); const cx=r.left+2, cy=r.top+2;
    const day=days.find(dd=>cx>=dd.l-2 && cx<dd.r && cy>=dd.t-2 && cy<dd.b+30);
    const tm=(ev.innerText||'').match(/(\d{2}:\d{2}:\d{2})/);
    return (day && tm) ? (day.date+' '+tm[1]) : null;
  }).filter(Boolean);
  const cutoff=Date.now()+12*3600*1000;  // earliest appointment = 12h from submission
  return [...new Set(slots)].filter(s=>{const dt=new Date(s.replace(' ','T')); return dt.getTime()>cutoff;}).sort();
})()"""


async def _set_appointment(page) -> dict:
    """Appointment: Add (`.js-add-date`) -> Appointment dialog (a FullCalendar).
    Read the REAL available slots off the calendar, then for each (earliest first)
    **Playwright-fill** `firstPreferredDatetime` — a JS `.value=` does NOT register
    with the datetimepicker widget; a Playwright fill does — and click OK. If the
    portal warns "Please select at least appointment" (the slot wasn't accepted),
    try the next. Skips cleanly if already booked or no appointment control.

    NB: do NOT gate on `input[name=appointment]` — that's the Installation-Type
    flag ('B' = By-appointment), NOT a booked slot; the real "already booked"
    signal is the "You have an appointment already." warning after clicking Add.

    LOCAL TEST: with OE_MANUAL_APPOINTMENT=1 the auto-pick is skipped and the flow
    PAUSES so you can pick the appointment by hand in the headed window; it resumes
    after OE_APPOINTMENT_WAIT seconds (default 150) or when you `touch
    scraper/logs/appt_ready`.
    """
    import os as _os
    frame = _frame(page)

    # Sweep any leftover upload "Success" popups so they don't cover the calendar
    # (auto) or sit on screen during the manual pick.
    await _dismiss_success_popups(frame, page)

    if _os.environ.get("OE_MANUAL_APPOINTMENT") == "1":
        wait_s = int(_os.environ.get("OE_APPOINTMENT_WAIT", "150"))
        signal = "logs/appt_ready"
        try:
            if _os.path.exists(signal):
                _os.remove(signal)
        except Exception:
            pass
        print(f"  ⏸ MANUAL APPOINTMENT — pick it in the window NOW. Waiting up to "
              f"{wait_s}s (or `touch scraper/{signal}` to continue).", flush=True)
        for _ in range(max(1, wait_s // 3)):
            if _os.path.exists(signal):
                try: _os.remove(signal)
                except Exception: pass
                break
            await asyncio.sleep(3)
        return {"status": "ok", "stage": "appointment", "note": "manual (paused for user)"}
    # Open the date dialog. JS-click — the Add link can be scrolled out of the
    # viewport (a Playwright click would time out as "outside of viewport").
    opened = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const b=[...d.querySelectorAll('.js-add-date')].filter(vis)[0];
      if(!b) return 'noadd'; b.click(); return 'ok';
    })()""")
    if opened == "noadd":
        return {"status": "skipped", "stage": "appointment", "note": "no appointment control"}
    await asyncio.sleep(3)
    warn = await _dismiss_popup_ok(frame, page, exclude_title_re=r"appoint")
    if warn and re.search(r"already", warn, re.I):
        return {"status": "skipped", "stage": "appointment", "note": warn}

    slots = await page.evaluate(_APPT_SLOTS_JS)
    if not slots:
        return {"status": "error", "stage": "appointment",
                "message": "no available slots found in the calendar"}

    fdt = frame.locator('.ui-dialog:visible input[name="firstPreferredDatetime"]').first
    for cand in slots[:10]:
        try:
            await fdt.fill(cand, timeout=5000)  # Playwright fill registers with the picker
        except Exception:
            continue
        await asyncio.sleep(0.5)
        try:
            await frame.locator('.ui-dialog:visible .js-ok, '
                                '.ui-dialog:visible button:has-text("OK")').last.click(timeout=6000)
        except Exception:
            pass
        await asyncio.sleep(1.8)
        w = await _dismiss_popup_ok(frame, page, exclude_title_re=r"appoint|enter address")
        if w and re.search(r"select at least|not available|invalid|please", w, re.I):
            continue  # slot not accepted — Appointment dialog stays open, try next
        if await frame.locator(
                '.ui-dialog:visible:has(input[name="firstPreferredDatetime"])').count() == 0:
            return {"status": "ok", "stage": "appointment", "slot": cand}
    return {"status": "error", "stage": "appointment",
            "message": f"no calendar slot accepted (tried {len(slots[:10])})"}


# ─────────────────────────────────────────────────────────────────────────────
# Pay / Submit tail — Next -> Next -> PAY -> Next -> "Submit Successfully /
# Order Number".  PAY is a real, billable click, GATED behind do_pay=True; with
# do_pay=False the flow stops at the Pay page and returns status 'ready_to_pay'.
# Pay-page + intermediate-page selectors are finalized on the first watched run
# (TODO-VERIFY).
# ─────────────────────────────────────────────────────────────────────────────
def _order_detail_url(order_id: str) -> str:
    """The canonical portal order-detail URL (same one check_status.py hits). The
    success page URL itself is NOT order-specific, so we derive this from the id."""
    return ("https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails"
            f"?custOrderId={order_id}&custOrderNbr={order_id}")


async def _find_submit_result(frame) -> dict | None:
    """Read a 'Submit Successfully / Order Number: <id>' confirmation if present.
    Order Number uses a Chinese full-width colon (：) on the portal. Derives the
    portal OrderDetails URL from the id."""
    txt = await frame.locator("body").first.inner_text()
    if not re.search(r"submit\s*success", txt, re.I):
        return None
    m = re.search(r"Order\s*N(?:o|umber)\.?\s*[:：]?\s*([A-Z0-9]{8,})", txt, re.I)
    oid = m.group(1) if m else None
    return {"order_id": oid,
            "order_url": _order_detail_url(oid) if oid else None}


async def _ensure_bypass_acknowledge(page):
    """On the Terms & Conditions page, make sure 'Bypass Acknowledge' is checked
    (it's default-checked; this is defensive). iCheck-safe. No-op elsewhere."""
    await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return;
      const lbl=[...d.querySelectorAll('label, span')].find(e=>/bypass\s*acknowledge/i.test(e.innerText||''));
      if(!lbl) return;
      const grp=lbl.closest('.form-group, .checkbox, div') || lbl.parentElement;
      const cb=grp && grp.querySelector('input[type=checkbox]');
      if(cb && !cb.checked){ const wrap=cb.closest('div[class*=icheckbox]');
        const helper=wrap&&wrap.querySelector('.iCheck-helper'); (helper||wrap||cb).click(); }
    })()""")


async def _read_advance_payment(frame) -> str | None:
    """Read the 'Advance Payment' RM amount off the Pay-page fee preview (record it;
    AP/deposit is NOT an error)."""
    txt = await frame.locator("body").first.inner_text()
    m = re.search(r"Advance\s*Paym\w*[^0-9]*RM\s*([0-9.,]+)", txt, re.I)
    return m.group(1) if m else None


async def pay_and_submit(page, do_pay: bool = False, max_next: int = 4) -> dict:
    """From the Customer Order Information page: Next through Terms & Conditions
    (Bypass Acknowledge is default-checked) to the Pay page; then (if do_pay) Pay
    and Next to the 'Submit Successfully' page. Returns {status:'ready_to_pay',
    advance_payment} when gated, or {status:'submitted', order_id, order_url,
    advance_payment} after a real submit."""
    frame = _frame(page)

    # Advance until a Pay button is visible (Customer Order Info -> T&C -> Pay).
    pay_loc = frame.locator(
        '.js-btn-pay:visible, .js-pay:visible, button:has-text("Pay"):visible')
    for step in range(max_next):
        if await pay_loc.count():
            break
        await _ensure_bypass_acknowledge(page)  # no-op unless on the T&C page
        nx = await click_next_newconn(page)
        if nx.get("status") == "error":
            return {"status": "error", "stage": "pay_tail",
                    "message": f"Next#{step}: {nx.get('message')}"}
        await asyncio.sleep(2)
    if not await pay_loc.count():
        return {"status": "error", "error": "pay_button_not_found", "stage": "pay_tail",
                "message": f"No Pay button after {max_next} Next clicks."}

    advance_payment = await _read_advance_payment(frame)

    if not do_pay:
        # SAFETY GATE — stop before the billable click.
        return {"status": "ready_to_pay", "stage": "pay_gate",
                "advance_payment": advance_payment,
                "message": "Reached Pay page; do_pay=False so NOT submitting."}

    await pay_loc.first.click(timeout=8000)
    await asyncio.sleep(3)
    # Dismiss only a payment-confirm prompt — NOT the success page.
    await _dismiss_popup_ok(frame, page, exclude_title_re=r"success")
    # Pay -> order-accepted summary -> Next -> "Submit Successfully".
    for _ in range(3):
        res = await _find_submit_result(frame)
        if res:
            return {"status": "submitted", "stage": "done",
                    "advance_payment": advance_payment, **res}
        try:
            await frame.locator('.js-btn-next:visible, button:has-text("Next"):visible'
                                ).last.click(timeout=6000)
            await asyncio.sleep(3)
        except Exception:
            break
    res = await _find_submit_result(frame)
    if res:
        return {"status": "submitted", "stage": "done",
                "advance_payment": advance_payment, **res}
    return {"status": "error", "error": "submit_result_not_found", "stage": "pay_tail",
            "message": "Clicked Pay but no 'Submit Successfully' confirmation captured."}


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator: the whole New Connection detail flow after the order id is minted.
# ─────────────────────────────────────────────────────────────────────────────
async def submit_new_connection(page, payload: dict, im_paths: list = None,
                                id_paths: list = None, do_pay: bool = False,
                                on_stage=None) -> dict:
    """page1 (contact/account/winback) -> device -> sub-tabs -> Next ->
    Customer Order Information -> Pay/Submit (gated). Returns the pay_and_submit
    result on success, or the first failing stage's error."""
    def stage(n):
        print(f"  ▶ submit_new_connection stage: {n}", flush=True)
        if on_stage:
            try: on_stage(n)
            except Exception: pass

    stage("new_connection_page1")
    r = await complete_new_connection(page, payload, on_stage=on_stage)
    print(f"    ↳ page1: {r}", flush=True)
    if r.get("status") != "ok":
        return r

    # Sub-tabs (Broadband/Voice/TV). Device selection happens INSIDE this step, on
    # the Broadband tab (fill_subproduct_tabs calls select_device there).
    stage("subproduct_tabs")
    r = await fill_subproduct_tabs(page, payload, on_stage=on_stage)
    print(f"    ↳ subproduct_tabs: {r}", flush=True)
    if r.get("status") != "ok":
        return r

    stage("customer_order_info")
    nx = await click_next_newconn(page)
    print(f"    ↳ next->order_info: {nx}", flush=True)
    # A warning here (e.g. "Please select one offer in … Smart Device group") means
    # Next did NOT advance — surface it as the error instead of blindly proceeding
    # into the attachment page (which then fails with a cryptic file-input timeout).
    if nx.get("status") != "ok":
        return {"status": "error", "stage": "customer_order_info",
                "error": nx.get("error", "next_blocked"),
                "message": nx.get("message", "Next did not advance to Customer Order Information.")}
    r = await fill_customer_order_info(page, payload, im_paths=im_paths,
                                       id_paths=id_paths, on_stage=on_stage)
    print(f"    ↳ customer_order_info: {r}", flush=True)
    if r.get("status") != "ok":
        return r

    stage("pay")
    r = await pay_and_submit(page, do_pay=do_pay)
    print(f"    ↳ pay_and_submit: {r}", flush=True)
    return r


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
import json
import os
import re

import dealer_web_login
from appointment_policy import choose_slot, describe_read_failure
from oe_errors import DEVICE_OUT_OF_STOCK, UNKNOWN_ERROR, map_error, portal_code
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


def _stage_emitter(on_stage):
    """Build the stage(name, detail=None) reporter used by every orchestrator.

    `detail` is a small JSON-safe dict — {"value": str, "outcome": ..., "note": ...}
    — carrying what the portal actually resolved, so the checklist can say *which*
    address matched rather than just that an address step ran.

    Older BizzFlow builds pass a name-only callback, and the scraper (droplet) and
    BizzFlow (Vercel) deploy separately, so a 2-arg call must fall back to the
    1-arg form instead of crashing a live submit. Reporting is additive: any
    failure here is swallowed, it must never change what the portal flow does.
    """
    def stage(name, detail=None):
        if not on_stage:
            return
        try:
            on_stage(name, detail)
            return
        except TypeError:
            pass  # name-only callback — retry below
        except Exception:
            return
        try:
            on_stage(name)
        except Exception:
            pass
    return stage


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


def _contact_name(row_text: str) -> str:
    """First non-empty cell of a contact grid row — the contact's name.

    jqGrid renders a row as tab/newline separated cells; the name leads. Falls
    back to the whole row trimmed so a layout change degrades to something
    readable rather than to an empty label.
    """
    parts = [p.strip() for p in re.split(r"[\t\n]+", row_text or "") if p.strip()]
    return parts[0] if parts else (row_text or "").strip()


def _detail(value, outcome: str = "ok", note: str = None) -> dict:
    """A stage detail payload: what the portal resolved, for the live checklist.

    Kept to a fixed, JSON-safe shape so BizzFlow can render it without knowing
    which stage it came from. Values are truncated — a stage detail is a label,
    and an unbounded portal string would bloat every job poll.
    """
    text = ("" if value is None else str(value)).strip()
    if len(text) > 300:
        text = text[:297] + "..."
    d = {"value": text, "outcome": outcome}
    if note:
        d["note"] = str(note)[:300]
    return d


def _step_detail(result: dict, key: str, fallback: str = "") -> dict:
    """Turn a page-1 step result into a stage detail payload.

    A skip means two different things on page 1 and they must NOT read the same:

      not_applicable — the offer has no such field at all (Business packages
                       carry no Winback Tagging). Nothing is wrong; flagging it
                       would put an amber warning on every Business order.
      unset          — the field IS on the form and we left it on
                       "---Please select---". The portal marks it mandatory, so
                       a green tick here would claim work that never happened.

    Steps declare which via `reason`; an older step function that says neither is
    treated as unset, because under-reporting a real gap is the worse failure.
    """
    result = result or {}
    status = result.get("status")
    if status == "ok":
        return _detail(result.get(key) or fallback or "Set")
    if status == "skipped":
        note = result.get("message") or result.get("note")
        if result.get("reason") == "not_applicable":
            return _detail("Not applicable for this package", "not_applicable", note)
        return _detail("Not selected", "skipped", note)
    return _detail(result.get("message") or result.get("error") or "Failed", "failed")


def _longest_title(titles) -> str:
    """The address column out of a result row's td titles.

    The grid has no stable column id, but the concatAddress is always by far the
    longest cell (the others are ids, states, service categories), so the longest
    title is the address. Empty string when the row gave us nothing.
    """
    return max((t for t in (titles or [])), key=len, default="")


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
        target, target_titles = rows[0]  # By Address Id returns exactly one row.
    elif addr.get("pick_first"):
        # Capture/dev only: any serviceable row is fine (exact unit doesn't matter
        # when we just need to reach the New Connection page). NEVER set in prod.
        target, target_titles = rows[0]
    else:
        want = (addr.get("address_full") or addr.get("keywords") or "").strip().upper()
        target, target_titles = None, []
        for loc, titles in rows:
            if any(t.strip().upper() == want and len(t) > 20 for t in titles):
                target, target_titles = loc, titles
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
    return {"status": "ok", "stage": "select_address", "candidates": len(rows),
            # The portal's own concatAddress for the unit it actually matched —
            # reported to the agent so a near-miss (neighbouring unit in the same
            # block) is visible at submit time, not after installation.
            "matched": _longest_title(target_titles)}


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
        # The fuzzy path can land on an offer whose name differs from what the
        # draft asked for, so report the portal's wording, not ours.
        offers = picked.get("offers") or []
        i = picked["i"]
        return {"status": "ok", "stage": "select_plan",
                "matched": offers[i] if 0 <= i < len(offers) else name}
    await row.click()
    await asyncio.sleep(1)
    return {"status": "ok", "stage": "select_plan", "matched": name}


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
    stage = _stage_emitter(on_stage)

    await ensure_on_order_entry(page)
    frame = _frame(page)

    r = await open_feasibility(frame)
    if r["status"] != "ok":
        return r
    await asyncio.sleep(2)

    # Each step below is reported so a failure names the step it happened on.
    # Emission is additive — it must never change what the portal flow does.
    # Each step is emitted twice: once bare when it starts (so the checklist
    # shows it running), then again with the value the portal resolved. The
    # consumer keeps the latest detail per stage, so the pair is idempotent.
    stage("checking_address")
    r = await select_address(frame, payload["address"])
    if r["status"] != "ok":
        stage("checking_address",
              _detail(r.get("message") or r.get("error"), "failed"))
        return r
    stage("checking_address", _detail(r.get("matched")))

    stage("checking_plan")
    r = await select_plan(frame, payload["plan"])
    if r["status"] != "ok":
        stage("checking_plan", _detail(r.get("message") or r.get("error"), "failed"))
        return r
    stage("checking_plan", _detail(r.get("matched")))

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
        stage("placing_order",
              _detail("Order button not enabled by the portal", "failed"))
        return {"status": "error", "error": "order_not_ready", "stage": "click_order"}
    await order_btn.click()
    await asyncio.sleep(4)
    stage("placing_order", _detail("Order clicked"))

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
        stage("capturing_order_no",
              _detail("Portal did not show a Customer Order Number", "failed"))
        return {"status": "error", "error": "order_id_not_found", "stage": "capture_order_id"}
    stage("capturing_order_no", _detail(order_id))

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
        elif result.get("status") == "discovered":
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
        return {"status": "skipped", "stage": "install_contact", "reason": "not_applicable",
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
    # Read the contact off the row BEFORE clicking — this is the name the
    # installer will actually be given, so the agent needs to see it.
    picked_contact = ""
    try:
        picked_contact = _contact_name(await grid_row.inner_text())
    except Exception:
        pass
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
    return {"status": "ok", "stage": "install_contact", "selected": picked_contact}


async def create_billing_account(frame, page, acct_name: str = "") -> dict:
    """Create a NEW billing account per order. VERIFIED simple sequence (with
    GENEROUS waits — rushing makes the Reason/Success popups stack and one gets
    left open, covering page-1): open Account Infomation dialog -> '+ Add' -> fill
    Account Name -> OK the Add Account form -> the "Reason" popup appears -> OK ->
    final OK. The account then applies and every dialog closes. Skips cleanly when
    the offer has no account field."""
    acct_input = frame.locator('input[name="acctId"]:not(.js-acct-combobox)').first
    if not await acct_input.count():
        return {"status": "skipped", "stage": "account", "reason": "not_applicable",
                "note": "no account field"}
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
        return {"status": "skipped", "stage": "winback", "reason": "not_applicable",
                "message": f"winback not applicable ({opened})"}
    await asyncio.sleep(1)
    try:
        await frame.locator(
            f'ul.combobox-dropdown:visible li[title="{value}"]').first.click(timeout=6000)
    except Exception as e:
        # The field exists and is still on "---Please select---". The portal
        # treats it as mandatory, so this is UNSET, not not-applicable.
        return {"status": "skipped", "stage": "winback", "reason": "unset",
                "message": f"winback option '{value}' not found ({type(e).__name__})"}
    await asyncio.sleep(0.5)
    return {"status": "ok", "stage": "winback", "selected": value}


# ─────────────────────────────────────────────────────────────────────────────
# Capture — one frame per detail screen of a submit.
#
# A single page-1 frame proves the order exists; it proves nothing about the
# device that was picked, the voice number the portal assigned or the
# appointment slot that was taken, which are the fields disputes are actually
# about. So every detail screen gets its own frame, filed under its own slot and
# reported as its own stage, and each one lands on the timeline next to the step
# it documents.
#
# Every failure path is non-fatal, PER capture: evidence must never cost an
# order that is already minted in the portal. That rule does not weaken because
# there are now nine chances to break it instead of one.
# ─────────────────────────────────────────────────────────────────────────────
def capture_stage_name(slot: str) -> str:
    """The stage key a slot reports under (`capture_broadband`, …).

    A prefix rather than one overloaded key, so BizzFlow can partition captures
    out of the step checklist without knowing which slots exist — the scraper
    deploys separately and WILL emit slots a given BizzFlow build has never seen.
    """
    from r2_upload import slot_slug
    return f"capture_{slot_slug(slot)}"


def _capture_enabled(slot: str) -> bool:
    """Whether this slot should be shot, per the rollback env switches.

    OE_CAPTURE=false kills all capture without a redeploy. OE_CAPTURE_SLOTS, when
    set, is an allowlist (`page1,broadband`) for narrowing to the frames worth
    the wall-clock. OE_CAPTURE_PAGE1 is honoured for the page-1 slot only, so a
    droplet still carrying the Phase-1 switch keeps behaving as configured.
    """
    from r2_upload import slot_slug
    off = ("false", "0", "no")
    if os.environ.get("OE_CAPTURE", "true").strip().lower() in off:
        return False
    slug = slot_slug(slot)
    if slug == "page1" and os.environ.get("OE_CAPTURE_PAGE1", "true").strip().lower() in off:
        return False
    allow = os.environ.get("OE_CAPTURE_SLOTS", "").strip()
    if allow:
        return slug in {slot_slug(s) for s in allow.split(",") if s.strip()}
    return True


async def _shoot(page) -> bytes:
    """JPEG of the PORTAL page — the whole of it, not the part that fits.

    The portal renders inside #myIframe, and `page.screenshot(full_page=True)`
    expands the OUTER document only: an iframe is a fixed-size box, so a full
    page shot of the shell contains just the slice of the portal visible in that
    box and silently cuts everything below it. Measured on a 3000px document in
    a 600px iframe: the outer full-page shot came back 740px tall, the frame's
    own body 3000px.

    That is the difference between evidence and a picture of a header, because
    the fields worth photographing — the selected device, the appointment slot,
    the delivery contact — all sit low on their pages.

    Falls back to the outer shot if the frame can't be shot at all (a capture is
    never worth failing a submit over); the geometry is logged either way, so the
    first live run says whether the frame really held the whole page rather than
    leaving us to assume it.
    """
    try:
        geom = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
          if(!d) return null;
          return {box: Math.round(f.getBoundingClientRect().height),
                  doc: d.documentElement.scrollHeight,
                  body: d.body ? d.body.scrollHeight : 0};
        })()""")
    except Exception:  # noqa: BLE001
        geom = None

    if geom:
        # The portal's own layout decides whether the height lives on <body> or
        # on <html>; shoot whichever actually carries the content.
        target = "body" if geom.get("body", 0) >= geom.get("doc", 0) else "html"
        try:
            img = await _frame(page).locator(target).first.screenshot(
                type="jpeg", quality=80, timeout=20000)
            print(f"    portal frame {geom['doc']}px in a {geom['box']}px box "
                  f"— shot <{target}>", flush=True)
            return img
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ frame shot failed ({type(e).__name__}), "
                  f"falling back to the outer page", flush=True)

    return await page.screenshot(full_page=True, type="jpeg", quality=80)


async def capture_screen(page, payload: dict, slot: str = "page1") -> dict | None:
    """JPEG of the portal page -> R2. Never raises.

    Returns a stage detail payload (the R2 key on success, the reason on
    failure), or None when capture is switched off for this slot or the payload
    has no order to file the frame under. The caller reports it under
    `capture_stage_name(slot)`.
    """
    if not _capture_enabled(slot):
        return None

    ref = (payload or {}).get("order_ref") or {}
    user_id, order_id = ref.get("user_id"), ref.get("order_id")
    if not user_id or not order_id:
        # An older BizzFlow that doesn't send order_ref — there is nowhere to
        # file the image, so skip silently rather than invent a key.
        return None

    try:
        img = await _shoot(page)
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ {slot} screenshot failed: {type(e).__name__}: {e}", flush=True)
        return _detail("Screenshot not captured", "failed", f"{type(e).__name__}: {e}")

    try:
        from r2_upload import screenshot_key, upload_bytes
        key = screenshot_key(user_id, order_id, ref.get("attempt", 1), slot)
        upload_bytes(key, img, "image/jpeg")
        print(f"  ✓ {slot} screenshot uploaded: {key}", flush=True)
        return _detail(key)
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ {slot} screenshot upload failed: {type(e).__name__}: {e}", flush=True)
        return _detail("Screenshot not stored", "failed", f"{type(e).__name__}: {e}")


async def capture_and_report(page, payload: dict, slot: str, stage) -> dict | None:
    """capture_screen + report it on the timeline, in one call.

    Every call site does exactly this, and doing it in one place is what keeps
    the "a capture never fails a submit" rule from being re-implemented (and
    eventually got wrong) nine times.
    """
    try:
        shot = await capture_screen(page, payload, slot)
    except Exception as e:  # noqa: BLE001
        # capture_screen swallows its own failures; this is the belt to that
        # braces — an unexpected raise here must not take the order down.
        print(f"  ⚠ {slot} capture raised: {type(e).__name__}: {e}", flush=True)
        return None
    if shot:
        stage(capture_stage_name(slot), shot)
    return shot


# The suffix a bottom-of-page frame carries. Kept as a constant because BizzFlow
# derives its label from the same string.
BOTTOM_SUFFIX = "_bottom"


async def _scroll_to_offers(page) -> dict | None:
    """Scroll the portal's INNER scroller so Select Offer sits at the top.

    NOT to the absolute end, which was the first attempt and measurably wrong:
    scrolling to `scrollHeight` framed Order Information perfectly but pushed
    Select Offer off the top, leaving only the tail of its last row visible
    ("20.00/Month, Instant, Permanent"). Select Offer is the more important of
    the two — it is the only record of which device and discount the portal
    actually attached, and at what charge.

    So the scroll is anchored on the heading rather than computed from pixels:
    put "Select Offer" just below the top edge and the frame runs from there
    through Order Information. Content-anchored, so it survives the portal
    changing its section heights; falls back to the end of the scroller if the
    heading isn't found, which is still better than the top-only frame.

    The frames come back 1192x716 for every slot — exactly the iframe box —
    because the portal scrolls its content in a div inside the iframe, not on
    the iframe's own body. Shooting <body> therefore photographs the box, and
    everything below the fold (Select Offer, Order Information, Order Comments)
    is silently cut. That is most of the commercial detail on a tab.

    Deliberately scroll-only. Expanding the scroller (height:auto) would give a
    single full-height image, but it mutates the CSS of a live order form
    mid-submit, and if the restore ever lost a race the form would carry on in
    an altered state. A capture must never cost an order; scrolling a container
    cannot change a field, so this is the version that honours that rule.

    Returns None when nothing scrollable was found, so the caller can skip the
    second frame rather than upload a duplicate of the first.
    """
    return await _scroll_to_heading(page, r"select\s*offer")


async def _scroll_to_heading(page, pattern: str) -> dict | None:
    """Scroll the portal's INNER scroller so `pattern`'s heading sits at the top.

    `pattern` is a JS regex SOURCE (case-insensitive), matched against element
    text. See SCROLL_TO_HEADING_JS for why the matching is shaped as it is.
    """
    try:
        return await page.evaluate(SCROLL_TO_HEADING_JS, pattern)
    except Exception as e:  # noqa: BLE001
        print(f"    ⚠ scroll to {pattern!r} failed: {type(e).__name__}", flush=True)
        return None


# Kept as a module-level constant so tests can exercise THIS string against a
# fixture rather than a hand-copied paraphrase of it. Two live bugs got through
# because the behaviour was only ever observable via a production submit:
# an exact-text anchor match that the portal's markup never satisfies, and a
# match on a hidden node whose zero rect reads as "already in view".
SCROLL_TO_HEADING_JS = r"""((patternSource) => {
          const re = new RegExp(patternSource, 'i');
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
          if(!d) return null;
          // The scroller is whichever element actually overflows. Take the
          // tallest candidate: nested wrappers can each overflow slightly, and
          // the outermost one is what carries the whole form.
          let best=null;
          for (const el of d.querySelectorAll('div,section,main')) {
            const over = el.scrollHeight - el.clientHeight;
            if (over > 40 && el.clientHeight > 200) {
              if (!best || el.scrollHeight > best.scrollHeight) best = el;
            }
          }
          const target = best || d.scrollingElement || d.body;
          if (!target) return null;
          const before = target.scrollTop;

          // Anchor: the section heading matching `pattern`.
          //
          // An exact-text match was tried first and failed live — a heading sits
          // in a row with controls like "+ Add" and a bar decoration, so its
          // text is never exactly the section name. Match on CONTAINS instead,
          // bounded by length, and take the SHORTEST match: every ancestor up
          // to <body> also contains the phrase, and the shortest is the heading
          // itself rather than the wrapper holding the whole form.
          // Among the matches, take the one DEEPEST in the content. The page
          // repeats every section name in a right-hand nav, verbatim and at
          // equal length, so a shortest-text or first-match rule picks the nav
          // link instead of the section it points at — measured, that left
          // Install Information pinned to the bottom edge of its own frame.
          // The nav sits at the top of the content; real sections do not.
          const tRect0 = target.getBoundingClientRect();
          let anchor = null, anchorText = '', anchorAt = -1;
          for (const el of target.querySelectorAll('*')) {
            const txt = (el.textContent || '').trim();
            if (txt.length > 60 || !re.test(txt)) continue;
            // Must be VISIBLE. A hidden node reports an all-zero rect, which
            // computes a negative scroll, clamps to 0, and reads as "already in
            // view" — live, that silently produced no bottom frame at all.
            if (!el.getClientRects().length || el.offsetParent === null) continue;
            const at = before + (el.getBoundingClientRect().top - tRect0.top);
            if (at > anchorAt) { anchor = el; anchorText = txt; anchorAt = at; }
          }

          let how = 'bottom';
          if (anchor) {
            const a = anchor.getBoundingClientRect(), t = target.getBoundingClientRect();
            // 12px of breathing room so the heading is not flush with the edge.
            const want = before + (a.top - t.top) - 12;
            if (want > before + 20) { target.scrollTop = want; how = 'anchor'; }
          }
          // Anchor missing, or it would not actually move us down: the end of
          // the scroller still beats a duplicate of the top frame.
          if (how !== 'anchor') target.scrollTop = target.scrollHeight;
          return {scrolled: Math.round(target.scrollTop - before),
                  height: Math.round(target.scrollHeight),
                  box: Math.round(target.clientHeight),
                  how: how,
                  anchor: anchorText,
                  tag: target.tagName.toLowerCase(),
                  cls: (target.className||'').toString().slice(0,60)};
        })"""


# The sections of the post-Next Customer Order Information page that are worth
# their own frame. It is one long scroll — Basic Information and Attachments sit
# at the top (already captured), and everything that describes what the customer
# is actually getting is below the fold.
ORDER_INFO_SECTIONS = (
    (r"install\s*information", "install_info"),
    (r"device\s*list", "device_list"),
    (r"fee\s*information\s*preview", "fee_preview"),
    (r"order\s*item\s*list", "order_items"),
)


# Finds the same scroller SCROLL_TO_HEADING_JS does, then either reads its
# position (top === null) or sets it. Kept as one expression so the two can never
# disagree about which element they mean.
SCROLLER_POSITION_JS = r"""((top) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
          if(!d) return null;
          let best=null;
          for (const el of d.querySelectorAll('div,section,main')) {
            const over = el.scrollHeight - el.clientHeight;
            if (over > 40 && el.clientHeight > 200) {
              if (!best || el.scrollHeight > best.scrollHeight) best = el;
            }
          }
          const t = best || d.scrollingElement || d.body;
          if (!t) return null;
          if (top !== null) t.scrollTop = top;
          return Math.round(t.scrollTop);
        })"""


async def _scroll_position(page, top=None):
    """Read the inner scroller's position, or set it when `top` is given."""
    try:
        return await page.evaluate(SCROLLER_POSITION_JS, top)
    except Exception:  # noqa: BLE001
        return None  # cosmetic only — never worth failing a submit over


async def capture_sections(page, payload: dict, sections, stage) -> None:
    """Scroll to each named section in turn and photograph it.

    Sections that aren't on the page are skipped silently — the portal renders
    different ones per offer (no device means no Device List), and a missing
    section is not a failure any more than a missing field is.

    Leaves the scroller where it found it. The steps that follow this one were
    written against a page at its original position, and quietly moving it
    underneath them is the kind of side effect that turns evidence-gathering
    into the cause of a failure.
    """
    origin = await _scroll_position(page)
    for pattern, slot in sections:
        # Back to the top before each one. The anchor only engages when it would
        # move DOWN (that guard is what stops a hidden match scrolling us
        # backwards), so a section sitting above the current position would
        # silently fall back and be skipped — which, after the first capture
        # scrolled us down, is every section that isn't in strict page order.
        await _scroll_position(page, 0)
        geom = await _scroll_to_heading(page, pattern)
        if not geom or geom.get("how") != "anchor":
            print(f"    {slot}: no '{pattern}' heading on this page — skipped",
                  flush=True)
            continue
        print(f"    {slot}: scrolled {geom['scrolled']}px of {geom['height']}px "
              f"anchor={geom.get('anchor')!r}", flush=True)
        await page.wait_for_timeout(400)
        await capture_and_report(page, payload, slot, stage)
    if origin is not None:
        await _scroll_position(page, origin)


async def capture_top_and_bottom(page, payload: dict, slot: str, stage) -> None:
    """Photograph a tab twice: as it opens, and again scrolled to its end.

    One frame cannot hold a sub-product tab. The top carries Service Number and
    ServiceProfile; the bottom carries Select Offer (which discount and which
    device actually got attached, with their charges) and Order Information —
    and the bottom is the half that gets disputed.
    """
    await capture_and_report(page, payload, slot, stage)

    geom = await _scroll_to_offers(page)
    if not geom:
        print(f"    {slot}: no inner scroller found — no bottom frame", flush=True)
        return
    if geom.get("scrolled", 0) < 40:
        # Already showing the whole tab; a second frame would duplicate the first.
        print(f"    {slot}: fits in {geom['box']}px — no bottom frame needed", flush=True)
        return
    print(f"    {slot}: scrolled {geom['scrolled']}px of {geom['height']}px "
          f"via {geom.get('how')} anchor={geom.get('anchor')!r} "
          f"(<{geom['tag']} class={geom['cls']!r}>)", flush=True)
    # Let the portal settle any lazy/sticky rendering the scroll triggered.
    await page.wait_for_timeout(400)
    await capture_and_report(page, payload, f"{slot}{BOTTOM_SUFFIX}", stage)


async def complete_new_connection(page, payload: dict = None, on_stage=None) -> dict:
    """New Connection page 1: Installation Contact + NEW billing Account + Winback.
    Stops before Next. Fields differ per offer — each step skips cleanly if its
    field is absent. Returns {status:'ok'|'error', steps:{...}}."""
    stage = _stage_emitter(on_stage)

    frame = _frame(page)
    await cancel_customer_popup(page)
    payload = payload or {}
    cust = payload.get("customer", {}) or {}
    acct_name = cust.get("name") or (cust.get("contact", {}) or {}).get("name", "") or ""

    steps = {}
    await cancel_customer_popup(page)
    stage("installation_contact")
    steps["install_contact"] = await set_installation_contact(frame, page)
    stage("installation_contact", _step_detail(steps["install_contact"], "selected"))
    await cancel_customer_popup(page)
    stage("billing_account")
    steps["account"] = await create_billing_account(frame, page, acct_name)
    stage("billing_account", _step_detail(steps["account"], "name", acct_name))
    await cancel_customer_popup(page)
    stage("winback_tagging")
    steps["winback"] = await set_winback_tagging(frame, page)
    # A skipped winback is the portal's mandatory field left at "---Please
    # select---". That is not a success — it is reported as such so the agent
    # sees an amber step rather than a tick over an unset required field.
    stage("winback_tagging", _step_detail(steps["winback"], "selected"))

    # The page-1 frame: order no, address, contact, offer, account and winback in
    # one image, as the portal rendered them. Still the most representative single
    # image of a submit, which is why the order row points at this slot.
    await capture_and_report(page, payload, "page1", stage)

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


# The portal's wording when a broadband/TV service login is already reserved.
# Captured live 2026-08-17 on the sub-product Next:
#   "[40330205]: Operate resource error, RESERVELOGIN error. [1]:LOGIN_ID
#    [tklee812@iptv] provided in input is already in use by other customer..."
# Kept deliberately tight — a false positive re-rolls the service number in
# response to an unrelated warning and buries the real cause.
_LOGIN_TAKEN_RE = re.compile(
    r"reservelogin|login_id\b[^.]*already\s+in\s+use|already\s+(?:in\s+use|taken)", re.I)
_LOGIN_ID_RE = re.compile(r"LOGIN_ID\s*\[([^\]]+)\]", re.I)


def is_login_taken(message: str | None) -> bool:
    """True when a portal popup is rejecting a service username as already used."""
    return bool(message) and bool(_LOGIN_TAKEN_RE.search(message))


def taken_login_id(message: str | None) -> str | None:
    """The rejected LOGIN_ID (e.g. 'tklee812@iptv') named in the popup, if any."""
    m = _LOGIN_ID_RE.search(message or "")
    return m.group(1) if m else None


def _service_username(email: str, exclude: set | None = None) -> str:
    """email-local-part (before @, uppercased) + 3 random digits — a unique-ish
    broadband/TV service username (random digits dodge 'already taken').

    `exclude` holds the names already burned in this run. The pool is only 900
    wide per customer and every attempt RESERVES one, so a resubmitted customer
    collides with its own earlier orders; re-offering a name we just saw
    rejected would waste the retry.
    """
    local = (email or "user").split("@")[0]
    local = "".join(ch for ch in local if ch.isalnum()).upper() or "USER"
    exclude = exclude or set()
    for _ in range(40):
        name = f"{local}{_random.randint(100, 999)}"
        if name not in exclude:
            return name
    return f"{local}{_random.randint(100, 999)}"  # pool exhausted — let the portal decide


async def _active_subproduct_panel(frame):
    """The visible sub-product tab panel (jQuery UI tab body currently shown)."""
    return frame.locator('.ui-tabs-panel:visible, .tab-pane.active:visible').last


async def _set_service_number_username(frame, page, email: str,
                                       attempts: int = 4, tried: set = None) -> dict:
    """Broadband/TV: type the username into the active tab's Service Number
    (input[name=accNbr]) then click its Check button (.js-search-number).

    Retries with a fresh username when the portal rejects the name as already in
    use. The Check click used to be fire-and-forget — a 2s sleep and an
    unconditional "ok" — so a collision stayed invisible until the sub-product
    Next blew up with a RESERVELOGIN error and stranded the order.
    """
    tried = tried if tried is not None else set()
    last_msg = None
    for attempt in range(attempts):
        uname = _service_username(email, exclude=tried)
        tried.add(uname)
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

        # Read what Check said instead of assuming it passed.
        msg = await _dismiss_popup_ok(frame, page, exclude_title_re=r"offer")
        if msg is None:
            return {"status": "ok", "stage": "service_number", "username": uname,
                    "attempts": attempt + 1}
        last_msg = msg
        if not is_login_taken(msg):
            # Some other popup. The order id is already minted by this point, so
            # failing here strands it — and before this change the Check result
            # was ignored entirely. Record it and carry on; whatever actually
            # blocks will resurface at the Next, which does check.
            print(f"  ↳ service-number Check popup (not a collision): {msg!r}", flush=True)
            return {"status": "ok", "stage": "service_number", "username": uname,
                    "attempts": attempt + 1, "note": msg}
        print(f"  ↳ service username {uname} already in use — retrying "
              f"({attempt + 1}/{attempts})", flush=True)

    return {"status": "error", "error": "service_number_all_taken",
            "stage": "service_number",
            "message": (f"The portal rejected {attempts} service usernames as already "
                        f"in use (tried {sorted(tried)}). Last message: {last_msg!r}"),
            "tried": sorted(tried)}


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



def _tab_slot(tab_text: str) -> str:
    """The capture slot for a sub-product tab, from the text the PORTAL reports.

    The tab is labelled with the offer, not the product ("Unifi Home 500Mbps
    (Broadband)"), so the three known kinds are matched by keyword and anything
    else falls back to a slug of the tab text. An offer that carries no Voice or
    TV component simply produces no tab, and therefore no frame — the same way a
    missing field produces no stage detail.
    """
    from r2_upload import slot_slug
    t = tab_text or ""
    for keyword, slot in (("Broadband", "broadband"), ("Voice", "voice"), ("TV", "tv")):
        if keyword in t:
            return slot
    return slot_slug(t)


_DEVICE_PASSTHROUGH = ("rejected_device_code", "rejected_device_name",
                       "substituted_device_code", "substituted_device_name",
                       "available_devices")


def _carry_device_info(dest: dict, dev: dict) -> dict:
    """Copy the device diagnostics onto an outer result, dropping empties."""
    for k in _DEVICE_PASSTHROUGH:
        if dev.get(k):
            dest[k] = dev[k]
    if dev.get("warning") and not dest.get("warning"):
        dest["warning"] = dev["warning"]
    return dest


async def _reassign_service_numbers(page, email: str, tried: set,
                                    only_prefix: str = None) -> dict:
    """Re-roll the service username on every broadband/TV sub-product tab.

    Used when the collision only surfaces at the sub-product Next (the portal
    reserves the login there, not at Check). The error names the rejected
    LOGIN_ID, so `only_prefix` restricts the re-roll to the tab actually holding
    it — re-rolling a name the portal already accepted would risk trading a good
    reservation for a fresh collision.
    """
    frame = _frame(page)
    touched, errors = {}, {}
    for _, txt, _loc in await _subproduct_tabs(frame):
        if "Bundle" in txt or "Voice" in txt:
            continue  # Bundle is page 1; Voice numbers come from a picker, not a name
        switched = await page.evaluate(r"""((txt) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const anchors=[...d.querySelectorAll('.ui-tabs-nav .ui-tabs-anchor')];
          const a=anchors.find(x=>(x.innerText||'').trim()===txt)
               || anchors.find(x=>(x.innerText||'').includes(txt));
          if(!a) return 'notab'; a.click(); return 'ok';
        })""", txt)
        if switched != "ok":
            errors[txt] = f"tab switch: {switched}"
            continue
        await asyncio.sleep(1.5)
        if only_prefix:
            try:
                cur = await frame.locator(
                    'input[name="accNbr"]:visible:not([readonly])').last.input_value()
            except Exception:
                cur = ""
            if cur and cur.strip().lower() != only_prefix.lower():
                continue  # not the tab the portal complained about
        sn = await _set_service_number_username(page=page, frame=frame, email=email,
                                                tried=tried)
        touched[txt] = sn.get("username") or sn.get("error")
        if sn.get("status") != "ok":
            errors[txt] = sn.get("message")
    # The filter matched no tab (the field had been cleared, or the name lives
    # somewhere we didn't look). Re-rolling nothing and clicking Next again would
    # just repeat the same rejection, so fall back to re-rolling every tab.
    if only_prefix and not touched and not errors:
        return await _reassign_service_numbers(page, email, tried, only_prefix=None)
    return {"reassigned": touched, "errors": errors}


async def fill_subproduct_tabs(page, payload: dict, on_stage=None) -> dict:
    """Fill Broadband / Voice / TV tabs (Bundle already done on page 1). Reveals
    the 4th (TV) tab via the pager. Returns {status, tabs:{...}}."""
    stage = _stage_emitter(on_stage)

    frame = _frame(page)
    email = (payload.get("customer", {}).get("contact", {}) or {}).get("email", "") if payload else ""
    results = {}
    device_info = None
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
            if dev.get("status") == "discovered":
                # Catalogue discovery — nothing more to fill in.
                return {"status": "discovered", "stage": "device", "tab": txt,
                        "offered": dev.get("offered", []),
                        "groups": dev.get("groups", []),
                        "available_devices": dev.get("offered", []), "tabs": results}
            if dev.get("status") not in ("ok", "skipped"):
                return _carry_device_info({
                    "status": "error", "stage": "device", "tab": txt,
                    "error": dev.get("error"), "message": dev.get("message"),
                    "tabs": results}, dev)
            device_info = dev
        # This tab is filled — capture it, top and bottom. The Broadband frames
        # are the only evidence of WHICH device the portal accepted (our
        # catalogue is a superset of what it actually offers) and at what
        # charge, and the Voice frame is the only record of the number it
        # assigned; none of those values is echoed anywhere else. The device and
        # its price sit in Select Offer, below the fold — which is why one frame
        # per tab was never enough.
        await capture_top_and_bottom(page, payload, _tab_slot(txt), stage)
    out = {"status": "ok", "stage": "subproduct_tabs", "tabs": results}
    return _carry_device_info(out, device_info) if device_info else out


# ─────────────────────────────────────────────────────────────────────────────
# Device selection (any with-device offer MUST go through this) — VERIFIED live
# via oe_interactive.  The active tab's "Select Offer" section has an Add button;
# clicking it opens an "Offer" dialog (a jqGrid of ~126 device rows).  Each row's
# first td[title] is the offer code  O-<deviceCode>-<groupId>  — <deviceCode>
# matches src/lib/dealer-devices.ts.  Rejections are per-device AND per-account
# (surface, don't retry blindly).
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# The Offer dialog is a GROUPED grid, and the grouping is what decides which
# devices a package may actually carry.
#
# It opens with every group collapsed, listing rows like
#     Unifi Home 500Mbps Mesh WIFI [Pick 0-2]
#     Unifi Home 500Mbps Premium Value With Device[Pick 0-1] *
# The red "*" marks the MANDATORY groups for this package — and only those hold
# the devices that may be ordered. A package with no starred group needs no
# device at all (verified: 100Mbps Premium Value has none).
#
# This matters because our own catalogue (src/lib/dealer-devices.ts) came from
# the portal's VAS tree and contains entirely different offers — e.g. it lists
# "LG 75inch TV (24mth contract)" while the starred group for that same package
# holds "Premium Value Samsung TV 55inch 1 (RM20)". Picking from the catalogue is
# what produced "the current offer can't be subscribed through Contactless
# Journey": the device was never on offer for that package.
#
# So the dialog itself is the source of truth. We expand the starred groups, read
# their rows, and hand them back to BizzFlow, which caches them per package so
# the agent's picker can offer exactly these next time.
# ─────────────────────────────────────────────────────────────────────────────

# A group header carries its pick-range, e.g. "[Pick 0-1]" / "[Pick 0-N]".
_GROUP_RE = r"\[\s*Pick\s+\d+\s*-\s*[\dN]+\s*\]"

# Reads the dialog as an ordered list of {kind: group|row, …}. Group membership
# is positional — jqGrid renders a group header row followed by its data rows —
# which survives markup changes that class-name matching would not.
_OFFER_TREE_JS = r"""((groupRe) => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return [];
  const vis=e=>e&&e.offsetParent!==null;
  const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return [];
  const rx=new RegExp(groupRe, 'i');
  const out=[]; let gi=-1;
  for (const tr of dl.querySelectorAll('tr')) {
    const text=(tr.innerText||'').replace(/\s+/g,' ').trim();
    if(!text) continue;
    if(rx.test(text)) {
      // A group header. The asterisk may be its own element (often coloured
      // red) or just a trailing character, so check both.
      const starred = /\*/.test(text)
        || !!tr.querySelector('.required, .mandatory, [style*="red"], font[color]');
      // Expanded when any following sibling data row is visible.
      const icon = tr.querySelector(
        '.ui-icon-plus, .ui-icon-minus, .ui-icon-triangle-1-e, .ui-icon-triangle-1-s,' +
        '.tree-plus, .tree-minus, .glyphicon-triangle-right, .glyphicon-triangle-bottom,' +
        '.glyphicon-chevron-right, .glyphicon-chevron-down, .treeclick, td > span[class*="icon"]');
      const cls=(icon && icon.className) || '';
      const collapsed = /plus|triangle-1-e|chevron-right|triangle-right/i.test(String(cls));
      gi=out.length;
      out.push({ kind:'group', name:text.replace(/\*/g,'').trim().slice(0,160),
                 starred, collapsed, index: gi });
      continue;
    }
    const cb=tr.querySelector('input[type=checkbox]');
    const codeTd=[...tr.querySelectorAll('td[title]')]
      .find(td=>/^O-\d+-/.test(td.getAttribute('title')||''));
    if(!cb && !codeTd) continue;   // header/filler row
    const m=codeTd && (codeTd.getAttribute('title')||'').match(/^O-(\d+)-/);
    out.push({ kind:'row', group: gi,
               code: m ? m[1] : null,
               name: text.split(' RM')[0].trim().slice(0,120),
               text: text.slice(0,200),
               checked: !!(cb && cb.checked),
               selectable: !!cb,
               visible: vis(tr),
               isDiscount: /discount/i.test(text) });
  }
  return out;
})"""


async def read_offer_tree(page) -> list:
    """The Offer dialog as an ordered group/row list. [] if no dialog is open."""
    try:
        return await page.evaluate(_OFFER_TREE_JS, _GROUP_RE) or []
    except Exception:
        return []


def _norm_group(name: str) -> str:
    """Compare group names ignoring spacing and the trailing star."""
    return re.sub(r"\s+", " ", (name or "")).replace("*", "").strip().lower()


async def expand_starred_groups(page, want_names: list = None) -> int:
    """Expand the mandatory groups so their rows become readable.

    The dialog opens fully collapsed, so without this the rows we need do not
    exist in a usable state — reads come back empty and clicks land on nothing.

    `want_names` are the group names an ADMIN recorded off the portal for this
    plan. Matching on a human-confirmed name is far more reliable than detecting
    the red "*", whose markup we can only guess at; star detection is kept as the
    fallback for plans with nothing configured.
    """
    wanted = {_norm_group(n) for n in (want_names or []) if n}

    def is_target(g):
        if not g.get("collapsed"):
            return False
        if wanted:
            gn = _norm_group(g.get("name", ""))
            return any(gn.startswith(w) or w.startswith(gn) for w in wanted)
        return bool(g.get("starred"))

    expanded = 0
    for _ in range(6):  # each expand re-renders the grid, so re-read each time
        tree = await read_offer_tree(page)
        target = next((g for g in tree if g.get("kind") == "group" and is_target(g)), None)
        if not target:
            break
        clicked = await page.evaluate(r"""((name) => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return 'nodialog';
          const tr=[...dl.querySelectorAll('tr')].find(
            r=>((r.innerText||'').replace(/\s+/g,' ').trim().replace(/\*/g,'').trim()).startsWith(name));
          if(!tr) return 'notfound';
          const icon=tr.querySelector(
            '.ui-icon-plus, .ui-icon-triangle-1-e, .tree-plus, .glyphicon-triangle-right,' +
            '.glyphicon-chevron-right, .treeclick, td > span[class*="icon"], td > a');
          (icon || tr.querySelector('td') || tr).click();
          return 'ok';
        })""", target["name"])
        if clicked != "ok":
            break
        expanded += 1
        await asyncio.sleep(1.2)
    return expanded


def mandatory_group_indices(tree: list, want_names: list = None) -> set:
    """Indices of the groups that count as mandatory for this plan.

    Prefers the admin-recorded names; falls back to the portal's red "*" when a
    plan has none configured.
    """
    wanted = {_norm_group(n) for n in (want_names or []) if n}
    out = set()
    for g in tree:
        if g.get("kind") != "group":
            continue
        if wanted:
            gn = _norm_group(g.get("name", ""))
            if any(gn.startswith(w) or w.startswith(gn) for w in wanted):
                out.add(g["index"])
        elif g.get("starred"):
            out.add(g["index"])
    return out


def starred_devices(tree: list, want_names: list = None) -> list:
    """Selectable, non-discount rows inside the mandatory groups — the devices
    this package may actually carry."""
    starred = mandatory_group_indices(tree, want_names)
    return [{"code": r["code"], "name": r["name"]}
            for r in tree
            if r.get("kind") == "row" and r.get("group") in starred
            and r.get("code") and r.get("selectable") and not r.get("isDiscount")]


def has_starred_group(tree: list, want_names: list = None) -> bool:
    """False when the plan mandates nothing — no device should be ordered."""
    return bool(mandatory_group_indices(tree, want_names))


async def read_offer_rows(page) -> list:
    """Flat row view, kept for callers that don't care about grouping."""
    return [r for r in await read_offer_tree(page) if r.get("kind") == "row"]


async def dump_offer_dialog(page, label: str = "offer") -> str | None:
    """Write the dialog's HTML to outputs/ so its real markup can be checked.

    The group/expand selectors above are written defensively against markup we
    have only seen in screenshots; this makes the next real run self-documenting
    instead of leaving us guessing again.
    """
    try:
        html = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop();
          return dl ? dl.outerHTML : null;
        })()""")
        if not html:
            return None
        import os
        os.makedirs("outputs", exist_ok=True)
        path = os.path.join("outputs", f"{label}_dialog.html")
        with open(path, "w") as fh:
            fh.write(html)
        return path
    except Exception:
        return None


async def ensure_promo_discounts(page) -> dict:
    """Tick the mandatory discount row when the portal hasn't pre-ticked it.

    Scoped to STARRED groups: an unstarred discount is optional and not ours to
    add. The groups are "[Pick 0-1]", so if one is already ticked we leave the
    dialog exactly as found rather than override the portal's own choice.
    """
    tree = await read_offer_tree(page)
    starred = {g["index"] for g in tree if g.get("kind") == "group" and g.get("starred")}
    discounts = [r for r in tree
                 if r.get("kind") == "row" and r.get("group") in starred
                 and r.get("isDiscount") and r.get("selectable")]
    if not discounts:
        return {"status": "skipped", "note": "no mandatory discount row"}
    if any(r.get("checked") for r in discounts):
        return {"status": "ok", "note": "discount already ticked"}

    target = discounts[0]
    ticked = await page.evaluate(r"""((code) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return 'nodialog';
      const row=[...dl.querySelectorAll('tr')].find(r =>
        [...r.querySelectorAll('td[title]')].some(td =>
          (td.getAttribute('title')||'').startsWith('O-'+code+'-')));
      if(!row) return 'notfound';
      const cb=row.querySelector('input[type=checkbox]');
      if(!cb) return 'nocheckbox';
      if(cb.checked) return 'already';
      cb.click(); return cb.checked ? 'ticked' : 'clicked';
    })""", target.get("code"))
    await asyncio.sleep(0.8)
    return {"status": "ok" if ticked in ("ticked", "clicked", "already") else "error",
            "discount": target.get("name"), "result": ticked}


# Read-and-dismiss the portal's Warning/Error dialog.
#
# A module constant rather than an inline string so `tests/test_error_dialog.py`
# can exercise it against fixtures. The out-of-stock refusal was the third
# selector-shaped bug in this flow to be discovered only by burning a real
# production submit, and the shape it actually renders in is STILL unconfirmed —
# hence two deliberate widenings over the original `.ui-dialog`-in-`#myIframe`
# scan:
#   * the container list covers the jQuery-UI dialogs we know about AND the
#     Bootstrap/Ant shapes (`.modal.in`, `.ant-modal`, `[role=dialog]`) the
#     outer shell uses, because a dialog we cannot see reads as "no dialog"
#     and the run dies with a cryptic downstream timeout instead;
#   * it scans the top document as well as the iframe, since the shell's own
#     modals live outside `#myIframe` entirely.
# It returns `selector` and `container` so ONE live run tells us which shape the
# portal really used, instead of another round of guessing.
READ_ERROR_DIALOG_JS = r"""((excl) => {
  const rx=new RegExp(excl,'i');
  const vis=e=>{ if(!e) return false;
    const r=e.getBoundingClientRect();
    return (e.offsetParent!==null || getComputedStyle(e).position==='fixed')
           && r.width>0 && r.height>0; };
  const SELECTORS=['.ui-dialog','.modal.in','.modal.show','.ant-modal','[role=dialog]'];
  const f=document.querySelector('#myIframe'), fd=f&&f.contentDocument;
  const docs=[['iframe',fd],['top',document]];
  for(const [container,d] of docs){
    if(!d) continue;
    for(const sel of SELECTORS){
      const dlgs=[...d.querySelectorAll(sel)].filter(vis);
      for(const dl of dlgs.reverse()){
        const t=((dl.querySelector('.ui-dialog-title,.modal-title,.ant-modal-title')||{})
                  .innerText||'').trim();
        if(rx.test(t)) continue;
        const looksBad=/warn|error|danger|prompt|confirm/i.test(dl.className)
                     ||/warn|error/i.test(t);
        // The stock dialog titles itself plainly "Error" but carries no
        // error-ish class, and the body is the only place the code lives — so
        // the body text is a third way in, not just a fallback.
        const body=((dl.querySelector('.modal-message,.modal-body,.ant-modal-body')||dl)
                     .innerText||'').replace(/\s+/g,' ').trim();
        if(!looksBad && !/^\s*\[\d{4,}\]/.test(body)) continue;
        const ok=[...dl.querySelectorAll('button,a.btn')]
                   .find(b=>/^ok$/i.test((b.innerText||'').trim()))
               ||dl.querySelector('.btn-danger,.btn-primary,.ant-btn-primary');
        if(ok){
          ok.click();
          return {message: body.slice(0,300)||'(dismissed)', title: t,
                  selector: sel, container: container};
        }
      }
    }
  }
  return null;
})"""


async def read_error_dialog(page, exclude_title_re=r"offer") -> dict | None:
    """Read + OK the visible Warning/Error dialog. Returns a diagnostic dict
    ({message, title, selector, container}) or None when nothing is up."""
    return await page.evaluate(READ_ERROR_DIALOG_JS, exclude_title_re)


def classify_dialog(dlg: dict | None) -> dict:
    """Turn a read_error_dialog() result into the keys a failure dict carries."""
    if not dlg:
        return {}
    msg = dlg.get("message") or ""
    out = {"message": msg, "dialog": dlg}
    # Deliberately omit `error` when nothing matched: callers fall back to their
    # own stage-specific code ("next_blocked", "device_rejected"), which says
    # more about where we are than a blanket "unknown_error" would.
    mapped = map_error(msg)
    if mapped != UNKNOWN_ERROR:
        out["error"] = mapped
    code = portal_code(msg)
    if code:
        out["portal_code"] = code
    return out


def blocked_next_error(nx: dict, step: int, state: dict, shot: str | None) -> dict:
    """A pay-tail Next that did not advance, as a failure dict.

    Pure, and separate from the loop, because getting this wrong is invisible:
    the device stock refusal lands HERE (the portal validates stock on the way to
    Pay, not when the device is ticked), and the first version of this branch
    hardcoded `pay_tail_next_blocked` — throwing away the classification and
    leaving the agent with a page-state dump instead of "change the device".

    Classified: keep the portal's own sentence as the message and pass the code
    up, so BizzFlow can explain it. Unclassified: the old debug-heavy message,
    because then the dump IS the most useful thing we have.
    """
    if nx.get("error"):
        return {"status": "error", "error": nx["error"], "stage": "pay_tail",
                "message": nx.get("message") or "The portal refused the order.",
                **({"portal_code": nx["portal_code"]} if nx.get("portal_code") else {}),
                "portal_message": nx.get("message")}
    return {"status": "error", "error": "pay_tail_next_blocked", "stage": "pay_tail",
            "message": (f"Next #{step} on the way to Pay did not advance — "
                        f"the portal said: {nx.get('message')!r}. "
                        f"Page state: {json.dumps(state, ensure_ascii=False)}"
                        + (f" Screenshot: {shot}" if shot else "")),
            "portal_message": nx.get("message")}


def _device_dialog_error(dlg: dict, device: str, offered: list) -> dict:
    """A device-step refusal, classified.

    Out-of-stock keeps its own code so it does NOT fall into the
    `device_rejected` bucket that `select_device` auto-substitutes for: stock is
    the agent's call, not ours — a silent substitution ships a customer the
    wrong hardware.
    """
    info = classify_dialog(dlg)
    code = info.get("error")
    return {"status": "error", "stage": "device",
            "error": code if code == DEVICE_OUT_OF_STOCK else "device_rejected",
            "device": device, "offered": offered,
            **{k: v for k, v in info.items() if k != "error"}}


async def _dismiss_popup_ok(frame, page, exclude_title_re=r"offer") -> str | None:
    """If a Warning/Error dialog is up (NOT the given one, e.g. the Offer picker),
    read its message, click its OK, and return the message. Else None."""
    dlg = await read_error_dialog(page, exclude_title_re)
    return dlg.get("message") if dlg else None


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


async def _select_device_once(page, dev_code: str, dev_name: str,
                              payload_discover: bool = False,
                              group_names: list = None) -> dict:
    """One attempt at picking a specific device in the Offer dialog.

    Split out of select_device so a portal refusal can be retried with a
    different device WITHOUT re-running the whole order: by the time the portal
    reveals that a device is unorderable, the order number already exists, so
    abandoning the run wastes a real order.
    """
    frame = _frame(page)

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

    # The dialog opens with EVERY group collapsed, so wait for the grid itself
    # rather than for a data row — the rows only exist once a group is expanded.
    dlg = frame.locator('.ui-dialog:visible').last
    try:
        await dlg.locator('tr').first.wait_for(state="visible", timeout=15000)
    except Exception:
        return {"status": "error", "error": "offer_dialog_no_rows",
                "stage": "device", "message": "Offer dialog did not populate."}
    await asyncio.sleep(1.0)

    # Only the mandatory groups are orderable for this plan — expand those. The
    # names come from what an admin recorded off the portal (Plan Details).
    await expand_starred_groups(page, group_names)
    tree = await read_offer_tree(page)

    # No mandatory group at all: this package carries no device (verified on
    # 100Mbps Premium Value). Ordering one anyway is what the portal refuses.
    if not has_starred_group(tree, group_names):
        dump = await dump_offer_dialog(page, "offer_no_starred")
        await _close_offer_dialog(page)
        return {"status": "skipped", "stage": "device", "offered": [],
                "message": "This package has no mandatory offer group — no device to select.",
                "dump": dump}

    offered = starred_devices(tree, group_names)

    # Catalogue discovery: we came here only to read what this package offers.
    # Close the dialog without selecting anything and hand the list back.
    if payload_discover:
        await _close_offer_dialog(page)
        return {"status": "discovered", "stage": "device", "offered": offered,
                "groups": [g["name"] for g in tree
                           if g.get("kind") == "group" and g.get("starred")]}

    if not offered:
        # Starred group present but unreadable — capture the markup so the
        # expand/parse selectors can be corrected against reality.
        dump = await dump_offer_dialog(page, "offer_unreadable")
        return {"status": "error", "error": "offer_group_unreadable", "stage": "device",
                "offered": [], "dump": dump,
                "message": "Couldn't read the package's offer group. The dialog markup "
                           "may have changed — a copy was saved for inspection."}
    print(f"    ↳ offer group devices: {[d['name'] for d in offered]}", flush=True)

    # The discount group is "[Pick 0-1]" and the portal does not always pre-tick
    # it; the order is expected to carry it (see the Offer-dialog screenshot).
    promo = await ensure_promo_discounts(page)
    print(f"    ↳ promo discount: {promo}", flush=True)

    # Find the row by offer code (td[title^="O-<code>-"]) first, else by name.
    # Any row now, not just tr.jqgrow — the grouped grid renders its data rows
    # with markup we can't rely on.
    ticked = await page.evaluate(r"""(([code, name]) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const vis=e=>e&&e.offsetParent!==null;
      const dl=[...d.querySelectorAll('.ui-dialog, .modal.in')].filter(vis).pop(); if(!dl) return 'nodialog';
      const rows=[...dl.querySelectorAll('tr')].filter(r=>r.querySelector('input[type=checkbox]'));
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
        # Name what IS on offer — this is the actionable half, and it's the case
        # that produced the "can't be subscribed through Contactless Journey"
        # rejections (our catalogue lists devices this package never offered).
        names = ", ".join(d["name"] for d in offered[:6]) or "none"
        return {"status": "error", "error": "device_not_in_offer_list", "offered": offered,
                "stage": "device",
                "message": f"{dev_name or dev_code} isn't offered with this package. "
                           f"Available: {names}."}
    if ticked == "nocheckbox":
        return {"status": "error", "error": "device_not_selectable",
                "stage": "device", "message": f"{dev_name or dev_code} has no checkbox (not orderable)."}
    if ticked == "already":
        # Already selected — just OK the dialog (don't re-click / untick).
        await _click_dialog_ok(frame, page)
        return {"status": "ok", "stage": "device", "device": dev_name or dev_code,
                "note": "already ticked", "offered": offered}
    if ticked != "ticked":
        return {"status": "error", "error": "device_tick_failed", "stage": "device", "message": ticked}

    # A rejection popup can appear immediately or after a beat.
    await asyncio.sleep(1.5)
    rej = await read_error_dialog(page, exclude_title_re=r"offer")
    if rej:
        return _device_dialog_error(rej, dev_name or dev_code, offered)

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
    rej = await read_error_dialog(page, exclude_title_re=r"offer")
    if rej:
        return _device_dialog_error(rej, dev_name or dev_code, offered)
    return {"status": "ok", "stage": "device", "device": dev_name or dev_code, "offered": offered}


# How many substitutes to try after the agent's own choice is refused. Two is
# enough to clear the common case (one bad device in a package) without letting a
# package whose devices are ALL refused burn the run's whole time budget.
MAX_DEVICE_SUBSTITUTIONS = 2


async def _close_offer_dialog(page) -> bool:
    """Cancel any open Offer dialog so the next attempt re-opens a clean one
    (clicking Add with one already up stacks a second dialog)."""
    try:
        return await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return false;
          const vis=e=>e&&e.offsetParent!==null;
          const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis).pop(); if(!dl) return false;
          const c=[...dl.querySelectorAll('button, a.btn')].find(
            b=>/^cancel$/i.test((b.innerText||'').trim())) || dl.querySelector('.ui-dialog-titlebar-close');
          if(!c) return false; c.click(); return true;
        })()""")
    except Exception:
        return False


async def select_device(page, payload: dict) -> dict:
    """Pick the order's device, substituting a different one if the portal refuses.

    The portal only reveals that a device is unorderable ("can't be subscribed
    through Contactless Journey") once we are on the order's own detail page —
    the order number already exists by then and cannot be reclaimed. Abandoning
    the run would leave that order stranded, so on a refusal we pick another
    device the portal itself is offering and finish the order.

    Always reports `available_devices` (what the portal actually listed) and, on
    a refusal, `rejected_device_code` — BizzFlow persists both so the picker and
    preflight stop offering that combination.
    """
    dev_code = str(payload.get("deviceCode") or payload.get("device_code") or "").strip()
    dev_name = (payload.get("deviceName") or payload.get("device_name") or "").strip()
    # Offer group names an admin recorded for this plan (see Plan Details).
    group_names = payload.get("offer_groups") or []
    discover = bool(payload.get("discover_only"))
    if not discover and not dev_code and not dev_name:
        return {"status": "skipped", "stage": "device", "message": "no device on order"}

    if discover:
        r = await _select_device_once(page, "", "", payload_discover=True,
                                      group_names=group_names)
        return {**r, "available_devices": r.get("offered", [])}

    tried: list = []
    available: list = []
    first_rejection = None

    for attempt in range(MAX_DEVICE_SUBSTITUTIONS + 1):
        r = await _select_device_once(page, dev_code, dev_name, group_names=group_names)
        if r.get("offered"):
            available = r["offered"]

        if r.get("status") == "skipped":
            return {**r, "available_devices": available}
        if r.get("status") == "ok":
            out = {**r, "available_devices": available}
            if attempt > 0:
                out["substituted_device_code"] = dev_code
                out["substituted_device_name"] = dev_name
                out["rejected_device_code"] = first_rejection["code"]
                out["rejected_device_name"] = first_rejection["name"]
                out["warning"] = (
                    f"{first_rejection['name']} was refused by the portal "
                    f"({first_rejection['message']}) — ordered {dev_name or dev_code} instead. "
                    "Confirm the customer accepts this device."
                )
            return out

        # Retryable: the portal refused the device, or it was never on offer for
        # this package (our catalogue is a different list — see the offer-group
        # notes above). A missing dialog or a failed click is not retryable.
        if r.get("error") not in ("device_rejected", "device_not_in_offer_list"):
            return {**r, "available_devices": available}

        tried.append(dev_code or dev_name)
        if first_rejection is None:
            first_rejection = {"code": dev_code, "name": dev_name or dev_code,
                               "message": r.get("message", "")}

        nxt = next((d for d in available
                    if d["code"] and d["code"] not in tried
                    and d["name"] not in tried), None)
        if not nxt or attempt == MAX_DEVICE_SUBSTITUTIONS:
            return {"status": "error", "error": "device_rejected", "stage": "device",
                    "message": r.get("message"),
                    "device": first_rejection["name"],
                    "rejected_device_code": first_rejection["code"],
                    "rejected_device_name": first_rejection["name"],
                    "available_devices": available}

        print(f"  ↻ device refused ({r.get('message')}) — trying {nxt['name']}", flush=True)
        await _close_offer_dialog(page)
        dev_code, dev_name = nxt["code"], nxt["name"]
        await asyncio.sleep(1.5)

    return {"status": "error", "error": "device_rejected", "stage": "device",
            "message": "No orderable device found for this package.",
            "available_devices": available}


# A page transition, not a step. BizzFlow renders these as a divider on the
# timeline rather than a numbered step, so a 16-step run reads as the sequence of
# portal PAGES an agent would have clicked through by hand.
PAGE_BREAK_STAGE = "page_break"


def page_break(stage, page_name: str) -> None:
    """Mark that Next advanced the portal to a new page."""
    stage(PAGE_BREAK_STAGE, _detail(page_name))


async def click_next_newconn(page, expect_sel: str = None, timeout_ms: int = 20000,
                             stage=None, page_name: str = None) -> dict:
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
    warn = await read_error_dialog(page, exclude_title_re=r"$^")
    if warn:
        # classify_dialog supplies message/error/portal_code/dialog. The login-ID
        # re-roll loop downstream reads `message`, so its shape is unchanged.
        return {"status": "warning", "stage": "next", **classify_dialog(warn)}
    if expect_sel:
        try:
            await frame.locator(expect_sel).first.wait_for(state="visible", timeout=timeout_ms)
        except Exception:
            return {"status": "error", "error": "next_page_not_reached",
                    "stage": "next", "message": f"expected {expect_sel}"}
    # Only on a clean advance: a Next that popped a warning or never reached the
    # next page has not crossed a boundary, and a divider there would claim
    # progress the portal did not make.
    if stage and page_name:
        page_break(stage, page_name)
    return {"status": "ok", "stage": "next"}


# ─────────────────────────────────────────────────────────────────────────────
# Customer Order Information page (after the sub-tabs Next) — attachments (IM +
# ID split across containers), appointment (earliest >12h), Default From Billing
# Address, contact number/email, "Has confirmed the order" gate.  Selectors
# mapped live 2026-08-04; the ID-copy option value + appointment dialog are
# finalized on the first watched run (marked TODO-VERIFY).
# ─────────────────────────────────────────────────────────────────────────────
async def _attachment_page_state(page) -> dict:
    """What the order page actually holds right now — the attachment containers,
    file inputs, headings and any open dialog. Purely diagnostic: an attachment
    step that fails should say what WAS there, not just which selector missed."""
    try:
        return await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
          if(!d) return {err:'no iframe document'};
          const vis=e=>e&&e.offsetParent!==null;
          const T=e=>((e&&e.innerText)||'').trim();
          return {
            containers:[...d.querySelectorAll('.js-attchment-container')]
              .map(c=>({key:c.getAttribute('key'), visible:vis(c),
                        fileInputs:c.querySelectorAll('input[type=file]').length})),
            fileInputsTotal:d.querySelectorAll('input[type=file]').length,
            jsFileUpload:d.querySelectorAll('input[type=file].js-file-upload').length,
            headings:[...d.querySelectorAll('.oe-order-preview-title,h1,h2,h3,legend')]
              .filter(vis).map(e=>T(e).slice(0,40)).filter(Boolean).slice(0,12),
            dialogs:[...d.querySelectorAll('.ui-dialog,.modal.in')].filter(vis)
              .map(dl=>(T(dl.querySelector('.ui-dialog-title,.modal-title')).slice(0,40)
                        +' :: '+T(dl.querySelector('.modal-message,.modal-body')).slice(0,120))
                        .replace(/\n/g,' | ')),
            blockingOverlays:[...d.querySelectorAll('.blockUI,.modal-backdrop')].filter(vis).length,
            nextVisible:[...d.querySelectorAll('.js-btn-next')].filter(vis).length,
          };
        })()""")
    except Exception as e:  # noqa: BLE001
        return {"err": f"{type(e).__name__}: {e}"}


async def _debug_screenshot(page, tag: str) -> str | None:
    """Local full-page screenshot for a failure the capture slots don't cover.
    Best-effort — a diagnostic must never be the thing that breaks the run."""
    try:
        os.makedirs("logs", exist_ok=True)
        path = f"logs/debug_{tag}.png"
        await page.screenshot(path=path, full_page=True)
        return path
    except Exception:
        return None


async def _set_attach_file(page, container_key: str, local_path) -> str:
    """Set files on the hidden <input type=file> inside the attachment container
    with the given key (Playwright set_input_files — the upload icon only triggers
    the same input). Dismisses the 'Succeed in uploading attachment' Success popup
    that fires after each upload."""
    frame = _frame(page)
    scoped = frame.locator(
        f'.js-attchment-container[key="{container_key}"] input[type=file].js-file-upload')
    generic = frame.locator('input[type=file].js-file-upload')

    # Wait for EITHER to exist before choosing, then re-query. The old code read
    # scoped.count() once and, on a page still rendering, bound permanently to
    # `generic.last` — a locator matching nothing — then spent 60s waiting on it
    # and reported the file input as the fault. Decide only once something exists.
    inp = None
    for _ in range(60):  # ~30s, re-querying rather than holding a stale choice
        if await scoped.count():
            inp = scoped.first
            break
        if await generic.count():
            inp = generic.last
            break
        await asyncio.sleep(0.5)
    if inp is None:
        state = await _attachment_page_state(page)
        shot = await _debug_screenshot(page, f"attach_no_input_key{container_key}")
        raise RuntimeError(
            f"no attachment file input rendered for container key={container_key} "
            f"after 30s. Page state: {json.dumps(state, ensure_ascii=False)}"
            + (f" Screenshot: {shot}" if shot else ""))
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
    stage = _stage_emitter(on_stage)

    frame = _frame(page)
    im_paths = im_paths or []
    id_paths = id_paths or []
    steps = {}

    # The Customer Order Information page is AJAX-heavy and can still be rendering
    # when we arrive from Next — grabbing the file input too early fails the upload.
    # Wait for the attachments block (container 1 = the always-present locked IM
    # Conversation slot, or its hidden file input) to actually render, then settle.
    #
    # This wait used to swallow its own timeout. When the block never rendered the
    # run carried on and burned another 60s inside _set_attach_file, surfacing as
    # "set_input_files: Timeout" — which names the file input rather than the page
    # that never arrived. Order 2608000121393253 was stranded exactly that way.
    try:
        await frame.locator(
            '.js-attchment-container[key="1"], input[type=file].js-file-upload'
        ).first.wait_for(state="attached", timeout=45000)
    except Exception:
        state = await _attachment_page_state(page)
        shot = await _debug_screenshot(page, "order_info_no_attachments")
        return {"status": "error", "error": "order_info_not_rendered",
                "stage": "attachments",
                "message": ("The Customer Order Information page never rendered its "
                            "attachment section, so no document could be uploaded. "
                            f"Page state: {json.dumps(state, ensure_ascii=False)}"
                            + (f" Screenshot: {shot}" if shot else "")),
                "page_state": state}
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

    # Which files the portal actually accepted — the upload widget shows the
    # accepted filenames, and nothing else records them.
    await capture_and_report(page, payload, "attachments", stage)

    # …then the rest of this page, BEFORE the appointment step.
    #
    # Ordering is the whole point: these sections are already fully rendered
    # here, and the steps that follow can fail (a real run died on "no available
    # slots found in the calendar"). Capturing after them meant an order that
    # got far enough to exist in the portal produced no record of the devices,
    # the delivery methods or the charges — exactly the run where the evidence
    # matters most. Photograph first, then proceed.
    await capture_sections(page, payload, ORDER_INFO_SECTIONS, stage)

    # ── Appointment (slot chosen by the admin's booking policy) ──────────────
    stage("appointment")
    appt = await _set_appointment(page, payload.get("appointment"))
    steps["appointment"] = appt.get("status")
    if appt.get("status") not in ("ok", "skipped"):
        return {"status": "error", "error": "appointment_failed",
                "stage": "appointment", "message": appt.get("message"), "steps": steps}
    # No capture here. The booked slot is already recorded in the run's own
    # result (appointment policy picked …) and the order_info frame below covers
    # the page; two more JPEGs per attempt bought nothing the log didn't say.

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
    # Contact Name carries no red asterisk, but a blank delivery contact on a
    # courier-delivered device is how a delivery fails. Same name as the
    # installation contact. Everything else in the block (Office/Fax Number,
    # Gender, Delivery Comments, Expected Delivery Date, Post PickUp
    # Organization) is left alone: none is required, and every field the
    # automation types is another selector that can break with a wrong value.
    name = (payload.get("customer", {}) or {}).get("name", "") or contact.get("name", "")
    steps["contacts"] = await page.evaluate(r"""(([area, number, email, name]) => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const set=(sel,val)=>{const el=d.querySelector(sel);
        if(!el) return false; if(val){el.removeAttribute('disabled'); el.disabled=false; el.value=val;
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          el.dispatchEvent(new Event('blur',{bubbles:true}));} return true;};
      const a=set('input[name=mobileAreaCode]',area), p=set('input[name=mobilePhone]',number),
            e=set('input[name=email]',email);
      // The portal's own name for this field is unconfirmed, so try the likely
      // ones rather than betting on one. Skip-if-absent, like every other field
      // here — a missing optional field must never fail an order.
      const n=['input[name=contactName]','input[name=deliveryContactName]',
               'input[name=receiverName]','input[name=linkman]']
              .some(s=>set(s,name));
      return (a||p||e) ? (n ? 'ok' : 'ok (no contact-name field found)') : 'skipped';
    })""", [area, number, email, name])

    # ── Has confirmed the order with customer (iCheck widget — click the WRAPPER;
    # the hidden input is off-viewport for a normal click). Skip-if-absent. ──
    steps["confirm"] = await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return 'nodoc';
      const s=d.querySelector('input[name=sure]'); if(!s) return 'skipped';
      if(s.checked) return 'already';
      const wrap=s.closest('div[class*=icheckbox]'); const helper=wrap&&wrap.querySelector('.iCheck-helper');
      (helper||wrap||s).click(); return s.checked ? 'ok' : 'clicked';
    })()""")

    # The whole Customer Order Information page as submitted: delivery contact
    # number, email, the confirmed-with-customer flag and any remarks.
    await capture_and_report(page, payload, "order_info", stage)

    return {"status": "ok", "stage": "customer_order_info", "steps": steps}


# Reads the Appointment FullCalendar and reports WHAT IT SAW, not just what it
# found. The previous version returned a bare list, so a selector that stopped
# matching was indistinguishable from a portal with no slots — and live, that is
# exactly what happened: every run died on "no available slots found in the
# calendar" while the same calendar, opened by hand, offered four slots a day.
#
# Two changes make that impossible to repeat:
#
#   1. Selectors are TRIED IN ORDER and the one that matched is reported, so a
#      FullCalendar upgrade (`.fc-day` -> `.fc-daygrid-day`) shows up as a
#      different `daySelector` rather than as silence.
#   2. Events are matched to their day STRUCTURALLY first (`cell.contains(ev)`),
#      falling back to the geometric hit-test only when the events really are
#      positioned outside their cells — the case the original code was written
#      for. Events that match neither are COUNTED (`unmatched`) instead of
#      being dropped.
#
# Lead time is deliberately NOT applied here: which slot to take is policy, set
# in admin, and applying it in the browser is what made it a hard-coded constant
# that needed a deploy to change. This returns every slot the portal offers,
# ascending; `choose_slot` decides.
_APPT_READ_JS = r"""(() => {
  const out = {dialog:false, dayCells:0, events:0, unmatched:0, matchedBy:null,
               daySelector:null, eventSelector:null, slots:[], samples:[]};
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument;
  if(!d) { out.error='nodoc'; return out; }
  const vis=e=>e&&e.offsetParent!==null;
  const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis)
    .find(x=>/Appointment/i.test(((x.querySelector('.modal-title,.ui-dialog-title')||{}).innerText)||''));
  if(!dl) return out;
  out.dialog = true;

  // Whichever of these the portal's FullCalendar build actually emits.
  const DAY_SEL = ['.fc-daygrid-day[data-date]', '.fc-day[data-date]',
                   'td[data-date]', '[data-date]'];
  const EV_SEL  = ['.fc-daygrid-event', '.fc-event', '[class*="fc-event"]',
                   '.fc-daygrid-day-events a'];

  let dayEls = [];
  for (const sel of DAY_SEL) {
    const els = [...dl.querySelectorAll(sel)];
    if (els.length) { dayEls = els; out.daySelector = sel; break; }
  }
  let evEls = [];
  for (const sel of EV_SEL) {
    const els = [...dl.querySelectorAll(sel)].filter(vis);
    if (els.length) { evEls = els; out.eventSelector = sel; break; }
  }
  out.dayCells = dayEls.length;
  out.events   = evEls.length;

  // Recorded so a live run ANSWERS the "what is the markup really?" question
  // instead of only proving the guess wrong again.
  out.samples = evEls.slice(0,3).map(e => ({
    cls: (e.className||'').toString().slice(0,80),
    text: (e.innerText||'').trim().slice(0,60),
  }));
  if (dayEls.length) out.dayClass = (dayEls[0].className||'').toString().slice(0,80);

  const days = dayEls.map(c => {
    const r = c.getBoundingClientRect();
    return {el:c, date:c.getAttribute('data-date'),
            l:r.left, r:r.right, t:r.top, b:r.bottom};
  });

  // Structural containment first — it is exact where geometry is a guess, and
  // it survives a scrolled or off-screen dialog (zero rects) that would defeat
  // the hit-test entirely.
  //
  // The geometric fallback picks the day cell the event OVERLAPS MOST, not the
  // first cell whose box contains the event's top-left corner. That corner test
  // (with 30px of slop below the cell) is what the original code did, and it
  // was measurably wrong live: an event sitting near the top of one week's row
  // also falls inside the row ABOVE's box + 30px, and that row is earlier in
  // the DOM, so it won. Every slot came back dated exactly seven days early —
  // the reader reported 11-17 August for a calendar offering 18-31, and a
  // click on the event it called "18 Aug" booked 25 Aug in the portal.
  //
  // Overlap has no such tie: an event lies in one row's band and nowhere else.
  const findDay = (ev, geometric) => {
    if (!geometric) return days.find(dd => dd.el.contains(ev));
    const r = ev.getBoundingClientRect();
    let best = null, bestArea = 0;
    for (const dd of days) {
      const w = Math.min(r.right, dd.r) - Math.max(r.left, dd.l);
      const h = Math.min(r.bottom, dd.b) - Math.max(r.top, dd.t);
      if (w <= 0 || h <= 0) continue;
      const area = w * h;
      if (area > bestArea) { bestArea = area; best = dd; }
    }
    return best;
  };

  const read = (geometric) => {
    const slots = []; let unmatched = 0;
    for (const ev of evEls) {
      const day = findDay(ev, geometric);
      const tm = (ev.innerText||'').match(/(\d{2}:\d{2}(?::\d{2})?)/);
      if (day && day.date && tm) {
        const t = tm[1].length === 5 ? tm[1] + ':00' : tm[1];
        slots.push(day.date + ' ' + t);
      } else { unmatched++; }
    }
    return {slots, unmatched};
  };

  let r = read(false);
  out.matchedBy = 'contains';
  if (!r.slots.length && evEls.length) {   // events positioned outside their cells
    r = read(true);
    out.matchedBy = 'geometry';
  }
  out.unmatched = r.unmatched;
  out.slots = [...new Set(r.slots)].sort();
  return out;
})()"""


# How long to keep re-reading the calendar before calling it empty, and how
# often. The dialog is opened by a click and fills itself from an AJAX call, so
# a single read taken a fixed 3s later cannot tell "the portal offered nothing"
# from "the portal had not answered yet" — and both used to print the same
# sentence. Polling costs nothing when the slots are already there (it returns on
# the first read) and is the difference between a false failure and a booking
# when they are not.
_APPT_READ_TIMEOUT_S = 25
_APPT_READ_INTERVAL_S = 1.0


async def _read_calendar(page, timeout_s: int = _APPT_READ_TIMEOUT_S) -> dict:
    """Read the calendar until it has slots, or until `timeout_s` runs out.

    Returns the LAST diagnostic either way, with `waitedMs` added, so a caller
    that finds nothing can still say what it saw and for how long it looked.
    Progress is printed whenever the counts change — a calendar that goes
    0 -> 96 events at t=8s is a very different bug report from one that sits at
    0 for the full 25 seconds.
    """
    import time as _time
    started = _time.monotonic()
    diag: dict = {}
    last_shape = None
    while True:
        try:
            got = await page.evaluate(_APPT_READ_JS)
            diag = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001
            diag = {"error": f"read_failed: {type(e).__name__}"}
        elapsed = _time.monotonic() - started
        shape = (diag.get("dialog"), diag.get("dayCells"), diag.get("events"))
        if shape != last_shape:
            print(f"    calendar @{elapsed:4.1f}s: dialog={shape[0]} days={shape[1]} "
                  f"events={shape[2]}", flush=True)
            last_shape = shape
        if diag.get("slots"):
            break
        if elapsed >= timeout_s:
            break
        await asyncio.sleep(_APPT_READ_INTERVAL_S)
    diag["waitedMs"] = int((_time.monotonic() - started) * 1000)
    return diag


# Marks the one calendar event we intend to click, so Playwright can address it
# with a locator. The alternative — clicking by coordinates — has to add the
# iframe's own offset and re-measure after every re-render; a marker attribute
# survives both and names exactly one node.
_APPT_TAG = "data-oe-appt"

# Finds the event for "YYYY-MM-DD HH:MM:SS" using the SAME day matching the
# reader uses (max overlap), and marks it. Any previous mark is cleared first so
# a retry can never click the slot the last attempt aimed at.
_TAG_SLOT_JS = r"""((want) => {
  const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return false;
  const vis=e=>e&&e.offsetParent!==null;
  d.querySelectorAll('[TAGATTR]').forEach(e=>e.removeAttribute('TAGATTR'));
  const dl=[...d.querySelectorAll('.ui-dialog')].filter(vis)
    .find(x=>/Appointment/i.test(((x.querySelector('.modal-title,.ui-dialog-title')||{}).innerText)||''));
  if(!dl) return false;
  const DAY_SEL=['.fc-daygrid-day[data-date]','.fc-day[data-date]','td[data-date]','[data-date]'];
  let dayEls=[];
  for (const sel of DAY_SEL) { const els=[...dl.querySelectorAll(sel)];
    if (els.length) { dayEls=els; break; } }
  const days=dayEls.map(c=>{const r=c.getBoundingClientRect();
    return {el:c, date:c.getAttribute('data-date'), l:r.left, r:r.right, t:r.top, b:r.bottom};});
  const EV_SEL=['.fc-daygrid-event','.fc-event','[class*="fc-event"]','.fc-daygrid-day-events a'];
  let evEls=[];
  for (const sel of EV_SEL) { const els=[...dl.querySelectorAll(sel)].filter(vis);
    if (els.length) { evEls=els; break; } }
  const wantDate=want.slice(0,10), wantTime=want.slice(11);
  for (const ev of evEls) {
    const tm=(ev.innerText||'').match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (!tm) continue;
    const t = tm[1].length===5 ? tm[1]+':00' : tm[1];
    if (t !== wantTime) continue;
    let day = days.find(dd => dd.el.contains(ev));
    if (!day) {
      const r=ev.getBoundingClientRect(); let best=null, bestArea=0;
      for (const dd of days) {
        const w=Math.min(r.right,dd.r)-Math.max(r.left,dd.l);
        const h=Math.min(r.bottom,dd.b)-Math.max(r.top,dd.t);
        if (w<=0||h<=0) continue;
        const a=w*h; if (a>bestArea) { bestArea=a; best=dd; }
      }
      day = best;
    }
    if (day && day.date === wantDate) { ev.setAttribute('TAGATTR','1'); return true; }
  }
  return false;
})""".replace("TAGATTR", _APPT_TAG)


async def _tag_slot_event(page, slot: str) -> bool:
    """Mark the calendar event for `slot` so it can be clicked. False if gone."""
    try:
        return bool(await page.evaluate(_TAG_SLOT_JS, slot))
    except Exception as e:  # noqa: BLE001
        print(f"    ⚠ could not tag slot {slot}: {type(e).__name__}", flush=True)
        return False


async def _set_appointment(page, policy=None) -> dict:
    """Appointment: Add (`.js-add-date`) -> Appointment dialog (a FullCalendar).
    Read the REAL available slots off the calendar, apply the admin's booking
    policy (`policy`: strategy / lead_hours / fixed_date — see
    appointment_policy), then for each acceptable slot in turn
    **Playwright-fill** `firstPreferredDatetime` — a JS `.value=` does NOT register
    with the datetimepicker widget; a Playwright fill does — and click OK. If the
    portal warns "Please select at least appointment" (the slot wasn't accepted),
    try the next. Skips cleanly if already booked or no appointment control.

    Every way of ending up with nothing to book gets its OWN message. They used
    to share one ("no available slots found in the calendar"), which is why a
    calendar that visibly offered four slots a day read as empty for weeks.

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

    diag = await _read_calendar(page)
    print(f"  calendar: dialog={diag.get('dialog')} days={diag.get('dayCells')} "
          f"events={diag.get('events')} unmatched={diag.get('unmatched')} "
          f"via {diag.get('daySelector')!r}/{diag.get('eventSelector')!r} "
          f"matched-by={diag.get('matchedBy')} -> {len(diag.get('slots') or [])} slots",
          flush=True)
    if diag.get("samples"):
        print(f"  calendar sample events: {diag['samples']}", flush=True)

    slots = diag.get("slots") or []
    if not slots:
        return {"status": "error", "stage": "appointment",
                "message": describe_read_failure(diag), "calendar": diag}

    picked = choose_slot(slots, policy)
    if "slot" not in picked:
        # The calendar was read fine; the POLICY excluded everything. Says which.
        return {"status": "error", "stage": "appointment",
                "message": picked["message"], "calendar": diag}
    candidates = picked["candidates"]
    print(f"  appointment policy picked {picked['slot']} "
          f"({len(candidates)} acceptable of {len(slots)} offered)", flush=True)

    for cand in candidates[:10]:
        tagged = await _tag_slot_event(page, cand)
        if not tagged:
            continue  # that slot's event is no longer on screen — try the next
        try:
            # A REAL click. Filling firstPreferredDatetime and pressing OK does
            # nothing: the value lands in the box, the portal answers "Please
            # select at least appointment", and every slot fails identically —
            # which is what the old retry loop then reported as "no calendar
            # slot accepted". A synthetic el.click() is no better; this
            # FullCalendar binds jQuery handlers that only a trusted event
            # sequence satisfies. Verified live: fill+OK rejected, el.click()+OK
            # rejected, Playwright click + OK booked.
            await frame.locator(f'[{_APPT_TAG}]').first.click(timeout=6000)
        except Exception:
            continue
        await asyncio.sleep(1.0)
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
            "message": f"no calendar slot accepted (tried {len(candidates[:10])} of "
                       f"{len(slots)} offered)", "calendar": diag}


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


async def _ensure_bypass_acknowledge(page) -> bool:
    """On the Terms & Conditions page, make sure 'Bypass Acknowledge' is checked
    (it's default-checked; this is defensive). iCheck-safe. No-op elsewhere.

    Returns True when the control was found — i.e. when we are actually ON the
    T&C page. That is what tells the caller this screen is worth capturing; the
    pay tail otherwise has no way to name the page it is looking at.
    """
    return bool(await page.evaluate(r"""(() => {
      const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return false;
      const lbl=[...d.querySelectorAll('label, span')].find(e=>/bypass\s*acknowledge/i.test(e.innerText||''));
      if(!lbl) return false;
      const grp=lbl.closest('.form-group, .checkbox, div') || lbl.parentElement;
      const cb=grp && grp.querySelector('input[type=checkbox]');
      if(cb && !cb.checked){ const wrap=cb.closest('div[class*=icheckbox]');
        const helper=wrap&&wrap.querySelector('.iCheck-helper'); (helper||wrap||cb).click(); }
      return true;
    })()"""))


def is_portal_order_number(value: str | None) -> bool:
    """Does this look like a Customer Order Number the portal minted?

    The scraper-side twin of BizzFlow's `isPortalOrderNumber` (order-types.ts).
    Both ends check the shape because both ends can put a value into
    `Order.orderId`, and a failure sentence written there makes the row claim a
    portal order that does not exist.
    """
    return bool(value and re.fullmatch(r"\d{10,20}", value.strip()))


# The confirmation screen's Print e-RF control.
#
# Matched on the button's TEXT, not a class: this page has never been inspected,
# only photographed, so its markup is unknown. The text is what the screenshot
# actually shows. `e-RF` is written with a hyphen there; the pattern tolerates a
# space or none in case the portal is inconsistent about it elsewhere.
_ERF_BUTTON_SELECTOR = (
    'button:has-text("Print e-RF"):visible, a:has-text("Print e-RF"):visible, '
    '.btn:has-text("Print e-RF"):visible')


async def _find_erf_page(frame) -> dict | None:
    """Read the post-Pay confirmation page, or None if this isn't it.

    Terminal condition for the post-Pay chain. Keyed on the Print e-RF control
    rather than on the heading: the heading is "New Connection", the same words
    as page 1, so a title match would end the loop several pages early. That
    button exists on exactly one screen of the flow.

    Returns {order_id} — the number out of "Customer Order Number <n>" in the
    heading, which is the number printed on the document the button downloads.
    """
    try:
        if not await frame.locator(_ERF_BUTTON_SELECTOR).count():
            return None
    except Exception:  # noqa: BLE001
        return None
    txt = await frame.locator("body").first.inner_text()
    m = re.search(r"Customer\s+Order\s+N(?:o|umber)\.?\s*[:：]?\s*([A-Z0-9]{6,})", txt, re.I)
    oid = m.group(1) if m else None
    return {"order_id": oid,
            "order_url": _order_detail_url(oid) if oid else None}


async def capture_erf_pdf(page, payload: dict, order_no: str, stage) -> dict | None:
    """Click Print e-RF, catch the download, put the PDF in R2. Never raises.

    Runs AFTER a real payment, which is the whole reason every failure path here
    returns rather than raises: the customer has been charged, and a missing
    document must not turn a paid order into a failed one.

    Print e-RF is expected to produce a file download. It could instead open a
    popup tab or call window.print(); rather than guess, this waits for a
    download and REPORTS what it saw when none arrives — including whether a
    popup opened — so the first live run settles the question with evidence.
    """
    if not _capture_enabled("erf"):
        return None
    ref = (payload or {}).get("order_ref") or {}
    user_id, order_id = ref.get("user_id"), ref.get("order_id")
    if not user_id or not order_id:
        return None

    frame = _frame(page)
    popup = {"opened": None}
    page.once("popup", lambda p: popup.__setitem__("opened", p.url or "(no url)"))

    try:
        async with page.expect_download(timeout=45000) as dl_info:
            await frame.locator(_ERF_BUTTON_SELECTOR).first.click(timeout=10000)
        download = await dl_info.value
        path = await download.path()
        with open(path, "rb") as fh:
            data = fh.read()
        portal_name = download.suggested_filename
    except Exception as e:  # noqa: BLE001
        note = f"{type(e).__name__}: {e}"
        if popup["opened"]:
            note += f" (a popup opened instead: {popup['opened']})"
        print(f"  ⚠ e-RF download failed: {note}", flush=True)
        return _detail("e-RF not downloaded", "failed", note)

    # The portal's own filename is logged, never used as the key — see erf_key.
    print(f"  ✓ e-RF downloaded: {portal_name} ({len(data)} bytes)", flush=True)
    try:
        from r2_upload import erf_key, upload_bytes
        key = erf_key(user_id, order_id, order_no)
        upload_bytes(key, data, "application/pdf")
        print(f"  ✓ e-RF uploaded: {key}", flush=True)
        detail = _detail(key)
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ e-RF upload failed: {type(e).__name__}: {e}", flush=True)
        detail = _detail("e-RF not stored", "failed", f"{type(e).__name__}: {e}")
    stage(capture_stage_name("erf"), detail)
    return detail


async def _read_advance_payment(frame) -> str | None:
    """Read the 'Advance Payment' RM amount off the Pay-page fee preview (record it;
    AP/deposit is NOT an error)."""
    txt = await frame.locator("body").first.inner_text()
    m = re.search(r"Advance\s*Paym\w*[^0-9]*RM\s*([0-9.,]+)", txt, re.I)
    return m.group(1) if m else None


async def pay_and_submit(page, do_pay: bool = False, max_next: int = 4,
                         payload: dict = None, on_stage=None) -> dict:
    """From the Customer Order Information page: Next through Terms & Conditions
    (Bypass Acknowledge is default-checked) to the Pay page; then (if do_pay) Pay
    and Next to the 'Submit Successfully' page. Returns {status:'ready_to_pay',
    advance_payment} when gated, or {status:'submitted', order_id, order_url,
    advance_payment} after a real submit.

    `payload`/`on_stage` are only used to capture the two screens on this tail —
    the terms the order was placed under, and the Pay screen before the click."""
    stage = _stage_emitter(on_stage)
    frame = _frame(page)

    # Advance until a Pay button is visible (Customer Order Info -> T&C -> Pay).
    pay_loc = frame.locator(
        '.js-btn-pay:visible, .js-pay:visible, button:has-text("Pay"):visible')
    captured_terms = False
    for step in range(max_next):
        if await pay_loc.count():
            break
        on_terms = await _ensure_bypass_acknowledge(page)  # False unless on T&C
        if on_terms and not captured_terms:
            # The terms the order was placed under. Captured BEFORE Next, since
            # this page is gone the moment we advance.
            captured_terms = True
            await capture_and_report(page, payload, "delivery", stage)
        # The tail is a loop of unnamed intermediate pages (terms, delivery,
        # confirmations) whose count varies per offer, so each divider is
        # numbered rather than named — claiming a page name we haven't checked
        # for would be worse than admitting we only know it advanced.
        nx = await click_next_newconn(page, stage=stage,
                                      page_name=f"Next page ({step + 1})")
        # Any non-ok means Next did NOT cross a page boundary. This used to abort
        # only on "error" and fall through on "warning" — so a portal Warning
        # ("please tick …", "incomplete …") was dismissed, its text discarded, and
        # the loop clicked a Next that could never advance four times over. The
        # run then blamed a missing Pay button. The order-info Next above already
        # checks != "ok"; this is the same check, and the portal's own wording is
        # the whole answer, so it goes in the message.
        if nx.get("status") != "ok":
            state = await _attachment_page_state(page)
            shot = await _debug_screenshot(page, f"pay_tail_next{step + 1}")
            # This is where the device stock refusal actually lands — the portal
            # validates stock on the way to Pay, not when the device is ticked.
            # A classified failure keeps the portal's OWN sentence as the message
            # and hands the code up: BizzFlow renders an explanation and names
            # the field to change, which the page-state dump below cannot do.
            # The dump still goes to the run log, where debugging wants it.
            print(f"    ↳ pay tail blocked at Next #{step + 1}: "
                  f"state={json.dumps(state, ensure_ascii=False)} shot={shot}", flush=True)
            return blocked_next_error(nx, step + 1, state, shot)
        await asyncio.sleep(2)
    if not await pay_loc.count():
        state = await _attachment_page_state(page)
        shot = await _debug_screenshot(page, "pay_button_not_found")
        return {"status": "error", "error": "pay_button_not_found", "stage": "pay_tail",
                "message": (f"No Pay button after {max_next} Next clicks that each "
                            f"advanced cleanly. Page state: "
                            f"{json.dumps(state, ensure_ascii=False)}"
                            + (f" Screenshot: {shot}" if shot else ""))}

    advance_payment = await _read_advance_payment(frame)
    # The amount, and any advance payment, exactly as the portal presented it —
    # taken BEFORE the billable click, so it is evidence either way: with
    # do_pay=False this is the last frame of the run.
    await capture_and_report(page, payload, "pay", stage)

    if not do_pay:
        # SAFETY GATE — stop before the billable click.
        return {"status": "ready_to_pay", "stage": "pay_gate",
                "advance_payment": advance_payment,
                "message": "Reached Pay page; do_pay=False so NOT submitting."}

    await pay_loc.first.click(timeout=8000)
    await asyncio.sleep(3)
    # Dismiss only a payment-confirm prompt — NOT the success page.
    await _dismiss_popup_ok(frame, page, exclude_title_re=r"success")

    # ── Everything below this line runs AFTER a real charge ──────────────────
    # The money has moved. Nothing here may turn a paid order into a failed one:
    # every artefact is best-effort, and the only outcome that reports an error
    # is the one where we came away with no order number at all.
    return await _post_pay_tail(page, payload, stage, advance_payment)


async def _post_pay_tail(page, payload: dict, stage, advance_payment: str | None,
                         max_next: int = 6) -> dict:
    """Pay -> Next … Next -> the confirmation page with Print e-RF.

    The old version clicked Next at most three times looking for the words
    "Submit Successfully" and reported `submit_result_not_found` otherwise. The
    portal's actual last page says no such thing — it is headed "New Connection /
    Customer Order Number <n>" and carries the service numbers the order was
    assigned and a Print e-RF button. So a run could complete a real payment and
    still come back with no order id, which is the worst failure this flow has.

    Terminates on the e-RF page, keeps honouring a "Submit Successfully" screen
    if the portal shows one on the way, and captures the confirmation page and
    the e-RF PDF before returning.
    """
    frame = _frame(page)
    # The best confirmation seen SO FAR, remembered across iterations.
    #
    # Load-bearing, not tidiness: a "Submit Successfully" screen appears on one
    # page and is gone the moment we Next past it looking for the e-RF page. Read
    # it and drop it, and a run that then fails to find the e-RF page reports
    # "no order number" for an order whose number we had already read and paid
    # for — the exact failure this whole tail exists to prevent, arriving by the
    # most likely live route (the Print e-RF text not matching).
    seen = None
    for step in range(max_next):
        erf = await _find_erf_page(frame)
        if erf:
            return await _finish_on_erf_page(page, payload, stage, advance_payment, erf)

        res = await _find_submit_result(frame)
        if res:
            # A confirmation screen on the way to the e-RF page — keep the number
            # and carry on; the document is still one or more Nexts away.
            print(f"    ↳ submit confirmation seen: {res}", flush=True)
            seen = _better_confirmation(seen, res)

        nx = await click_next_newconn(page, stage=stage,
                                      page_name=f"After payment ({step + 1})")
        if nx.get("status") != "ok":
            # Paid, and stuck. If a number was read at any point this is a
            # submitted order that merely lost its paperwork; only a run that
            # never saw one is a genuine error.
            return _post_pay_outcome(
                seen, advance_payment,
                f"the flow could not reach the e-RF page: "
                f"{nx.get('message', 'Next did not advance.')}")
        await asyncio.sleep(3)

    erf = await _find_erf_page(frame)
    if erf:
        return await _finish_on_erf_page(page, payload, stage, advance_payment, erf)
    seen = _better_confirmation(seen, await _find_submit_result(frame))
    return _post_pay_outcome(
        seen, advance_payment,
        f"the e-RF page was not reached in {max_next} Next clicks, so no "
        f"registration form was saved.")


def _better_confirmation(current: dict | None, found: dict | None) -> dict | None:
    """Keep whichever confirmation actually carries a usable order number.

    `_find_submit_result` returns a dict with `order_id: None` when it matches
    the success wording but not the number, so "we saw a confirmation" and "we
    know the order number" are NOT the same thing, and a later numberless match
    must never displace an earlier good one.
    """
    if found and is_portal_order_number(found.get("order_id")):
        return found
    if current:
        return current
    return found


def _post_pay_outcome(seen: dict | None, advance_payment: str | None,
                      what_went_wrong: str) -> dict:
    """Submitted-with-a-warning if we know the order number, stranded if not.

    One place decides this, because the difference between those two outcomes is
    the difference between an order the agent can look up and one they have to
    hunt for in the portal by hand.
    """
    if seen and is_portal_order_number(seen.get("order_id")):
        return {"status": "submitted", "stage": "done",
                "advance_payment": advance_payment,
                "warning": ("Payment went through and the order was confirmed, but "
                            f"{what_went_wrong}"),
                **seen}
    return _paid_but_stranded(what_went_wrong.strip().capitalize(), advance_payment)


def _paid_but_stranded(detail: str | None, advance_payment: str | None) -> dict:
    """The one error this tail may return — and it leads with the payment.

    Whoever reads this has to know a charge was made before they read anything
    else, because the recovery is to check the portal by hand, not to resubmit.
    """
    return {"status": "error", "error": "post_pay_not_confirmed", "stage": "pay_tail",
            "advance_payment": advance_payment,
            "message": ("PAYMENT WAS SUBMITTED, but the portal never showed a confirmed "
                        "order number afterwards. Check the order in the portal before "
                        "retrying — do NOT resubmit blind. "
                        f"{detail or ''}").strip()}


async def _finish_on_erf_page(page, payload: dict, stage, advance_payment: str | None,
                              erf: dict) -> dict:
    """Photograph the confirmation page, download the e-RF, and return submitted.

    In that order, and the order matters: the click may navigate away, and this
    page is the only screen listing the service numbers the portal assigned
    against what each one bought. The Pay capture is taken before the click, so
    none of those numbers exist in any earlier frame.
    """
    await capture_and_report(page, payload, "erf_page", stage)
    # The service breakdown runs down the page inside the portal's inner
    # scroller, so the first frame only ever holds the top of it — the same
    # geometry every other detail page has. A second, anchored frame follows.
    if await _scroll_to_heading(page, r"service\s*number"):
        await capture_and_report(page, payload, "erf_page" + BOTTOM_SUFFIX, stage)

    order_no = erf.get("order_id")
    result = {"status": "submitted", "stage": "done",
              "advance_payment": advance_payment, **erf}
    if not is_portal_order_number(order_no):
        # The page is the right one (Print e-RF is on it) but the heading did not
        # yield a usable number. The form is still worth having; it is named for
        # the order it belongs to, so it goes under the id we do hold.
        print(f"    ⚠ e-RF page reached but its order number reads {order_no!r}", flush=True)
        result["warning"] = ("The order was submitted and paid, but the confirmation page's "
                             "Customer Order Number could not be read.")
        order_no = str(((payload or {}).get("order_ref") or {}).get("order_id") or "")

    await capture_erf_pdf(page, payload, order_no, stage)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator: the whole New Connection detail flow after the order id is minted.
# ─────────────────────────────────────────────────────────────────────────────
async def submit_new_connection(page, payload: dict, im_paths: list = None,
                                id_paths: list = None, do_pay: bool = False,
                                on_stage=None) -> dict:
    """page1 (contact/account/winback) -> device -> sub-tabs -> Next ->
    Customer Order Information -> Pay/Submit (gated). Returns the pay_and_submit
    result on success, or the first failing stage's error."""
    _emit = _stage_emitter(on_stage)

    def stage(n, detail=None):
        print(f"  ▶ submit_new_connection stage: {n}", flush=True)
        _emit(n, detail)

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
    device_info = {k: r[k] for k in _DEVICE_PASSTHROUGH if r.get(k)}
    if r.get("warning"):
        device_info["warning"] = r["warning"]
    # Discovery stops here: the order exists (unavoidably), but we never fill in
    # or pay for it. The caller flags it for voiding.
    if r.get("status") == "discovered":
        return r
    if r.get("status") != "ok":
        return r

    stage("customer_order_info")
    nx = await click_next_newconn(page, stage=stage,
                                  page_name="Customer Order Information")
    print(f"    ↳ next->order_info: {nx}", flush=True)

    # The service login is reserved HERE, not at the per-tab Check, so a name
    # that looked free can still be rejected on this Next:
    #   "RESERVELOGIN error. [1]:LOGIN_ID [tklee812@iptv] … already in use by
    #    other customer"
    # The order is already minted at this point, so failing out strands it over a
    # name collision that a re-roll fixes. Re-roll the offending tab and retry.
    email = (payload.get("customer", {}).get("contact", {}) or {}).get("email", "")
    tried_logins = set()
    for retry in range(3):
        if not is_login_taken(nx.get("message")):
            break
        rejected = taken_login_id(nx.get("message"))
        # LOGIN_ID comes back as 'tklee812@iptv'; the field holds only 'TKLEE812'.
        prefix = (rejected or "").split("@")[0] or None
        if prefix:
            tried_logins.add(prefix.upper())
        print(f"    ↳ login {rejected!r} already in use — re-rolling and retrying Next "
              f"({retry + 1}/3)", flush=True)
        ra = await _reassign_service_numbers(page, email, tried_logins, only_prefix=prefix)
        print(f"    ↳ reassigned: {ra}", flush=True)
        if ra.get("errors"):
            return {"status": "error", "stage": "customer_order_info",
                    "error": "service_number_reassign_failed", **device_info,
                    "message": f"Could not re-roll the service username: {ra['errors']}"}
        nx = await click_next_newconn(page, stage=stage,
                                      page_name="Customer Order Information")
        print(f"    ↳ next->order_info (after re-roll): {nx}", flush=True)

    # A warning here (e.g. "Please select one offer in … Smart Device group") means
    # Next did NOT advance — surface it as the error instead of blindly proceeding
    # into the attachment page (which then fails with a cryptic file-input timeout).
    if nx.get("status") != "ok":
        # The stage stays where the run actually stopped, even for a classified
        # failure: rewriting it to the step whose field needs changing would make
        # the checklist show the run going backwards. Naming the field is the
        # error copy's job, not the stage's.
        return {"status": "error", "stage": "customer_order_info",
                "error": nx.get("error", "next_blocked"), **device_info,
                **({"portal_code": nx["portal_code"]} if nx.get("portal_code") else {}),
                **({"dialog": nx["dialog"]} if nx.get("dialog") else {}),
                "message": nx.get("message", "Next did not advance to Customer Order Information.")}
    r = await fill_customer_order_info(page, payload, im_paths=im_paths,
                                       id_paths=id_paths, on_stage=on_stage)
    print(f"    ↳ customer_order_info: {r}", flush=True)
    if r.get("status") != "ok":
        return r

    stage("pay")
    r = await pay_and_submit(page, do_pay=do_pay, payload=payload, on_stage=on_stage)
    print(f"    ↳ pay_and_submit: {r}", flush=True)
    # A device substitution must survive to the very end: the order that gets
    # paid for is not the device the agent picked, and BizzFlow has to say so.
    for k, v in device_info.items():
        r.setdefault(k, v)
    return r


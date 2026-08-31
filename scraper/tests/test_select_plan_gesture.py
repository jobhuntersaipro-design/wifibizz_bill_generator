"""Choosing an offer must use the gesture the portal listens for.

ORD-0006 failed six times at "Placing order". The correct row, in the only
offer grid, was highlighted — and `.js-orderNow` still carried Bootstrap's
`hide`, so the click that followed spent 45s waiting for a visibility that was
never coming and was reported as "the portal may be slow".

The portal's own jQuery bindings settled it:

    grid: ['remove', 'reloadGrid', 'click', 'grid:ondblclickrow', 'mouseover']

The grid binds a DOUBLE-click row handler. A single click only sets jqGrid's own
highlight, which is why the row looked chosen while the app never reacted.

The fixture below is that behaviour in miniature: single click highlights,
double click reveals Order. A single-clicking select_plan cannot pass it.

Run from the scraper/ dir:
    pytest tests/test_select_plan_gesture.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    OFFER_ROW_INDEX_JS, _capture_order_id, classified_refusal, read_dialog_texts,
    select_plan)

# Two offers whose names differ only past the point where a "contains" match
# would be ambiguous, plus the portal's real quirks: an internal id in the first
# title cell, and a lowercase "unifi" on one row so the case-sensitive attribute
# selectors miss and the fuzzy path runs.
GRID = """
<!-- Bootstrap's own rule. Without it `hide` is an inert class name, the button
     is visible from the start, and every assertion here passes vacuously — as
     the single-click control test proved on the first run. -->
<style>.hide{display:none}</style>
<table class="js-offer-grid">
  <tr class="jqgrow">
    <td title="C300201">C300201</td>
    <td title="unifi Home 300Mbps Broadband">unifi Home 300Mbps Broadband</td>
  </tr>
  <tr class="jqgrow">
    <td title="c4cocwbJIFESnv5U6q1YRwvEhQ3AT3iF">id</td>
    <td title="Unifi Home 500Mbps Premium Value With Device (36M)">Unifi Home 500Mbps Premium Value With Device (36M)</td>
    <td title="FTTH">FTTH</td>
  </tr>
</table>
<button type="button" class="btn btn-default js-orderNow hide">Order</button>
<script>
  var grid = document.querySelector('.js-offer-grid');
  // Single click: jqGrid's highlight only — deliberately does NOT reveal Order.
  grid.addEventListener('click', function (e) {
    var tr = e.target.closest('tr.jqgrow');
    if (!tr) return;
    [].forEach.call(grid.querySelectorAll('tr'), function (r) {
      r.className = r.className.replace(' ui-state-highlight', '');
    });
    tr.className += ' ui-state-highlight';
  });
  // Double click is the portal's real "choose this offer".
  grid.addEventListener('dblclick', function (e) {
    if (!e.target.closest('tr.jqgrow')) return;
    document.querySelector('.js-orderNow').className = 'btn btn-default js-orderNow';
  });
</script>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:500px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _run(coro_factory):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 GRID.replace("&", "&amp;").replace('"', "&quot;")))
                frame = page.frame_locator("#myIframe")
                return await coro_factory(page, frame)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def _order_hidden(page):
    return page.evaluate("""(() => {
      const d = document.querySelector('#myIframe').contentDocument;
      const b = d.querySelector('.js-orderNow');
      return {className: b.className, visible: !!(b.offsetParent || b.getClientRects().length)};
    })""")


def test_choosing_an_offer_reveals_the_order_button():
    """The whole point: after select_plan, the portal has actually reacted."""
    async def go(page, frame):
        r = await select_plan(frame, {"name": "Unifi Home 500Mbps Premium Value With Device (36M)"},
                              page=page)
        return r, await _order_hidden(page)
    r, btn = _run(go)
    assert r["status"] == "ok"
    assert btn["visible"] is True
    assert "hide" not in btn["className"]


def test_a_single_click_would_not_have_been_enough():
    """Guards the fix against being 'simplified' back to a click: the fixture
    must genuinely distinguish the two gestures, or the test above proves
    nothing."""
    async def go(page, frame):
        await frame.locator(".js-offer-grid tr.jqgrow").nth(1).click()
        await asyncio.sleep(0.2)
        return await _order_hidden(page)
    btn = _run(go)
    assert btn["visible"] is False
    assert "hide" in btn["className"]


def test_a_lowercase_offer_still_matches():
    """Attribute selectors are case-sensitive and this portal writes some offers
    lowercase, so the fuzzy pass is a normal path — and it must end in the same
    dblclick, not a DOM click that fires no dblclick at all."""
    async def go(page, frame):
        r = await select_plan(frame, {"name": "UNIFI HOME 300MBPS BROADBAND"}, page=page)
        return r, await _order_hidden(page)
    r, btn = _run(go)
    assert r["status"] == "ok"
    assert r["matched"] == "unifi Home 300Mbps Broadband"
    assert btn["visible"] is True


def test_an_unserviceable_plan_names_what_is_available():
    async def go(page, frame):
        return await select_plan(frame, {"name": "Unifi Home 2Gbps Nonexistent"}, page=page)
    r = _run(go)
    assert r["status"] == "error"
    assert r["error"] == "offer_not_found"
    assert "unifi Home 300Mbps Broadband" in r["message"]


def test_the_offer_list_never_reports_internal_ids_as_names():
    """A 32-char id in the first title cell was being reported as the offer
    name, which made every diagnostic unreadable."""
    async def go(page, frame):
        return await page.evaluate(OFFER_ROW_INDEX_JS, "nothing matches this")
    picked = _run(go)
    assert picked["i"] == -1
    assert picked["offers"] == ["unifi Home 300Mbps Broadband",
                                "Unifi Home 500Mbps Premium Value With Device (36M)"]


def test_an_empty_offer_grid_is_reported_as_unserviceable_not_a_bare_list():
    """ORD-0007 failed with "not serviceable here. Available: []" — an empty
    Python list pasted into a sentence an agent is meant to act on. A grid with
    no rows must produce its own verdict, in words."""
    empty = GRID.replace('class="jqgrow"', 'class="jqnothing"')
    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML",
                         empty.replace("&", "&amp;").replace('"', "&quot;")))
        import oe_feasibility
        before = oe_feasibility.OFFER_ROWS_TIMEOUT_MS
        oe_feasibility.OFFER_ROWS_TIMEOUT_MS = 500
        try:
            return await select_plan(page.frame_locator("#myIframe"),
                                     {"name": "Unifi Home 500Mbps Premium Value With Device (36M)"},
                                     page=page)
        finally:
            oe_feasibility.OFFER_ROWS_TIMEOUT_MS = before
    r = _run(go)
    assert r["status"] == "error"
    assert r["error"] == "no_offers_listed"
    assert "[]" not in r["message"]
    assert "not serviceable" in r["message"] or "no offers" in r["message"]


def test_rows_that_arrive_late_are_still_found():
    """The grid element renders before its rows — the portal fills them by AJAX
    after the address OK. select_plan must wait for rows, not read an empty grid
    and declare the address unserviceable."""
    delayed = GRID.replace(
        "</script>",
        """
  // Simulate the portal's AJAX fill: strip the rows out now, put them back later.
  var saved = [].map.call(grid.querySelectorAll('tr.jqgrow'), function (r) {
    var html = r.outerHTML; r.parentNode.removeChild(r); return html;
  });
  setTimeout(function () {
    grid.querySelector('tbody') || grid;  // srcdoc tables always get a tbody
    saved.forEach(function (html) {
      (grid.querySelector('tbody') || grid).insertAdjacentHTML('beforeend', html);
    });
  }, 700);
</script>""")
    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML",
                         delayed.replace("&", "&amp;").replace('"', "&quot;")))
        return await select_plan(page.frame_locator("#myIframe"),
                                 {"name": "Unifi Home 500Mbps Premium Value With Device (36M)"},
                                 page=page)
    r = _run(go)
    assert r["status"] == "ok"
    assert r["matched"] == "Unifi Home 500Mbps Premium Value With Device (36M)"


# ── The blacklist refusal (live 2026-08-31, [40300805]) ─────────────────────
# The customer profile is created BEFORE feasibility, so choosing the offer is
# the first moment the portal can refuse the CUSTOMER rather than the address.
# It answers with a Warn dialog over the offer grid. Before this check the run
# walked on with the dialog standing, and died minutes later on a timeout that
# named some unrelated widget.
BLACKLIST_MSG = ("[40300805]: You're on our blacklist. Visit our nearest Unifi "
                 "Store for help.")

DIALOG = """
<div class="ui-dialog" id="warn" style="position:fixed;top:40px;left:40px;
     width:400px;height:160px;background:#fff">
  <div class="ui-dialog-title">TITLE_TEXT</div>
  <div class="modal-message">MESSAGE_TEXT</div>
  <button type="button">OK</button>
</div>
"""


def _grid_that_warns(message: str, title: str = "Warn", *, in_iframe: bool = True) -> str:
    """The offer grid, but the dblclick raises a portal dialog instead of
    revealing Order — which is exactly what a refused offer looks like."""
    dlg = DIALOG.replace("MESSAGE_TEXT", message).replace("TITLE_TEXT", title)
    grid = GRID.replace(
        "document.querySelector('.js-orderNow').className = 'btn btn-default js-orderNow';",
        "document.querySelector('#dlgHost').innerHTML = " + repr(dlg) + ";"
        if in_iframe else "window.parent.postMessage('warn','*');")
    return grid + ('<div id="dlgHost"></div>' if in_iframe else "")


def _run_with(html: str, plan: str, top_dialog: str = ""):
    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;"))
            + top_dialog)
        return await select_plan(page.frame_locator("#myIframe"), {"name": plan}, page=page)
    return _run(go)


PLAN = "Unifi Home 500Mbps Premium Value With Device (36M)"


def test_a_blacklisted_customer_is_reported_as_blacklisted_ic():
    r = _run_with(_grid_that_warns(BLACKLIST_MSG), PLAN)
    assert r["status"] == "error"
    assert r["error"] == "blacklisted_ic"
    # The portal's own sentence, verbatim — it is the only wording a dealer can
    # quote at Unifi, and our paraphrase is not.
    assert "blacklist" in r["message"].lower()
    assert r["portal_code"] == "40300805"


def test_the_warn_is_found_when_the_portal_puts_it_in_the_top_document():
    """The stock refusal turned out to render as a shell modal OUTSIDE
    #myIframe. An iframe-only read would report a clean page and walk on."""
    # Parked clear of the 900x500 iframe: a real portal modal covers the page,
    # but here it must not intercept the dblclick the test still needs to make.
    top = (DIALOG.replace("MESSAGE_TEXT", BLACKLIST_MSG).replace("TITLE_TEXT", "Warn")
                 .replace("top:40px;left:40px", "top:520px;left:40px"))
    r = _run_with(GRID, PLAN, top_dialog=top)
    assert r["status"] == "error"
    assert r["error"] == "blacklisted_ic"


def test_an_unrecognised_dialog_does_not_end_the_run():
    """The guard reads the screen; it must not become a new way to fail. A
    dialog we cannot classify — the Customer fuzzy search legitimately opens on
    this very click — leaves the flow exactly as it shipped."""
    r = _run_with(_grid_that_warns("Customer (Fuzzy Search)", title="Customer"), PLAN)
    assert r["status"] == "ok"
    assert r["matched"] == PLAN


def test_a_clean_offer_choice_still_passes():
    """The happy path pays one read and nothing else."""
    r = _run_with(GRID, PLAN)
    assert r["status"] == "ok"


def test_a_warn_stacked_with_the_customer_dialog_is_still_found():
    """The live failure (cmth00dae…, 2026-08-31).

    Two seconds after the offer was chosen the TOP dialog was the Customer fuzzy
    search, so a reader that took only the topmost dialog logged
    "Customer Fuzzy Search Cancel" and walked past the blacklist warn. Reading
    every visible dialog is what makes the refusal findable whichever one the
    portal happens to stack on top.
    """
    customer = (DIALOG.replace("MESSAGE_TEXT", "Fuzzy Search Customer Name Cancel")
                      .replace("TITLE_TEXT", "Customer")
                      .replace('id="warn"', 'id="cust"')
                      .replace("top:40px;left:40px", "top:200px;left:200px"))
    stacked = _grid_that_warns(BLACKLIST_MSG) + customer

    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML", stacked.replace("&", "&amp;").replace('"', "&quot;")))
        r = await select_plan(page.frame_locator("#myIframe"), {"name": PLAN}, page=page)
        return r, await read_dialog_texts(page)

    r, texts = _run(go)
    assert r["status"] == "error"
    assert r["error"] == "blacklisted_ic"
    # Without this the test would pass vacuously: it only proves anything while
    # the warn is NOT the dialog a topmost-only reader would have picked, which
    # is the live shape it was written from.
    assert len(texts) > 1
    assert "blacklist" not in texts[0].lower(), texts


def test_the_customer_dialog_alone_is_not_a_refusal():
    """The other half of the same rule: the fuzzy-search dialog opening on this
    click is the NORMAL path (ORD-0009), and must not end the run."""
    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML", GRID.replace("&", "&amp;").replace('"', "&quot;"))
            + DIALOG.replace("MESSAGE_TEXT", "Fuzzy Search Cancel").replace("TITLE_TEXT", "Customer")
                    .replace("top:40px;left:40px", "top:520px;left:40px"))
        return await classified_refusal(page)
    assert _run(go) is None


# ── The order-number wait, where the warn actually stood ────────────────────
ORDER_PAGE = """
<div id="page">New Connection — Customer Order Information</div>
<div id="dlgHost"></div>
"""


def _order_page_with(dialog_html: str) -> str:
    return ORDER_PAGE.replace('<div id="dlgHost"></div>', dialog_html)


def test_the_order_number_wait_stops_as_soon_as_the_portal_refuses():
    """Without this the run spends its full 20-second wait for a number the
    portal has already refused to mint, then reports `order_id_not_found` — a
    code that says the number is missing, not why, and which the automatic
    retry then asks twice more."""
    warn = DIALOG.replace("MESSAGE_TEXT", BLACKLIST_MSG).replace("TITLE_TEXT", "Warn")

    async def go(page, frame):
        await page.set_content(
            HOST.replace("FIXTURE_HTML",
                         _order_page_with(warn).replace("&", "&amp;").replace('"', "&quot;")))
        f = page.frame_locator("#myIframe")
        started = asyncio.get_event_loop().time()
        oid = await _capture_order_id(f, attempts=20, page=page)
        return oid, asyncio.get_event_loop().time() - started, await classified_refusal(page)

    oid, elapsed, refusal = _run(go)
    assert oid is None
    # It gave up on the refusal, not on the clock.
    assert elapsed < 10, elapsed
    assert refusal["error"] == "blacklisted_ic"
    assert refusal["portal_code"] == "40300805"


def test_the_order_number_is_still_read_when_the_portal_mints_one():
    """The guard must not cost the happy path its order number."""
    async def go(page, frame):
        page_html = _order_page_with(
            '<div>Customer Order Number: 2608000122936216</div>')
        await page.set_content(
            HOST.replace("FIXTURE_HTML",
                         page_html.replace("&", "&amp;").replace('"', "&quot;")))
        return await _capture_order_id(page.frame_locator("#myIframe"), attempts=3, page=page)
    assert _run(go) == "2608000122936216"

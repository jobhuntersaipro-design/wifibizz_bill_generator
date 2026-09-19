"""The Voice tab: open the Service Number's own `···`, and select the Agreement.

Live 2026-09-14, ORD-0168 (plan "Unifi Home 300Mbps Premium Value MAX With
Device (36M)"), attempts 2–5: every run died on the Voice tab with
`voice_no_numbers` / "number cards did not load after Query", and the failure
frame shows the **Select Agreement** dialog — one card, "Residential Voice
Basic (24 Months)" — over the tab. `_open_voice_number_picker` clicked the LAST
visible `span.icon-option-horizontal` on the page; this plan's Voice tab has an
Agreement row with its own `···` after the Service Number's, so that click
opened Select Agreement, the picker tagger tagged it, Query was pressed in it,
and the run waited 25 s for number cards that were never going to appear. Four
real orders were minted and stranded before the retry budget ran out.

The fixture is that tab in miniature. Run from scraper/:
    pytest tests/test_voice_agreement.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    _click_service_number_dots, ensure_agreement)

# Service Number first, Agreement second — the DOM order that made "the last
# dots" the wrong dots. Both `···` are the same span class the portal uses.
VOICE_TAB = """
<div class="layout-right-wrapper">
  <div class="h">Subscription Information</div>
  <div class="form-group">
    <label class="control-label">*Service Number</label>
    <div class="input-group">
      <input name="serviceNumber" value="" readonly>
      <span class="input-group-addon icon-option-horizontal js-sn-dots"
            onclick="window.__open('number')"></span>
    </div>
  </div>
  <div class="h">Agreement</div>
  <div class="form-group js-agreement-group">
    <label class="control-label">*Agreement</label>
    <div class="input-group">
      <input name="agreement" value="AGREEMENT_VALUE" readonly>
      <span class="input-group-addon icon-option-horizontal js-agr-dots"
            onclick="window.__open('agreement')"></span>
      <span class="input-group-addon glyphicon glyphicon-trash"></span>
    </div>
  </div>
  <div id="dialogs"></div>
</div>
<script>
  window.__opened = [];
  window.__okClicks = 0;
  window.__open = function (which) {
    window.__opened.push(which);
    var host = document.getElementById('dialogs');
    if (which === 'number') {
      host.innerHTML = '<div class="ui-dialog" style="display:block">'
        + '<div class="ui-dialog-title">Select Number</div>'
        + '<input placeholder="eg:60380808080 or 8080">'
        + '<button class="js-search-whp-number">Query</button>'
        + '<button class="js-ok">OK</button><button class="js-cancel">Cancel</button></div>';
    } else {
      host.innerHTML = '<div class="ui-dialog" style="display:block">'
        + '<div class="ui-dialog-title">Select Agreement</div>'
        + '<div class="query-form"><label>Agreement Period</label><select><option>---Please select---</option></select>'
        + '<button class="js-query">Query</button></div>'
        + '<div class="agreement-list">'
        + '<div class="js-agreement-card" style="border:1px solid #ccc;padding:20px;width:400px">'
        + '<b>Residential Voice Basic (24 Months)</b></div></div>'
        + '<button class="js-ok">OK</button><button class="js-cancel">Cancel</button></div>';
      var card = host.querySelector('.js-agreement-card');
      card.addEventListener('click', function () { card.className += ' selected'; });
      host.querySelector('.js-ok').addEventListener('click', function () {
        window.__okClicks++;
        // The portal's rule: OK fills the field only when a card was picked.
        if (CARD_TAKES && card.className.indexOf('selected') >= 0) {
          document.querySelector('input[name="agreement"]').value = card.innerText.trim();
          host.innerHTML = '';
        }
      });
      host.querySelector('.js-cancel').addEventListener('click', function () { host.innerHTML = ''; });
    }
  };
</script>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:600px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def build(*, agreement: str = "", card_takes: bool = True) -> str:
    return (VOICE_TAB.replace("AGREEMENT_VALUE", agreement)
            .replace("CARD_TAKES", "true" if card_takes else "false"))


def _run(html, coro_factory):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;")))
                await page.wait_for_function(
                    "() => { const f=document.querySelector('#myIframe');"
                    " return f && f.contentDocument && f.contentDocument.body; }")
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


def _state(page):
    return page.evaluate("""(() => {
      const w = document.querySelector('#myIframe').contentWindow, d = w.document;
      const t = d.querySelector('.ui-dialog-title');
      return {opened: w.__opened, okClicks: w.__okClicks,
              dialog: t ? t.innerText.trim() : null,
              agreement: d.querySelector('input[name="agreement"]').value};
    })""")


# ── The `···` that opens the number picker ───────────────────────────────────

def test_the_service_number_dots_are_clicked_not_the_agreement_dots():
    """ORD-0168's tab: two `···`, Agreement's last. The picker must open."""
    async def go(page, frame):
        return await _click_service_number_dots(page), await _state(page)

    r, s = _run(build(), go)
    assert r["status"] == "ok", r
    assert s["opened"] == ["number"]
    assert s["dialog"] == "Select Number"


def test_the_last_dots_rule_really_opens_select_agreement_here():
    """Control: reproduce the shipped rule (last visible `···`) on the same
    fixture and show it opens the wrong dialog — the live failure."""
    async def go(page, frame):
        await page.evaluate("""(() => {
          const d = document.querySelector('#myIframe').contentDocument;
          const dots = [...d.querySelectorAll('span.icon-option-horizontal')];
          dots[dots.length - 1].click(); })()""")
        return await _state(page)

    s = _run(build(), go)
    assert s["opened"] == ["agreement"]
    assert s["dialog"] == "Select Agreement"


# ── Selecting the Agreement ──────────────────────────────────────────────────

def test_an_empty_agreement_is_selected_via_its_dots_and_read_back():
    async def go(page, frame):
        return await ensure_agreement(frame, page), await _state(page)

    r, s = _run(build(agreement=""), go)
    assert r["status"] == "ok", r
    assert r["agreement"] == "Residential Voice Basic (24 Months)"
    assert s["opened"] == ["agreement"]
    assert s["okClicks"] == 1
    assert s["dialog"] is None, "the dialog closes on a successful OK"
    assert s["agreement"] == "Residential Voice Basic (24 Months)"


def test_a_filled_agreement_is_left_alone():
    """The Broadband tab: Agreement already reads 'unifi Home'. Nothing opens."""
    async def go(page, frame):
        return await ensure_agreement(frame, page), await _state(page)

    r, s = _run(build(agreement="unifi Home"), go)
    assert r["status"] == "skipped", r
    assert s["opened"] == []
    assert s["agreement"] == "unifi Home"


def test_a_tab_with_no_agreement_row_is_skipped():
    async def go(page, frame):
        return await ensure_agreement(frame, page)

    r = _run("<div>Subscription Information <input name='serviceNumber'></div>", go)
    assert r["status"] == "skipped"
    assert r["reason"] == "absent"


def test_an_ok_that_does_not_take_is_reported_not_called_ok():
    """The rule this codebase keeps paying for: read the field back."""
    async def go(page, frame):
        return await ensure_agreement(frame, page), await _state(page)

    r, s = _run(build(agreement="", card_takes=False), go)
    assert r["status"] == "error"
    assert r["error"] == "agreement_not_selected"
    assert s["okClicks"] == 1, "it did try"
    assert "Select Agreement" in r["message"]

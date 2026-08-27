"""After Query in the Select Number picker, OK the CONFIRM popup — never the picker.

Live 2026-08-27 (ORD-0016 attempt 2, order 2608000122666335): the first
filtered re-query typed its suffix and pressed Query, then the "confirm popup
OK" step clicked `.ui-dialog:visible button:has-text("OK")` `.last`. A filtered
query is fast and raises no "it will take a bit long time … continue?" popup,
so `.last` was the picker's OWN OK — the picker closed with nothing selected,
the card list "changed" to empty (read as a successful re-query), and the next
two filters died with `Locator.fill: Timeout` on a box that no longer existed.
The failure frame shows the Voice tab with no dialog at all.

The unfiltered path only ever worked because the confirm popup happens to
appear there. Both paths now use _CONFIRM_QUERY_OK_JS, which OKs a visible
dialog only when it is NOT the Select Number picker, and _PICKER_OPEN_JS, so a
closed picker is reported rather than read as an exhausted pool.

Run from the scraper/ dir:
    pytest tests/test_voice_query_confirm.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    _CONFIRM_QUERY_OK_JS,
    _PICKER_OPEN_JS,
    _TAG_PICKER_JS,
)

PICKER = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Select Number</div>
  <input placeholder="eg:60380808080 or 8080">
  <button class="js-search-whp-number">Query</button>
  <div class="number-card">60387235321 Normal</div>
  <div class="number-card">60387243927 Normal</div>
  <button class="js-ok" onclick="this.closest('.ui-dialog').style.display='none'">OK</button>
  <button>Cancel</button>
</div>
"""

CONFIRM = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Confirm</div>
  <div class="modal-message">It will take a bit long time, continue?</div>
  <button class="js-ok" onclick="this.closest('.ui-dialog').style.display='none'">OK</button>
  <button>Cancel</button>
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:500px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


# The picker as it looks on FIRST open, before any Query: no cards yet, and
# nothing else this build can prove the portal renders — no title class, no
# js-search-whp-number. Only the OK/Cancel pair. Recognising it must not
# depend on a selector guess, or the unfiltered path (every Voice submit)
# would OK the picker itself.
BARE_PICKER = """
<div class="ui-dialog" style="display:block">
  <div>Pick one</div>
  <input placeholder="type here">
  <button>Query</button>
  <button class="js-ok" onclick="this.closest('.ui-dialog').style.display='none'">OK</button>
  <button>Cancel</button>
</div>
"""


def _run(fixture_html, script, tag_first=False):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", fixture_html.replace("&", "&amp;").replace('"', "&quot;")))
                await page.wait_for_function(
                    "() => { const f=document.querySelector('#myIframe');"
                    " return f && f.contentDocument && f.contentDocument.body; }")
                if tag_first:
                    assert await page.evaluate(_TAG_PICKER_JS) == "ok"
                clicked = await page.evaluate(script)
                picker_open = await page.evaluate(_PICKER_OPEN_JS)
                return clicked, picker_open
            finally:
                await browser.close()
    return asyncio.run(go())


def test_confirm_popup_is_okayed_and_the_picker_survives():
    clicked, picker_open = _run(PICKER + CONFIRM, _CONFIRM_QUERY_OK_JS)
    assert clicked == "ok"
    assert picker_open is True


def test_no_confirm_popup_means_nothing_is_clicked():
    # The live bug: with only the picker up, `.last` OK closed the picker.
    clicked, picker_open = _run(PICKER, _CONFIRM_QUERY_OK_JS)
    assert clicked == "none"
    assert picker_open is True


def test_closed_picker_is_reported_not_read_as_empty():
    _, picker_open = _run("<div>Voice tab, no dialog</div>", _PICKER_OPEN_JS)
    assert picker_open is False


def test_bare_picker_tagged_by_identity_is_never_okayed():
    clicked, picker_open = _run(BARE_PICKER, _CONFIRM_QUERY_OK_JS, tag_first=True)
    assert clicked == "none"
    assert picker_open is True


def test_confirm_over_a_bare_tagged_picker_is_okayed_and_the_picker_survives():
    clicked, picker_open = _run(BARE_PICKER + CONFIRM, _CONFIRM_QUERY_OK_JS, tag_first=True)
    assert clicked == "ok"
    assert picker_open is True

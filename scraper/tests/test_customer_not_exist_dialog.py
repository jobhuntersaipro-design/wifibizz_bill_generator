"""The 'Customer record does not exist' popup must be seen and dismissed.

During a live submit the Advanced Query's Query click can answer with a
'Customer record does not exist. Please create a new customer.' Warning instead
of an empty result grid. The popup blocks every later click, so the search loop
must dismiss it — and its presence is the signal that the create-via-dialog
recovery should run, rather than more search retries.

_dismiss_customer_not_exist_dialog returns the popup's text after clicking its
OK (recovery trigger), None when there is no such popup (keep searching), and
must NOT be fooled by other customer-titled dialogs like the fuzzy-search
dialog itself.

Run from the scraper/ dir:
    pytest tests/test_customer_not_exist_dialog.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import _dismiss_customer_not_exist_dialog  # noqa: E402

# The popup as quoted from the live portal. OK hides the dialog, as the real
# one does — the helper must return the message AND actually dismiss it.
NOT_EXIST_DIALOG = """
<div class="ui-dialog" style="display:block">
  <div class="modal-header">Warning</div>
  <div class="modal-body">Customer record does not exist. Please create a new customer.</div>
  <div class="modal-footer">
    <button class="btn" onclick="this.closest('.ui-dialog').style.display='none'">OK</button>
  </div>
</div>
"""

# The Customer fuzzy-search dialog itself: customer-related, visible, but not
# the not-exist popup. Must answer None or every attach would run the recovery.
FUZZY_DIALOG_ONLY = """
<div class="ui-dialog" style="display:block">
  <div class="modal-header">Customer</div>
  <input placeholder="Customer Name / ID Number / Service Number / Old BRN">
  <button class="js-advanced-query-btn">&gt;&gt;</button>
  <div class="modal-footer"><button class="btn">Cancel</button></div>
</div>
"""

# The popup as the live 2026-08-20 run showed it: an 'Information' modal with a
# single blue OK, stacked over the Advanced Query dialog (itself over the
# Customer dialog). The helper must dismiss ONLY the popup — Advanced Query has
# to survive so the search can retry — and must match .modal.in, not just
# .ui-dialog.
STACKED_INFO_POPUP = """
<div class="ui-dialog" style="display:block">
  <div class="modal-header">Customer</div>
  <button class="js-advanced-query-btn">&gt;&gt;</button>
</div>
<div class="modal in" style="display:block">
  <div class="modal-title">Advanced Query</div>
  <input name="certNbr">
  <button class="btn">Query</button>
  <div class="modal-footer"><button class="btn">OK</button><button class="btn">Cancel</button></div>
</div>
<div class="modal in info-popup" style="display:block">
  <div class="modal-title">Information</div>
  <div class="modal-body">Customer record does not exist. Please create a new customer.</div>
  <div class="modal-footer">
    <button class="btn" onclick="this.closest('.info-popup').style.display='none'">OK</button>
  </div>
</div>
"""

# A dismissed popup leaves its nodes in the DOM; :visible must not count them.
NOT_EXIST_HIDDEN = """
<div class="ui-dialog" style="display:none">
  <div class="modal-body">Customer record does not exist. Please create a new customer.</div>
  <div class="modal-footer"><button class="btn">OK</button></div>
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:500px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _probe(fixture_html):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 fixture_html.replace("&", "&amp;").replace('"', "&quot;")))
                frame = page.frame_locator("#myIframe")
                msg = await _dismiss_customer_not_exist_dialog(frame)
                still_up = await frame.locator(
                    ".ui-dialog:visible, .modal.in:visible",
                    has_text="record does not exist").count()
                aq_up = await frame.locator(
                    ".modal.in:visible", has_text="Advanced Query").count()
                return msg, still_up, aq_up
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_popup_is_detected_and_dismissed():
    msg, still_up, _ = _probe(NOT_EXIST_DIALOG)
    assert msg and "does not exist" in msg
    assert still_up == 0  # OK was actually clicked


def test_live_shape_info_popup_over_advanced_query():
    msg, still_up, aq_up = _probe(STACKED_INFO_POPUP)
    assert msg and "create a new customer" in msg
    assert still_up == 0  # the Information popup's OK was clicked
    assert aq_up == 1     # Advanced Query must survive for the search retry


def test_fuzzy_search_dialog_is_not_the_popup():
    msg, _, _ = _probe(FUZZY_DIALOG_ONLY)
    assert msg is None


def test_a_dismissed_popups_leftover_nodes_do_not_count():
    msg, _, _ = _probe(NOT_EXIST_HIDDEN)
    assert msg is None

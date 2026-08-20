"""The Customer dialog can open BEFORE the Order click — detect it, don't fight it.

ORD-0009 attempts 3-5 all died the same way: after the offer-row double-click
the portal opened the Customer (Fuzzy Search) dialog by itself, and the Order
click then spent 45s bouncing off its modal backdrop before dying as
"Customer Fuzzy Search Cancel" (the dialog's title + Cancel button, read out by
the exception handler). submit-5-failure.jpg shows the dialog up, search box
empty, Order button behind the backdrop.

customer_dialog_open() is the guard: when the dialog is already showing, Order
is implied by the plan selection and run_feasibility skips the click. The probe
is the Advanced Query control because it is the first thing attach_customer
clicks — visible means the attach flow can proceed right now.

Run from the scraper/ dir:
    pytest tests/test_customer_dialog_open.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import customer_dialog_open  # noqa: E402

# The dialog as the failure frame shows it: Fuzzy Search mode, the >> Advanced
# Query toggle, a backdrop that would eat any click aimed past it.
DIALOG_OPEN = """
<div class="modal-backdrop in"></div>
<div class="modal in" style="display:block">
  <div class="modal-header">Customer</div>
  <input placeholder="Customer Name / ID Number / Service Number / Old BRN">
  <button class="js-advanced-query-btn">&gt;&gt;</button>
  <button class="js-cancel">Cancel</button>
</div>
<button type="button" class="btn btn-default js-orderNow">Order</button>
"""

# The normal feasibility page: no dialog anywhere. The Advanced Query control
# does not exist yet — the portal only renders it with the dialog.
NO_DIALOG = """
<table class="js-offer-grid"><tr class="jqgrow"><td title="x">x</td></tr></table>
<button type="button" class="btn btn-default js-orderNow">Order</button>
"""

# The dialog markup present but hidden (a dismissed dialog leaves its nodes in
# the DOM). :visible must not count it, or every order after the first attach
# would skip a click the portal is still waiting for.
DIALOG_HIDDEN = """
<div class="modal" style="display:none">
  <button class="js-advanced-query-btn">&gt;&gt;</button>
</div>
<button type="button" class="btn btn-default js-orderNow">Order</button>
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
                return await customer_dialog_open(frame)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_open_dialog_is_detected():
    assert _probe(DIALOG_OPEN) is True


def test_plain_feasibility_page_is_not_a_dialog():
    assert _probe(NO_DIALOG) is False


def test_a_dismissed_dialogs_leftover_nodes_do_not_count():
    assert _probe(DIALOG_HIDDEN) is False

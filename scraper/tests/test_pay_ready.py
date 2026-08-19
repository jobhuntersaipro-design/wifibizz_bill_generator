"""test_pay_ready.py — is the Pay page actually ready to be paid?

This exists because of one real order. On 2026-08-19 the flow reached the Pay
page of order 2608000121617449, photographed an Order Information table reading
"No record to view", clicked a Pay button that was greyed out, and then reported
"PAYMENT WAS SUBMITTED, but the portal never showed a confirmed order number" —
a charge that probably never happened, described as a charge that did.

A visible Pay button was the only precondition. `_PAY_READY_JS` is the check
that replaced it, and the first fixture below is that page.

Run from the scraper/ dir:
    pytest tests/test_pay_ready.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import _PAY_READY_JS, _describe_pay_not_ready  # noqa: E402

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')

# The page as it actually was when the click went in: the shell had rendered
# (heading, both table headers, the Benefit List row) but the charge rows had
# not, and Pay was styled disabled.
NOT_LOADED = """
<h3>New Connection / Customer Order Number 2608000121617449</h3>
<div>Order Information</div>
<div class="sect">
  <table><tr><th>Charge Item List</th><th>Price</th></tr></table>
  <div class="empty">No record to view</div>
</div>
<div>Benefit List</div>
<div class="sect"><table><tr><td>Residential Voice Basic</td><td>60351019516</td></tr></table></div>
<button class="btn n-button--disabled">Pay</button>
<button class="btn">Cancel</button>
"""

# The same page once the charges arrive.
#
# The empty-state phrase is left in a DIFFERENT, legitimately-empty grid,
# because that is what the real page does — and scanning the whole body for it
# refused to pay order 2608000121624021 while its charges were on screen. A
# loaded page must read ready with that phrase still present elsewhere.
LOADED = """
<h3>New Connection / Customer Order Number 2608000121624021</h3>
<div>Order Information</div>
<div class="sect">
  <table>
    <tr><th>Charge Item List</th><th>Price</th></tr>
    <tr><td>Unifi Home 500Mbps</td><td>RM 159.00</td></tr>
    <tr><td>Advance Payment</td><td>RM 100.00</td></tr>
  </table>
</div>
<div>Deposit List</div>
<div class="sect"><table><tr><th>Deposit</th></tr></table>
  <div class="empty">No record to view</div></div>
<button class="btn btn-primary">Pay</button>
<button class="btn">Cancel</button>
"""

# Same again, refusing the click the standards-compliant way.
ATTR_DISABLED = LOADED.replace('<button class="btn btn-primary">Pay</button>',
                               '<button class="btn btn-primary" disabled>Pay</button>')

NO_BUTTON = LOADED.replace('<button class="btn btn-primary">Pay</button>', "")


def _read(inner: str) -> dict:
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 inner.replace("&", "&amp;").replace('"', "&quot;")))
                return await page.evaluate(_PAY_READY_JS)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_the_page_that_cost_a_real_order_is_not_ready():
    state = _read(NOT_LOADED)
    assert state["ready"] is False
    assert state["found"] is True      # the button WAS there — that was the trap
    assert state["empty"] is True
    assert state["charged"] is False


def test_a_greyed_class_alone_does_not_refuse_a_loaded_page():
    # Readiness turns on what the DOM asserts, not on a CSS class name this page
    # has never been inspected for. A styled-grey button on a page whose charges
    # HAVE loaded is allowed through — and if the click is then a no-op,
    # `_confirm_pay_took` reports it as unconfirmed rather than as paid.
    state = _read(LOADED.replace('class="btn btn-primary"', 'class="btn n-button--disabled"'))
    assert state["ready"] is True
    assert "n-button--disabled" in state["cls"]


def test_a_loaded_page_is_ready():
    assert _read(LOADED)["ready"] is True


def test_a_disabled_attribute_is_not_ready():
    state = _read(ATTR_DISABLED)
    assert state["ready"] is False and state["disabled"] is True


def test_no_pay_button_is_not_ready():
    state = _read(NO_BUTTON)
    assert state["ready"] is False and state["found"] is False


def test_cancel_is_never_mistaken_for_pay():
    # Whole-text match: a page offering only Cancel must not read as payable.
    state = _read('<button class="btn">Cancel</button><a href="#">Payment history</a>')
    assert state["found"] is False


# ── The sentence the agent reads ────────────────────────────────────────────

def test_the_reason_names_the_portal_wording_for_an_unloaded_table():
    msg = _describe_pay_not_ready({"found": True, "empty": True, "disabled": True})
    assert "No record to view" in msg


def test_the_reason_distinguishes_a_stuck_button_from_a_missing_one():
    assert "never appeared" in _describe_pay_not_ready({"found": False})
    assert "stayed disabled" in _describe_pay_not_ready(
        {"found": True, "empty": False, "charged": True, "disabled": True,
         "cls": "n-button--disabled"})


def test_an_empty_grid_elsewhere_does_not_block_a_loaded_page():
    # The regression: order 2608000121624021 was refused with "the charges had
    # not loaded" while its charge rows were on screen, because a DIFFERENT
    # empty grid on the same page carried the portal's empty-state wording.
    state = _read(LOADED)
    assert state["ready"] is True
    assert state["empty"] is False and state["charged"] is True


def test_a_priced_row_is_what_counts_as_loaded():
    # Headers with no charge rows is a table that has not filled in yet, even
    # without the empty-state div.
    state = _read(LOADED.replace("<td>Unifi Home 500Mbps</td><td>RM 159.00</td>", "")
                        .replace("<td>Advance Payment</td><td>RM 100.00</td>", ""))
    assert state["ready"] is False and state["charged"] is False


def test_a_zero_priced_order_still_counts_as_loaded():
    # RM 0.00 is a charge. Requiring a non-zero amount would refuse a legitimate
    # fully-discounted order.
    state = _read(LOADED.replace("RM 159.00", "RM 0.00").replace("RM 100.00", "RM 0.00"))
    assert state["ready"] is True


def test_the_reason_quotes_what_the_section_actually_said():
    msg = _describe_pay_not_ready(
        {"found": True, "empty": False, "charged": False, "sample": "Charge Item List Price"})
    assert "Charge Item List Price" in msg

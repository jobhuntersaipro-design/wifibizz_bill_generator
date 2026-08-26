"""The cancel flow's Order-tab finder must aim at the right provision order.

Cancelling the wrong provision order is unrecoverable, so every trap here is
about aim, and they run against real markup in a real browser because each one
is a DOM trap a description would not catch:

  * Two orders on one customer: the trigger tagged must belong to the block
    carrying OUR order number, never the first block on the page.
  * A display:none template block containing the order number must not match —
    hidden nodes have no client rects, and clicking into one cancels nothing
    while reporting success.
  * A block with the number but no "..." near Order Decomposition must report
    that, not fall back to some other clickable.
  * The verification regex must not read "Cancel Order" (the menu entry's own
    label, still on screen) as proof of a cancelled STATE — that guard lives in
    cancelled_state_visible and is pinned separately.

Run from the scraper/ dir:
    pytest tests/test_cancel_finder.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_cancel import (  # noqa: E402
    FIND_CANCEL_TRIGGER_JS,
    READ_ORDER_BLOCK_JS,
    cancelled_state_visible,
)

ORDER_A = "2608000122222001"
ORDER_B = "2608000122222002"

# Two provision orders under one customer, each with its own "..." beside
# Order Decomposition. The order of blocks is A then B, so tagging by position
# would always hit A.
TWO_ORDERS = f"""
<div class="order-list">
  <div class="order-item" id="block-a">
    <div class="row">
      <span>Provision Order</span> <span class="order-no">{ORDER_A}</span>
      <span>Order Decomposition</span>
      <a class="menu" id="trigger-a" href="#">...</a>
    </div>
    <div>Status: In Progress</div>
  </div>
  <div class="order-item" id="block-b">
    <div class="row">
      <span>Provision Order</span> <span class="order-no">{ORDER_B}</span>
      <span>Order Decomposition</span>
      <a class="menu" id="trigger-b" href="#">...</a>
    </div>
    <div>Status: In Progress</div>
  </div>
</div>
"""

# The order number sits ONLY inside a hidden template block — the kind of node
# innerText-based scanning happily matches and a click into does nothing.
HIDDEN_ONLY = f"""
<div style="display:none" class="template">
  <span>{ORDER_A}</span>
  <span>Order Decomposition</span>
  <a class="menu">...</a>
</div>
<div class="order-item">
  <span>{ORDER_B}</span> <span>Order Decomposition</span> <a class="menu">...</a>
</div>
"""

# The order exists on screen but its block has no ellipsis / more-ish control.
NO_TRIGGER = f"""
<div class="order-item">
  <span>{ORDER_A}</span>
  <span>Order Decomposition</span>
  <button class="btn">View</button>
</div>
"""

# A dropdown-toggle with an icon instead of a text ellipsis — the class hint
# path. (Bootstrap renders these as <button class="dropdown-toggle"><i/>.)
CLASS_HINT = f"""
<div class="order-item">
  <div class="hdr">
    <span>{ORDER_A}</span>
    <span class="lbl">Order Decomposition</span>
    <button class="btn dropdown-toggle" id="hint-trigger"><i class="icon"></i></button>
  </div>
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}</style>BODY_HTML')


def _run(fixture_html, probe):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace("BODY_HTML", fixture_html))
                return await probe(page)
            finally:
                await browser.close()
    return asyncio.run(go())


def _find(page, order_no):
    return page.evaluate(FIND_CANCEL_TRIGGER_JS, order_no)


def test_tags_the_trigger_of_the_matching_block_not_the_first():
    async def probe(page):
        result = await _find(page, ORDER_B)
        tagged = await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-trigger]')?.id")
        block = await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-block]')?.id")
        return result, tagged, block

    result, tagged, block = _run(TWO_ORDERS, probe)
    assert result["found"] is True
    assert tagged == "trigger-b"
    assert block == "block-b"


def test_first_order_still_matches_its_own_trigger():
    async def probe(page):
        result = await _find(page, ORDER_A)
        tagged = await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-trigger]')?.id")
        return result, tagged

    result, tagged = _run(TWO_ORDERS, probe)
    assert result["found"] is True
    assert tagged == "trigger-a"


def test_a_second_call_retags_cleanly():
    """Retrying with another number must not leave two tagged triggers."""
    async def probe(page):
        await _find(page, ORDER_A)
        await _find(page, ORDER_B)
        return await page.evaluate(
            "() => [...document.querySelectorAll('[data-oe-cancel-trigger]')].map(e => e.id)")

    tagged = _run(TWO_ORDERS, probe)
    assert tagged == ["trigger-b"]


def test_hidden_template_block_never_matches():
    async def probe(page):
        return await _find(page, ORDER_A)

    result = _run(HIDDEN_ONLY, probe)
    assert result["found"] is False
    assert result["reason"] == "order_no_not_on_screen"


def test_missing_order_number_reports_not_on_screen():
    async def probe(page):
        return await _find(page, "9999000000000000")

    result = _run(TWO_ORDERS, probe)
    assert result["found"] is False
    assert result["reason"] == "order_no_not_on_screen"


def test_block_without_a_trigger_says_so_instead_of_guessing():
    async def probe(page):
        result = await _find(page, ORDER_A)
        tagged = await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-trigger]')")
        return result, tagged

    result, tagged = _run(NO_TRIGGER, probe)
    assert result["found"] is False
    assert result["reason"] == "no_trigger_near_decomposition"
    assert tagged is None


def test_dropdown_toggle_class_counts_as_the_trigger():
    async def probe(page):
        result = await _find(page, ORDER_A)
        tagged = await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-trigger]')?.id")
        return result, tagged

    result, tagged = _run(CLASS_HINT, probe)
    assert result["found"] is True
    assert tagged == "hint-trigger"


def test_read_block_returns_the_tagged_blocks_text():
    async def probe(page):
        await _find(page, ORDER_B)
        return await page.evaluate(READ_ORDER_BLOCK_JS, ORDER_B)

    block = _run(TWO_ORDERS, probe)
    assert ORDER_B in block["text"]
    assert "In Progress" in block["text"]


def test_read_block_refinds_after_a_rerender():
    """The confirm can re-render the tab, dropping the tag — the reader must
    fall back to re-finding the block by its number."""
    async def probe(page):
        await _find(page, ORDER_B)
        await page.evaluate(
            "() => document.querySelector('[data-oe-cancel-block]')"
            ".removeAttribute('data-oe-cancel-block')")
        await page.evaluate(
            f"() => {{ document.querySelector('#block-b div:last-child')"
            f".textContent = 'Status: Cancelled'; }}")
        return await page.evaluate(READ_ORDER_BLOCK_JS, ORDER_B)

    block = _run(TWO_ORDERS, probe)
    assert "Cancelled" in block["text"]


# ── The verification rule (pure) ────────────────────────────────────────────
def test_cancelled_state_matches_the_portal_wordings():
    assert cancelled_state_visible("Status: Cancelled")
    assert cancelled_state_visible("Cancellation In Progress")
    assert cancelled_state_visible("CANCEL ORDER SUBMITTED")


def test_unchanged_state_is_not_read_as_cancelled():
    assert not cancelled_state_visible("Status: In Progress · Order Decomposition ...")
    assert not cancelled_state_visible("")
    assert not cancelled_state_visible(None)


def test_the_word_cancel_alone_is_never_proof():
    """The menu entry and any dialog's Cancel button say "Cancel" on a screen
    that has cancelled nothing — only a STATE wording may confirm."""
    assert not cancelled_state_visible("Order Decomposition ... Cancel Order")
    assert not cancelled_state_visible("OK   Cancel")
    assert not cancelled_state_visible("Cancel")
    # But the explicit outcome phrases still do.
    assert cancelled_state_visible("Cancel Order Submitted")
    assert cancelled_state_visible("Cancel In Progress")

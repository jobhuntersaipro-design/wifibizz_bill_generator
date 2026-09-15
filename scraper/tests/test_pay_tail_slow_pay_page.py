"""test_pay_tail_slow_pay_page.py — wait for the Pay page instead of pressing a Next it lacks.

Live 2026-09-15, order 2609000125372808 (admin cmu2ivic6000009gmh403spt0): after
the Terms & Conditions Next the pay tail looked for Pay exactly ONCE. That order's
Pay page (broadband + voice + TV) was still loading — no Pay yet, and no Next
either (`nextVisible: 0`) — so the loop pressed for a third Next, got `nonext`,
and failed the run. Its own screenshot, taken a moment later, shows Pay on
screen. Seven runs on the droplet died on that identical state.

`_wait_for_pay_or_next` is the check that replaced the single look: it waits for
the page to settle into one or the other.

Run from the scraper/ dir:
    pytest tests/test_pay_tail_slow_pay_page.py
"""

import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import _wait_for_pay_or_next  # noqa: E402

HOST = ('<!doctype html><meta charset="utf-8">'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')

# The Pay page mid-load, as the failing run saw it: shell only, then the Pay
# button arrives after DELAY ms.
SLOW_PAY = """
<div id="root"></div>
<script>setTimeout(function(){
  document.getElementById('root').innerHTML =
    '<h3>Order Information</h3><button class="btn btn-primary">Pay</button>';
}, DELAY);</script>
"""

TERMS = """
<h3>Acknowledgement &amp; Acceptance</h3>
<button class="btn js-btn-next">Next</button>
"""

BLANK = "<div>loading…</div>"


def _run(inner: str, timeout_s: float) -> tuple[str, float]:
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 inner.replace("&", "&amp;").replace('"', "&quot;")))
                t = time.monotonic()
                found = await _wait_for_pay_or_next(page, timeout_s=timeout_s)
                return found, time.monotonic() - t
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_a_pay_button_that_arrives_late_is_waited_for():
    # The live failure: neither Pay nor Next at first look.
    found, _ = _run(SLOW_PAY.replace("DELAY", "4000"), timeout_s=20)
    assert found == "pay"


def test_a_page_with_next_returns_at_once():
    # The T&C page must not be held up waiting for a Pay it will never show.
    found, took = _run(TERMS, timeout_s=20)
    assert found == "next"
    assert took < 3


def test_a_page_that_never_settles_is_reported_after_the_timeout():
    found, took = _run(BLANK, timeout_s=2)
    assert found == "none"
    assert took >= 2


def test_control_a_single_look_misses_the_late_pay_button():
    # What shipped: one instant check. On the same fixture it sees nothing,
    # which is how the run went on to press a Next the Pay page does not have.
    found, _ = _run(SLOW_PAY.replace("DELAY", "4000"), timeout_s=0)
    assert found == "none"

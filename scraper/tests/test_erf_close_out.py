"""test_erf_close_out.py — the last click of a submit, after the money has moved.

Two things are covered, and both are here because of what they cost if wrong:

  1. `_FINAL_NEXT_JS` — which control the browser actually clicks on the
     confirmation page. That page has been photographed and never inspected, so
     the picker carries a text fallback, and a text fallback is precisely how
     `SCROLL_TO_HEADING_JS` shipped three wrong-anchor bugs to production. Here
     the page is a PAID order, so a wrong pick is a click of unknown effect on a
     charged order rather than a mis-framed screenshot. Run against a real
     browser on synthetic markup carrying the traps.

  2. `_close_out_erf_page` — that every failure of that click comes back as a
     NOTE and never as a raise. It runs after the charge and after the e-RF is
     stored: nothing it does may turn a paid order into a failed one.

The suite has no pytest-asyncio, so async work runs under asyncio.run() inside
ordinary sync tests — which keeps these collected by a bare `pytest`, unlike the
standalone browser scripts beside them that quietly collect zero tests.

Run from the scraper/ dir:
    pytest tests/test_erf_close_out.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oe_feasibility  # noqa: E402
from oe_feasibility import _FINAL_NEXT_JS, _close_out_erf_page  # noqa: E402


# ── 1. Which button gets clicked ─────────────────────────────────────────────
#
# Loaded into an #myIframe exactly as the real capture is, because the JS walks
# that boundary — and via srcdoc, since a file:// or data: frame is a separate
# origin and `contentDocument` comes back null (the same trap documented in
# test_scroll_to_offers.py).
HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _host(inner: str) -> str:
    return HOST.replace("FIXTURE_HTML",
                        inner.replace("&", "&amp;").replace('"', "&quot;"))


# The portal's own class, plus a leftover from an earlier page left hidden in
# the DOM — the flow's pages are shown and hidden rather than reloaded.
CLASSED = """
<div style="display:none"><button class="js-btn-next" id="stale">Next</button></div>
<button id="print">Print e-RF</button>
<button class="js-btn-next" id="real">Next</button>
"""

# The same page if the Next does NOT carry the class — the case the fallback
# exists for. Every trap here is something the confirmation page plausibly has:
# a hidden control, a nav link whose text merely STARTS with Next, and the
# neighbouring buttons.
UNCLASSED = """
<a href="#" id="nav">Next page</a>
<button id="back">Back</button>
<button id="cancel">Cancel</button>
<button id="print">Print e-RF</button>
<button id="hidden" style="display:none">Next</button>
<button id="real"> Next </button>
"""


async def _click_id(inner: str) -> tuple[str, str]:
    """Run the picker against `inner` and report (return value, id clicked)."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(_host(inner))
            # Record the click rather than assert on a selector: the question is
            # which element received it, and only the element knows.
            await page.evaluate("""() => {
              const d = document.querySelector('#myIframe').contentDocument;
              window.__hit = null;
              d.addEventListener('click', e => { window.__hit = e.target.id; }, true);
            }""")
            result = await page.evaluate(_FINAL_NEXT_JS)
            return result, await page.evaluate("window.__hit")
        finally:
            await browser.close()


def _run_click(inner: str) -> tuple[str, str]:
    try:
        return asyncio.run(_click_id(inner))
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_clicks_the_visible_portal_next():
    assert _run_click(CLASSED) == ("ok", "real")


def test_falls_back_to_a_button_whose_whole_text_is_next():
    # Not "Next page", not Back, not Cancel, not Print e-RF, and not the hidden
    # one — surrounding whitespace only.
    assert _run_click(UNCLASSED) == ("ok", "real")


def test_reports_nonext_rather_than_clicking_something_else():
    # The honest outcome when the page has no Next: the caller turns this into a
    # note on a submitted order. Clicking a near-match instead would be a click
    # of unknown effect on an order that has already been paid for.
    assert _run_click('<button id="print">Print e-RF</button>'
                      '<button id="cancel">Cancel</button>') == ("nonext", None)


def test_nodoc_without_the_iframe():
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content("<p>order list</p>")
                return await page.evaluate(_FINAL_NEXT_JS)
            finally:
                await browser.close()
    try:
        assert asyncio.run(go()) == "nodoc"
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


# ── 2. The close-out never costs a paid order ────────────────────────────────

class _Locator:
    def __init__(self, count):
        self._count = count

    async def count(self):
        if isinstance(self._count, Exception):
            raise self._count
        return self._count


class _FrameLocator:
    def __init__(self, count):
        self._count = count

    def locator(self, _sel):
        return _Locator(self._count)


class _FakePage:
    """The two things `_close_out_erf_page` touches: evaluate, and the frame."""

    def __init__(self, evaluate, erf_count=0):
        self._evaluate = evaluate
        self.erf_count = erf_count

    async def evaluate(self, _js):
        if isinstance(self._evaluate, Exception):
            raise self._evaluate
        return self._evaluate


def _close(page, monkeypatch):
    stages = []
    monkeypatch.setattr(oe_feasibility, "_frame",
                        lambda p: _FrameLocator(p.erf_count))
    # The real 3s settle would make every case here cost 3 seconds of a suite
    # that runs in under one.
    async def _no_wait(_s):
        return None
    monkeypatch.setattr(oe_feasibility.asyncio, "sleep", _no_wait)
    note = asyncio.run(_close_out_erf_page(page, lambda n, d=None: stages.append((n, d))))
    return note, stages


def test_clean_close_out_returns_no_note(monkeypatch):
    # Clicked, and the Print e-RF control is gone — we are back on the order list.
    note, stages = _close(_FakePage("ok", erf_count=0), monkeypatch)
    assert note == ""
    assert any(n == oe_feasibility.PAGE_BREAK_STAGE for n, _ in stages)


def test_a_missing_next_is_a_note_not_a_raise(monkeypatch):
    note, stages = _close(_FakePage("nonext"), monkeypatch)
    assert "nonext" in note
    # No divider: the portal did not advance, and a page break there would claim
    # progress that never happened.
    assert stages == []


def test_a_thrown_evaluate_is_a_note_not_a_raise(monkeypatch):
    # A dead page/frame at this moment must not propagate: the order is paid.
    note, _ = _close(_FakePage(RuntimeError("Target closed")), monkeypatch)
    assert "Target closed" in note and "RuntimeError" in note


def test_still_on_the_confirmation_page_is_reported(monkeypatch):
    # The click landed, but Print e-RF is still there — most likely a dialog we
    # cannot see. Reported, because the browser is not where the next run expects.
    note, _ = _close(_FakePage("ok", erf_count=1), monkeypatch)
    assert "still showing" in note


def test_a_gone_frame_counts_as_having_left(monkeypatch):
    # The check itself throwing because the frame went away IS the success case.
    note, _ = _close(_FakePage("ok", erf_count=RuntimeError("frame detached")), monkeypatch)
    assert note == ""

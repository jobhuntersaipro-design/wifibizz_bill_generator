"""test_shell_modal.py — the portal shell dialog that blocked four live submits.

On 2026-08-19 four consecutive submits died at "Creating customer profile" with
a 45s timeout on the first click into the order iframe, reported to the agent as
"the portal was still busy… try again in a moment". The portal was not busy. An
Ant dialog — "Your Password is Expiring Soon" — was sitting on the outer shell
swallowing every click, and the dismissal code lost a race to it by ~0ms: it
looked exactly once, 3000ms after navigation, and the modal is inserted at
t+3.0s (measured live).

So the load-bearing test here is `test_a_modal_that_arrives_late_is_still_caught`
— everything else is guarding the ways a fix for that could go wrong.

Run from the scraper/ dir:  pytest tests/test_shell_modal.py
"""

import asyncio
import os
import pathlib
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shell_modal import (  # noqa: E402
    READ_SHELL_DIALOG_JS,
    clear_shell_dialog,
    describe_blocking_dialog,
    read_shell_dialog,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
PASSWORD_MODAL = (FIXTURES / "fixture_shell_password_modal.html").read_text()
CONSENT_MODAL = (FIXTURES / "fixture_shell_consent_modal.html").read_text()

# antd's own layout, which the fixtures don't carry: the wrap is position:fixed
# over the whole viewport. That is not decoration — it is why `offsetParent` is
# null for every Ant modal, and why a visibility test written around
# offsetParent alone reports the blocker as hidden.
HOST = """<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0}
  #myIframe{width:1000px;height:600px;border:0}
  .ant-modal-wrap{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1000;
                  overflow:auto;-webkit-overflow-scrolling:touch}
  .ant-modal{position:relative;margin:100px auto;background:#fff}
  .ant-modal-wrap.offscreen{left:auto;width:200px;top:0;height:80px}
</style>
<iframe id="myIframe" srcdoc="<div>Customer Order Information</div>"></iframe>
<script>
  // Record every click so a test can prove WHICH button was pressed — the
  // difference between "Later" and "Change Now" is the difference between
  // deferring a prompt and opening a password-change form on a live CRM.
  window.__clicks = [];
  window.__dismissOnClick = true;
  document.addEventListener('click', e => {
    const b = e.target.closest('button, .ant-modal-close');
    if (!b) return;
    window.__clicks.push((b.innerText || '✕').trim());
    if (window.__dismissOnClick) {
      const w = b.closest('.ant-modal-wrap');
      if (w) w.remove();
    }
  });
</script>
"""


def _run(coro_factory):
    """Drive a chromium page through a coroutine, sync-callable so bare pytest
    collects these (the older scraper suites are standalone scripts that collect
    zero tests and rot unnoticed)."""
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST)
                return await coro_factory(page)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


async def _inject(page, html: str, delay_ms: int = 0, cls: str = "") -> None:
    await page.evaluate(
        """([html, delay, cls]) => {
             const add = () => {
               const d = document.createElement('div');
               d.innerHTML = html;
               const el = d.firstElementChild;
               if (cls) el.classList.add(cls);
               document.body.appendChild(el);
             };
             delay ? setTimeout(add, delay) : add();
           }""",
        [html, delay_ms, cls],
    )


# ── Reading ─────────────────────────────────────────────────────────────────
def test_reads_the_dialog_that_cost_four_submits():
    async def go(page):
        await _inject(page, PASSWORD_MODAL)
        return await page.evaluate(READ_SHELL_DIALOG_JS)
    info = _run(go)
    assert info["present"] is True
    assert info["title"] == "Your Password is Expiring Soon"
    assert info["buttons"] == ["Later", "Change Now"]
    assert info["dismiss"] == "Later"
    assert info["blocking"] is True     # it IS over the middle of #myIframe


def test_a_clean_page_reports_nothing():
    assert _run(lambda page: page.evaluate(READ_SHELL_DIALOG_JS))["present"] is False


def test_a_modal_that_misses_the_form_is_not_blocking():
    # A shell dialog tucked in a corner must not fail a run that would have
    # succeeded — `blocking` is a hit-test on the iframe centre, not the mere
    # existence of a modal.
    async def go(page):
        await _inject(page, PASSWORD_MODAL, cls="offscreen")
        return await page.evaluate(READ_SHELL_DIALOG_JS)
    info = _run(go)
    assert info["present"] is True
    assert info["blocking"] is False


# ── Dismissing ──────────────────────────────────────────────────────────────
def test_a_modal_that_arrives_late_is_still_caught():
    """THE regression. The old code sampled once at t+3000ms and the modal lands
    at t+3000ms; polling is the only thing that makes this deterministic."""
    async def go(page):
        await _inject(page, PASSWORD_MODAL, delay_ms=3000)
        result = await clear_shell_dialog(page, appear_ms=8000)
        return result, await page.evaluate("() => window.__clicks")
    result, clicks = _run(go)
    assert result["outcome"] == "dismissed"
    assert result["clicked"] == "Later"
    assert clicks == ["Later"]


def test_a_single_look_misses_the_late_modal():
    """Pins the bug itself, so nobody 'simplifies' the poll back into a sample."""
    async def go(page):
        await _inject(page, PASSWORD_MODAL, delay_ms=3000)
        return await clear_shell_dialog(page, appear_ms=0)
    assert _run(go)["outcome"] == "none"


def test_it_never_presses_change_now():
    async def go(page):
        await _inject(page, PASSWORD_MODAL)
        await clear_shell_dialog(page, appear_ms=1000)
        return await page.evaluate("() => window.__clicks")
    clicks = _run(go)
    assert "Change Now" not in clicks
    assert clicks == ["Later"]


def test_an_unvetted_dialog_is_reported_not_clicked():
    async def go(page):
        await _inject(page, CONSENT_MODAL)
        result = await clear_shell_dialog(page, appear_ms=1000)
        return result, await page.evaluate("() => window.__clicks")
    result, clicks = _run(go)
    assert result["outcome"] == "stuck"
    assert result["reason"] == "no_safe_button"
    assert result["blocking"] is True
    assert clicks == []                 # nothing on a live CRM was pressed


def test_a_click_that_does_not_dismiss_is_reported_stuck():
    # An unverified click is the assumption that caused all of this: the button
    # was found, so the modal was declared gone.
    async def go(page):
        await page.evaluate("() => { window.__dismissOnClick = false; }")
        await _inject(page, PASSWORD_MODAL)
        return await clear_shell_dialog(page, appear_ms=1000, settle_ms=1000)
    result = _run(go)
    assert result["outcome"] == "stuck"
    assert result["reason"] == "still_up_after_click"


def test_read_never_raises_on_a_dead_page():
    async def go(page):
        await page.close()
        return await read_shell_dialog(page)
    assert _run(go) == {"present": False}


# ── Wording (pure — no browser) ─────────────────────────────────────────────
def test_the_message_names_the_dialog_and_its_buttons():
    msg = describe_blocking_dialog({
        "present": True, "title": "Your Password is Expiring Soon",
        "buttons": ["Later", "Change Now"],
    })
    assert "Your Password is Expiring Soon" in msg
    assert "Later, Change Now" in msg
    # The old message sent the agent to retry a dialog that waits for a human.
    assert "try again in a moment" not in msg


def test_no_dialog_no_message():
    assert describe_blocking_dialog(None) is None
    assert describe_blocking_dialog({"present": False}) is None


def test_an_untitled_dialog_still_produces_a_sentence():
    msg = describe_blocking_dialog({"present": True, "title": "", "buttons": []})
    assert "unnamed dialog" in msg

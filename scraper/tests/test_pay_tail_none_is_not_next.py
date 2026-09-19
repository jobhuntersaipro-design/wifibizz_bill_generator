"""pay_and_submit must not press Next when the pay wait returns none.

ORD-0201 (2026-09-19): after T&C the Pay shell was up, neither Pay nor
`.js-btn-next` was visible, `_wait_for_pay_or_next` returned `none`, and the
loop still called `click_next_newconn`. `_NEXT_JS` returned `nonext`, the run
died as `next_click_failed`, and auto-retry minted a second portal order.

Pay buttons are not `.js-btn-next`. A none wait is an unfinished Pay page, not
a missing Next.

Run from the scraper/ dir:
    pytest tests/test_pay_tail_none_is_not_next.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oe_feasibility  # noqa: E402


class _Loc:
    async def count(self):
        return 0


class _Frame:
    def locator(self, _sel):
        return _Loc()


def _run(monkeypatch, settled: str) -> tuple[dict, list]:
    clicks: list = []

    async def wait(_page, timeout_s=30):  # noqa: ARG001
        return settled

    async def click(_page, **_k):
        clicks.append(1)
        return {"status": "error", "error": "next_click_failed", "message": "nonext"}

    async def shot(_page, _tag):
        return None

    async def state(_page):
        return {"dialogs": []}

    async def terms(_page):
        return False

    monkeypatch.setattr(oe_feasibility, "_wait_for_pay_or_next", wait)
    monkeypatch.setattr(oe_feasibility, "click_next_newconn", click)
    monkeypatch.setattr(oe_feasibility, "_frame", lambda _p: _Frame())
    monkeypatch.setattr(oe_feasibility, "_debug_screenshot", shot)
    monkeypatch.setattr(oe_feasibility, "_attachment_page_state", state)
    monkeypatch.setattr(oe_feasibility, "_ensure_bypass_acknowledge", terms)

    result = asyncio.run(oe_feasibility.pay_and_submit(object()))
    return result, clicks


def test_none_returns_pay_page_not_ready_without_clicking_next(monkeypatch):
    result, clicks = _run(monkeypatch, "none")
    assert result["error"] == "pay_page_not_ready"
    assert result["status"] == "error"
    assert result["stage"] == "pay_tail"
    assert "nonext" not in (result.get("message") or "")
    assert result.get("error") != "next_click_failed"
    assert clicks == []


def test_next_still_presses_next(monkeypatch):
    result, clicks = _run(monkeypatch, "next")
    assert clicks == [1]
    assert result["error"] == "next_click_failed"

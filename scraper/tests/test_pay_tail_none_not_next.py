"""test_pay_tail_none_not_next.py — wait `none` must not press Next.

ORD-0201 (admin cmu6qp1kq000404jkg5z5rm89): `_wait_for_pay_or_next` returned
`none` (AJAX Pay shell after T&C — neither Pay nor `.js-btn-next`). The loop
still called `click_next_newconn`, `_NEXT_JS` returned `nonext`, and the run
died as `next_click_failed`. Pay buttons are not `.js-btn-next`.

These pin the frozen ACs without a live portal: `none` → `pay_page_not_ready`,
no Next click, and the picker token is never stored as the message.

Run from the scraper/ dir:
    pytest tests/test_pay_tail_none_not_next.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oe_feasibility as oe  # noqa: E402


class _FakeLocator:
    async def count(self):
        return 0


class _FakeFrame:
    def locator(self, _sel):
        return _FakeLocator()


def _run(coro):
    return asyncio.run(coro)


def test_wait_none_returns_pay_page_not_ready_without_clicking_next(monkeypatch):
    clicks = []

    async def wait_none(_page, timeout_s=30):  # noqa: ARG001
        return "none"

    async def click_next(*_a, **_k):
        clicks.append(1)
        raise AssertionError("click_next_newconn must not run when wait returns none")

    async def shot(*_a, **_k):
        return "/tmp/pay_page_not_ready.png"

    monkeypatch.setattr(oe, "_wait_for_pay_or_next", wait_none)
    monkeypatch.setattr(oe, "click_next_newconn", click_next)
    monkeypatch.setattr(oe, "_debug_screenshot", shot)
    monkeypatch.setattr(oe, "_frame", lambda _page: _FakeFrame())

    r = _run(oe.pay_and_submit(object()))
    assert r["error"] == "pay_page_not_ready"
    assert r["stage"] == "pay_tail"
    assert r["status"] == "error"
    assert clicks == []
    assert "nonext" not in (r.get("message") or "").lower()
    assert r.get("error") != "next_click_failed"


def test_wait_next_still_clicks_next(monkeypatch):
    clicks = []

    async def wait_next(_page, timeout_s=30):  # noqa: ARG001
        return "next"

    async def click_next(*_a, **_k):
        clicks.append(1)
        return {"status": "error", "error": "next_click_failed",
                "message": "No Next button was visible on this page."}

    async def no_terms(_page):
        return False

    async def state(_page):
        return {"dialogs": []}

    async def shot(*_a, **_k):
        return None

    monkeypatch.setattr(oe, "_wait_for_pay_or_next", wait_next)
    monkeypatch.setattr(oe, "click_next_newconn", click_next)
    monkeypatch.setattr(oe, "_ensure_bypass_acknowledge", no_terms)
    monkeypatch.setattr(oe, "_attachment_page_state", state)
    monkeypatch.setattr(oe, "_debug_screenshot", shot)
    monkeypatch.setattr(oe, "_frame", lambda _page: _FakeFrame())

    r = _run(oe.pay_and_submit(object()))
    assert clicks == [1]
    assert r["error"] == "next_click_failed"


def test_click_next_does_not_store_the_nonext_token(monkeypatch):
    class _Page:
        async def evaluate(self, _js):
            return "nonext"

    monkeypatch.setattr(oe, "_frame", lambda _page: _FakeFrame())
    r = _run(oe.click_next_newconn(_Page()))
    assert r["error"] == "next_click_failed"
    assert r["message"] != "nonext"
    assert "nonext" not in r["message"].lower()
    assert "Next" in r["message"]


def test_click_next_does_not_store_the_nodoc_token(monkeypatch):
    class _Page:
        async def evaluate(self, _js):
            return "nodoc"

    monkeypatch.setattr(oe, "_frame", lambda _page: _FakeFrame())
    r = _run(oe.click_next_newconn(_Page()))
    assert r["error"] == "next_click_failed"
    assert "nodoc" not in r["message"].lower()

"""The Broadband/TV Service Number Check must not report a refused name as ok.

Live 2026-09-15, order 2609000125316868: a 27-character username was refused by
Check ("The format is illegal … the length cannot exceed 21"), the step returned
ok with the popup as a note, and the Next then blocked with "Please check the
service number first." after the order number was already minted.
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import oe_feasibility as oe  # noqa: E402

LIVE_FORMAT = ("The format is illegal, cannot contain special characters, "
               "and the length cannot exceed 21")


class _Loc:
    def __init__(self, typed):
        self.typed = typed
        self.last = self

    async def click(self, timeout=None):
        pass

    async def fill(self, value, timeout=None):
        self.typed.append(value)


class _Frame:
    def __init__(self):
        self.typed = []

    def locator(self, _selector):
        return _Loc(self.typed)


def _run(monkeypatch, replies, email="faizdarwisybinsuhaimi123@gmail.com"):
    queue = list(replies)

    async def popup(_frame, _page, exclude_title_re=None):
        return queue.pop(0) if queue else None

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(oe, "_dismiss_popup_ok", popup)
    monkeypatch.setattr(oe.asyncio, "sleep", no_sleep)
    frame = _Frame()
    result = asyncio.run(oe._set_service_number_username(frame, None, email))
    return result, frame.typed


def test_every_typed_name_fits_the_portal_limit(monkeypatch):
    result, typed = _run(monkeypatch, [None])
    assert result["status"] == "ok"
    assert all(len(n) <= oe.SERVICE_USERNAME_MAX for n in typed)


def test_a_format_refusal_is_retried_not_called_ok(monkeypatch):
    result, typed = _run(monkeypatch, [LIVE_FORMAT, None])
    assert result["status"] == "ok"
    assert result["attempts"] == 2
    assert "note" not in result
    assert len(typed) == 2 and typed[0] != typed[1]


def test_refused_on_every_try_fails_with_the_portal_wording(monkeypatch):
    result, typed = _run(monkeypatch, [LIVE_FORMAT] * 4)
    assert result["status"] == "error"
    assert result["error"] == "login_id_invalid"
    assert LIVE_FORMAT in result["message"]
    assert len(typed) == 4


def test_an_unrelated_popup_keeps_the_old_behaviour(monkeypatch):
    result, _ = _run(monkeypatch, ["Some informational message."])
    assert result["status"] == "ok"
    assert result["note"] == "Some informational message."

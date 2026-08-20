"""
test_captures.py - Tests for the per-screen capture trail.

Pure logic only (no browser, no bucket, no network). Covers the three things a
live run cannot be relied on to reveal:

  1. the R2 key shape per slot, which the app's auth-gated route matches on by
     prefix and the lifecycle rule matches on by the same prefix;
  2. slot slugging, because sub-product slots come from the tab text the PORTAL
     reports — text we do not control, which lands in a key and in a URL;
  3. that a capture failure returns a detail and never raises. Evidence must
     never cost an order that is already minted in the portal, and there are now
     nine chances per attempt to break that rule instead of one.

Run from the scraper/ dir:
    pytest tests/test_captures.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    _capture_enabled,
    _shoot,
    _tab_slot,
    capture_and_report,
    capture_screen,
    capture_stage_name,
)
from r2_upload import screenshot_key, slot_slug  # noqa: E402


REF = {"order_ref": {"user_id": "u1", "order_id": "o1", "attempt": 2}}


class _Page:
    """The bit of a Playwright page capture touches."""

    def __init__(self, raises=None):
        self.raises = raises
        self.calls = []

    async def screenshot(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises:
            raise self.raises
        return b"\xff\xd8jpeg-bytes"


# ── Key shape ───────────────────────────────────────────────────────────────

def test_key_carries_the_slot():
    assert (screenshot_key("u", "o", 1, "broadband")
            == "order-screenshots/u/o/submit-1-broadband.jpg")
    assert (screenshot_key("u", "o", 4, "order_info")
            == "order-screenshots/u/o/submit-4-order_info.jpg")


def test_every_slot_stays_under_the_authorised_prefix():
    for slot in ("page1", "broadband", "voice", "tv", "order_info",
                 "attachments", "appointment", "delivery", "pay"):
        key = screenshot_key("user-1", "order-9", 1, slot)
        assert key.startswith("order-screenshots/user-1/order-9/")
        assert key.endswith(f"-{slot}.jpg")


# ── Slot slugging ───────────────────────────────────────────────────────────

def test_odd_portal_tab_text_is_sanitised_into_a_safe_slug():
    # Whatever the portal names a tab ends up in an R2 key AND in a URL query
    # string, so nothing outside [a-z0-9_] may survive.
    assert slot_slug("Unifi Home 500Mbps (Broadband)") == "unifi_home_500mbps_broadband"
    assert slot_slug("A/B — tab!") == "a_b_tab"
    assert slot_slug("   ") == "screen"
    assert slot_slug("") == "screen"
    # Bounded, and never left with a trailing separator.
    assert len(slot_slug("x" * 200)) == 32
    assert not slot_slug("abcdefghij klmnopqrstuvwxyz abcdefg").endswith("_")


def test_known_tabs_map_to_their_own_slot_whatever_the_offer_is_called():
    assert _tab_slot("Unifi Home 500Mbps (Broadband)") == "broadband"
    assert _tab_slot("Residential Voice Basic (Voice)") == "voice"
    assert _tab_slot("NEW UNIFI TV (Unifi TV)") == "tv"
    # An unrecognised tab still produces a usable, unique slot rather than
    # colliding with another tab's frame.
    assert _tab_slot("Something Else") == "something_else"


def test_stage_name_is_prefixed_so_bizzflow_can_partition_by_prefix():
    assert capture_stage_name("broadband") == "capture_broadband"
    assert capture_stage_name("Unifi TV") == "capture_unifi_tv"


# ── Failure is never fatal ──────────────────────────────────────────────────

def test_a_failed_shot_reports_a_detail_and_does_not_raise():
    page = _Page(raises=RuntimeError("renderer gone"))
    d = asyncio.run(capture_screen(page, REF, "broadband"))
    assert d["outcome"] == "failed"
    assert "RuntimeError" in d["note"]


def test_a_failed_upload_reports_a_detail_and_does_not_raise(monkeypatch):
    # No R2 credentials in the test env, so upload_bytes raises a KeyError on
    # os.environ — exactly the shape of a misconfigured droplet.
    monkeypatch.delenv("R2_ACCOUNT_ID", raising=False)
    page = _Page()
    d = asyncio.run(capture_screen(page, REF, "pay"))
    assert d["outcome"] == "failed"
    assert d["value"] == "Screenshot not stored"


def test_capture_and_report_swallows_a_failure_capture_screen_itself_missed():
    # capture_and_report is what every call site uses, and it is the backstop for
    # a raise from OUTSIDE capture_screen's own try blocks — here a malformed
    # payload, which blows up on the order_ref lookup. A raise escaping to a call
    # site would abort a submit that is already minted in the portal.
    seen = []
    out = asyncio.run(
        capture_and_report(_Page(), "not-a-dict", "voice", lambda *a: seen.append(a)))
    assert out is None
    assert seen == []


def test_a_reported_capture_lands_under_its_own_stage_key():
    seen = []
    d = asyncio.run(
        capture_and_report(_Page(), REF, "broadband", lambda *a: seen.append(a)))
    # No R2 credentials here, so the upload fails — but it still REPORTS, which
    # is the point: the slot says why rather than going quiet.
    assert d is not None
    assert seen == [("capture_broadband", d)]


def test_capture_is_skipped_without_an_order_to_file_it_under():
    # An older BizzFlow sends no order_ref. There is nowhere to put the image, so
    # the run must carry on silently rather than invent a key.
    assert asyncio.run(capture_screen(_Page(), {}, "page1")) is None


def test_screenshots_are_jpeg():
    page = _Page()
    asyncio.run(capture_screen(page, REF, "page1"))
    assert page.calls[0]["type"] == "jpeg"
    assert page.calls[0]["full_page"] is True


# ── What actually gets photographed ─────────────────────────────────────────
# The portal renders inside #myIframe. `page.screenshot(full_page=True)` expands
# the OUTER document only, so it captures just the slice of the portal that fits
# in the iframe box — measured live: a 3000px portal document came back as a
# 740px image. The fields worth photographing all sit below that fold.

class _Locator:
    """Playwright's locator chain: .locator(sel).first.screenshot()."""

    def __init__(self, owner):
        self.owner = owner
        self.kwargs = None

    def locator(self, target):
        self.owner.shot_target = target
        return self

    @property
    def first(self):
        return self

    async def screenshot(self, **kwargs):
        self.kwargs = kwargs
        return b"frame-bytes"


class _FramePage:
    """A page with a portal frame, recording which element got shot."""

    def __init__(self, geom):
        self.geom = geom
        self.shot_target = None
        self.outer_calls = []
        self.frame = _Locator(self)

    async def evaluate(self, _js):
        return self.geom

    async def screenshot(self, **kwargs):  # the OUTER, clipping shot
        self.outer_calls.append(kwargs)
        return b"outer"

    def frame_locator(self, _sel):
        return self.frame


def test_the_portal_frame_is_shot_not_the_outer_shell():
    page = _FramePage({"box": 600, "doc": 3000, "body": 3000})
    assert asyncio.run(_shoot(page)) == b"frame-bytes"
    assert page.shot_target == "body"
    assert page.frame.kwargs["type"] == "jpeg"
    # The outer full-page shot — the one that clips — must not have been used.
    assert page.outer_calls == []


def test_html_is_shot_when_the_portal_hangs_its_height_off_the_document():
    page = _FramePage({"box": 600, "doc": 3000, "body": 0})
    asyncio.run(_shoot(page))
    assert page.shot_target == "html"


def test_the_outer_page_is_the_fallback_when_there_is_no_portal_frame():
    # Some screens are the Ant shell itself, and a capture is never worth
    # failing a submit over — so a missing frame degrades, it does not raise.
    page = _FramePage(None)
    assert asyncio.run(_shoot(page)) == b"outer"
    assert page.outer_calls[0]["full_page"] is True


# ── Rollback switches ───────────────────────────────────────────────────────

def test_oe_capture_false_disables_every_slot(monkeypatch):
    monkeypatch.setenv("OE_CAPTURE", "false")
    assert not _capture_enabled("page1")
    assert not _capture_enabled("broadband")


def test_oe_capture_slots_is_an_allowlist(monkeypatch):
    monkeypatch.setenv("OE_CAPTURE_SLOTS", "page1,broadband")
    assert _capture_enabled("page1")
    assert _capture_enabled("broadband")
    assert not _capture_enabled("pay")


def test_the_phase1_page1_switch_still_works_and_only_touches_page1(monkeypatch):
    # A droplet configured before Phase 3 still carries OE_CAPTURE_PAGE1.
    monkeypatch.setenv("OE_CAPTURE_PAGE1", "false")
    assert not _capture_enabled("page1")
    assert _capture_enabled("broadband")


# ─────────────────────────────────────────────────────────────────────────────
# capture_failure — the one chokepoint that photographs every failed attempt.
# The whole point is that ~55 error-return sites get evidence without each one
# being edited, so what is worth pinning is WHEN it engages: exactly on a dict
# with status "error" and a live page, and never otherwise.
# ─────────────────────────────────────────────────────────────────────────────

def test_capture_failure_engages_on_error_result(monkeypatch):
    import oe_feasibility

    calls = []

    async def fake_capture_and_report(page, payload, slot, stage):
        calls.append(slot)

    monkeypatch.setattr(oe_feasibility, "capture_and_report", fake_capture_and_report)
    result = {"status": "error", "error": "offer_not_found", "stage": "select_plan"}
    asyncio.run(oe_feasibility.capture_failure(_Page(), REF, result, lambda *a: None))
    assert calls == ["failure"], "an error result with a live page must be photographed"


def test_capture_failure_stays_out_of_non_failures(monkeypatch):
    import oe_feasibility

    calls = []

    async def fake_capture_and_report(page, payload, slot, stage):
        calls.append(slot)

    monkeypatch.setattr(oe_feasibility, "capture_and_report", fake_capture_and_report)
    stage = lambda *a: None  # noqa: E731

    # A success, a dry run and a ready-to-pay stop are not failures.
    for status in ("submitted", "success", "dry_run", "ready_to_pay", "discovered"):
        asyncio.run(oe_feasibility.capture_failure(_Page(), REF, {"status": status}, stage))
    # A result that is not a dict at all (defensive against a raise path).
    asyncio.run(oe_feasibility.capture_failure(_Page(), REF, None, stage))
    # No page — the browser never opened (e.g. doc download failed first).
    asyncio.run(oe_feasibility.capture_failure(
        None, REF, {"status": "error", "error": "doc_download_failed"}, stage))

    assert calls == [], "capture_failure must engage only on status=='error' with a page"


def test_failure_slot_reports_under_its_own_stage():
    # BizzFlow partitions captures by the capture_ prefix; the failure frame
    # must land under a stage of its own, next to the step that failed.
    assert capture_stage_name("failure") == "capture_failure"

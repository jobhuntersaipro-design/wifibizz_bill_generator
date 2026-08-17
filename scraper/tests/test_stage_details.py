"""
test_stage_details.py - Tests for the submit-progress stage detail payloads.

Pure logic only (no browser, no credentials, no network). Covers the three
things that would silently break the live checklist:

  1. the on_stage back-compat shim — the droplet and Vercel deploy separately,
     so a 2-arg call must fall back to an older name-only callback;
  2. _step_detail's refusal to report a skipped page-1 field as done;
  3. the R2 key shape, which the app's auth-gated route matches on by prefix.

Run from the scraper/ dir:
    pytest tests/test_stage_details.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    _contact_name,
    _detail,
    _longest_title,
    _stage_emitter,
    _step_detail,
)
from r2_upload import screenshot_key  # noqa: E402


# ── on_stage back-compat ────────────────────────────────────────────────────

def test_emitter_passes_detail_to_a_two_arg_callback():
    seen = []
    stage = _stage_emitter(lambda name, detail=None: seen.append((name, detail)))
    stage("checking_address", _detail("A-07-15 PERSIARAN SAUJANA"))
    assert seen == [("checking_address", {"value": "A-07-15 PERSIARAN SAUJANA",
                                          "outcome": "ok"})]


def test_emitter_falls_back_to_a_name_only_callback():
    # An older BizzFlow's callback takes the name alone. Passing a detail must
    # degrade to the 1-arg call, not crash a live submit mid-flow.
    seen = []
    stage = _stage_emitter(lambda name: seen.append(name))
    stage("checking_plan", _detail("Unifi Home 500Mbps"))
    assert seen == ["checking_plan"]


def test_emitter_swallows_a_raising_callback():
    # Reporting is additive. A broken consumer must never change what the
    # portal flow does.
    def boom(name, detail=None):
        raise RuntimeError("consumer exploded")

    _stage_emitter(boom)("placing_order", _detail("Order clicked"))


def test_emitter_is_a_noop_without_a_callback():
    _stage_emitter(None)("winback_tagging", _detail("HSBA Wireless Access"))


# ── detail payloads ─────────────────────────────────────────────────────────

def test_detail_truncates_an_unbounded_portal_string():
    # A stage detail is a label, and it rides on every job poll.
    d = _detail("X" * 5000)
    assert len(d["value"]) == 300
    assert d["value"].endswith("...")


def test_step_detail_reports_a_present_but_unset_field_as_skipped():
    # Winback Tagging left at "---Please select---" — the field IS on the form.
    # The portal treats it as mandatory, so a green tick here would claim work
    # that never happened.
    d = _step_detail({"status": "skipped", "reason": "unset",
                      "message": "winback option 'HSBA Wireless Access' not found"}, "selected")
    assert d["outcome"] == "skipped"
    assert d["value"] == "Not selected"


def test_step_detail_does_not_flag_a_field_the_offer_does_not_have():
    # Business packages carry no Winback Tagging at all. Reporting that as a
    # warning would put a false amber step on every Business order.
    d = _step_detail({"status": "skipped", "reason": "not_applicable",
                      "message": "winback not applicable (nolabel)"}, "selected")
    assert d["outcome"] == "not_applicable"
    assert d["value"] == "Not applicable for this package"
    assert "nolabel" in d["note"]


def test_step_detail_treats_an_unlabelled_skip_as_unset():
    # An older step function that declares no reason. Under-reporting a real
    # unset mandatory field is the worse failure, so default to flagging it.
    assert _step_detail({"status": "skipped"}, "selected")["outcome"] == "skipped"


def test_step_detail_reads_the_note_key_when_there_is_no_message():
    # create_billing_account uses `note`, not `message`.
    d = _step_detail({"status": "skipped", "reason": "not_applicable",
                      "note": "no account field"}, "name")
    assert d["note"] == "no account field"


def test_step_detail_reports_the_selected_value_on_success():
    d = _step_detail({"status": "ok", "selected": "HSBA Wireless Access"}, "selected")
    assert d == {"value": "HSBA Wireless Access", "outcome": "ok"}


def test_step_detail_falls_back_when_the_step_named_no_value():
    d = _step_detail({"status": "ok"}, "name", "WOJAK LANG")
    assert d["value"] == "WOJAK LANG"
    d = _step_detail({"status": "ok"}, "name")
    assert d["value"] == "Set"


def test_step_detail_reports_an_error_as_failed():
    d = _step_detail({"status": "error", "message": "grid did not appear"}, "selected")
    assert d["outcome"] == "failed"
    assert d["value"] == "grid did not appear"


# ── row parsing ─────────────────────────────────────────────────────────────

def test_longest_title_picks_the_address_column():
    # The grid has no stable column id; the concatAddress is always the longest.
    titles = ["FTTH", "SELANGOR", "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BSP 21", "42610"]
    assert _longest_title(titles).startswith("A-07-15")
    assert _longest_title([]) == ""
    assert _longest_title(None) == ""


def test_contact_name_takes_the_leading_cell():
    assert _contact_name("WOJAK LANG\t60163445434\twojaklang@gmail.com") == "WOJAK LANG"
    assert _contact_name("  WOJAK LANG  ") == "WOJAK LANG"
    assert _contact_name("") == ""


# ── R2 key shape ────────────────────────────────────────────────────────────

def test_screenshot_key_is_per_user_order_and_attempt():
    # The app's route authorises by the `order-screenshots/<userId>/` prefix, and
    # the 90-day R2 lifecycle rule matches the same prefix. Both break if this
    # shape drifts.
    key = screenshot_key("user-1", "order-9", 3)
    assert key == "order-screenshots/user-1/order-9/submit-3-page1.jpg"
    assert key.startswith("order-screenshots/user-1/")
    assert key.endswith(".jpg")


def test_screenshot_key_defaults_to_the_first_attempt_and_page1():
    assert screenshot_key("u", "o").endswith("submit-1-page1.jpg")

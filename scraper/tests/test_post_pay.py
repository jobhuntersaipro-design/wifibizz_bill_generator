"""
test_post_pay.py - The tail that runs AFTER a real payment.

Pure logic only (no browser, no bucket, no portal). Everything here executes
only when `do_pay=TRUE`, which means it cannot be exercised without spending
real money — so the parts that can be tested without the portal are tested
without it, and deliberately:

  1. the e-RF key shape, which the app's auth-gated route matches by prefix and
     the R2 lifecycle rule expires by the same prefix;
  2. the order-number guard, because a value that reaches `Order.orderId` makes
     the row claim a portal order — a failure sentence written there is a lie
     about a paid order;
  3. that a stranded run says a PAYMENT WAS MADE before it says anything else.
     The recovery is to check the portal by hand, never to resubmit, and the
     message is the only thing that tells anyone that.

Run from the scraper/ dir:
    pytest tests/test_post_pay.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_errors import ERF_NOT_DOWNLOADED  # noqa: E402
from oe_feasibility import (  # noqa: E402
    _better_confirmation,
    _paid_but_stranded,
    _post_pay_outcome,
    is_portal_order_number,
)
from r2_upload import erf_key  # noqa: E402


# ── Key shape ───────────────────────────────────────────────────────────────

def test_erf_key_is_named_for_the_portal_order():
    # The number on the document, not the attempt: `submit-3-erf.pdf` is
    # unidentifiable the moment it leaves the browser, and the route serves this
    # basename as the download filename.
    assert (erf_key("u1", "o9", "2608000121575083")
            == "order-screenshots/u1/o9/2608000121575083_erf.pdf")


def test_erf_key_shares_the_screenshot_prefix():
    # Same prefix as the frames, so the 90-day lifecycle rule (which filters by
    # prefix) expires the form with the evidence it belongs to. If this ever has
    # to become permanent it moves prefix, which is a migration, not a setting.
    assert erf_key("u", "o", "123").startswith("order-screenshots/u/o/")
    assert erf_key("u", "o", "123").endswith(".pdf")


def test_erf_key_strips_anything_that_would_break_a_key_or_a_url():
    assert erf_key("u", "o", "2608/000 121") == "order-screenshots/u/o/2608000121_erf.pdf"
    assert erf_key("u", "o", "../../etc") == "order-screenshots/u/o/etc_erf.pdf"


def test_erf_key_never_produces_a_bare_underscore_name():
    # An empty order number must not yield `_erf.pdf`, which sorts and reads as
    # a broken object rather than as a document for an unnamed order.
    assert erf_key("u", "o", "") == "order-screenshots/u/o/order_erf.pdf"
    assert erf_key("u", "o", None) == "order-screenshots/u/o/order_erf.pdf"


def test_erf_key_is_bounded():
    assert len(erf_key("u", "o", "9" * 500).rsplit("/", 1)[1]) <= 32 + len("_erf.pdf")


# ── Order-number guard ──────────────────────────────────────────────────────

def test_a_portal_order_number_is_a_long_run_of_digits():
    assert is_portal_order_number("2608000121575083")
    assert is_portal_order_number("  2608000121575083  ")


def test_a_failure_sentence_is_never_an_order_number():
    # The twin of BizzFlow's isPortalOrderNumber. Both ends check, because both
    # ends can write Order.orderId.
    assert not is_portal_order_number("Portal did not show a Customer Order Number")
    assert not is_portal_order_number("BUNDLE37849267")  # a service number, not an order
    assert not is_portal_order_number("12345")           # too short
    assert not is_portal_order_number("")
    assert not is_portal_order_number(None)


# ── The one error this tail may return ──────────────────────────────────────

def test_a_stranded_run_leads_with_the_payment():
    r = _paid_but_stranded("Next did not advance.", "150.00")
    assert r["status"] == "error"
    assert r["error"] == "post_pay_not_confirmed"
    # Whoever reads this has to know money moved BEFORE they read anything else.
    assert r["message"].startswith("PAYMENT WAS SUBMITTED")
    assert "do NOT resubmit blind" in r["message"]
    # The portal's own wording survives — it is the only clue to what blocked.
    assert "Next did not advance." in r["message"]
    assert r["advance_payment"] == "150.00"


def test_a_stranded_run_reads_cleanly_with_no_detail():
    r = _paid_but_stranded(None, None)
    assert not r["message"].endswith(" ")
    assert "PAYMENT WAS SUBMITTED" in r["message"]


# ── Never lose a confirmation we already read ───────────────────────────────
#
# The post-Pay loop walks PAST the "Submit Successfully" screen looking for the
# e-RF page. If the number read there is dropped, a run that then fails to find
# the e-RF page (the most likely live failure — the Print e-RF text not matching)
# reports "no order number" for an order that was read AND paid for. That is the
# exact failure this tail exists to prevent, so it gets its own tests.

OK = {"order_id": "2608000121575083", "order_url": "https://…"}
NUMBERLESS = {"order_id": None, "order_url": None}


def test_a_confirmation_with_a_number_is_kept():
    assert _better_confirmation(None, OK) == OK


def test_a_later_numberless_match_never_displaces_a_good_one():
    # _find_submit_result returns a dict with order_id=None when it matches the
    # success wording but not the number, so truthiness is not the test.
    assert _better_confirmation(OK, NUMBERLESS) == OK
    assert _better_confirmation(OK, None) == OK


def test_a_numberless_match_is_still_better_than_nothing():
    assert _better_confirmation(None, NUMBERLESS) == NUMBERLESS


def test_a_known_order_number_survives_a_failed_erf_hunt():
    r = _post_pay_outcome(OK, "150.00", "the e-RF page was not reached.")
    assert r["status"] == "submitted"          # NOT an error: it is paid and known
    assert r["order_id"] == "2608000121575083"
    assert "the e-RF page was not reached." in r["warning"]


def test_no_order_number_anywhere_is_a_stranded_error():
    r = _post_pay_outcome(None, None, "the e-RF page was not reached.")
    assert r["status"] == "error"
    assert r["message"].startswith("PAYMENT WAS SUBMITTED")


def test_a_confirmation_without_a_number_does_not_count_as_known():
    # Seeing the words is not knowing the order. Reporting `submitted` with a
    # null id would put a row in the table that names no portal order.
    r = _post_pay_outcome(NUMBERLESS, None, "the e-RF page was not reached.")
    assert r["status"] == "error"


def test_the_erf_code_matches_the_string_bizzflow_renders():
    # src/lib/order-types.ts ERF_NOT_DOWNLOADED. Two constants, two languages,
    # one code: drift makes the UI fall back to the raw message with no title,
    # no explanation and no fix.
    assert ERF_NOT_DOWNLOADED == "erf_not_downloaded"


# ── The order number the run already holds ──────────────────────────────────
#
# Added after a real paid-order failure (2608000121617449): the tail declared
# "the portal never showed a confirmed order number afterwards" for an order
# whose number the same run had read, stored and printed several steps earlier.
# The portal does not have to confirm a number it already minted.

def test_a_known_order_number_makes_a_stalled_chain_submitted_not_stranded():
    r = _post_pay_outcome(None, "100.00", "the e-RF page was not reached.",
                          "2608000121617449")
    assert r["status"] == "submitted"
    assert r["order_id"] == "2608000121617449"
    assert "2608000121617449" in r["order_url"]
    assert "warning" in r and "error" not in r


def test_a_confirmation_read_after_payment_still_wins():
    # Both available: prefer what the portal said AFTER the charge.
    r = _post_pay_outcome({"order_id": "2608000121600001", "order_url": "u"},
                          None, "…", "2608000121617449")
    assert r["order_id"] == "2608000121600001"


def test_a_non_order_shaped_known_value_is_not_promoted():
    # The same guard as everywhere else: only a real portal number may reach
    # Order.orderId, or the row claims an order that does not exist.
    r = _post_pay_outcome(None, None, "…", "capturing_order_no failed")
    assert r["status"] == "error" and r["error"] == "post_pay_not_confirmed"


def test_with_nothing_at_all_it_still_leads_with_the_payment():
    r = _post_pay_outcome(None, None, "…", None)
    assert r["message"].startswith("PAYMENT WAS SUBMITTED")

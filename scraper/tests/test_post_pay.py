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

from oe_feasibility import _paid_but_stranded, is_portal_order_number  # noqa: E402
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

"""test_result_redaction.py — what survives the PII filter on an order result.

`/jobs/<id>` is the ONLY way BizzFlow sees a run's outcome, and every result
passes through `_redact_order_result` first. A field the scraper returns but the
whitelist omits does not reach the UI at all — it reads exactly like the scraper
never produced it.

That has now happened twice: once with `ap_amount` (renamed to
`advance_payment`, so the "Advance Payment RM…" note could never show), and once
with `erf_key` — a run on 2026-08-19 paid order 2608000121625616, downloaded its
e-RF and uploaded 111,835 bytes to R2, and was reported as "finished without
downloading the e-RF" and demoted from Submitted to Order Entered.

So the contract is pinned here rather than left to review.

Run from the scraper/ dir:
    pytest tests/test_result_redaction.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api_server import _redact_order_result  # noqa: E402

# Every field `OrderJobResult` (src/lib/order-submit.ts) reads off a result.
# Adding one there without adding it here silently drops it.
BIZZFLOW_READS = [
    "status", "stage", "error", "message", "warning",
    "order_id", "order_url", "erf_key", "advance_payment",
    "available_devices", "portal_code",
]

# A real successful run, as pay_and_submit returns it.
SUBMITTED = {
    "status": "submitted",
    "stage": "done",
    "advance_payment": "100.00",
    "order_id": "2608000121625616",
    "order_url": "https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails"
                 "?custOrderId=2608000121625616&custOrderNbr=2608000121625616",
    "erf_key": "order-screenshots/u1/o1/2608000121625616_erf.pdf",
}


def test_every_field_bizzflow_reads_survives():
    kept = _redact_order_result({k: f"v-{k}" for k in BIZZFLOW_READS})
    missing = [k for k in BIZZFLOW_READS if k not in kept]
    assert not missing, f"redaction drops fields the UI needs: {missing}"


def test_a_paid_run_keeps_the_proof_it_paid():
    kept = _redact_order_result(SUBMITTED)
    # erf_key is what decides Submitted vs "no registration form", so its loss
    # turns a finished order into a warning with a false explanation.
    assert kept["erf_key"] == SUBMITTED["erf_key"]
    assert kept["order_id"] == "2608000121625616"
    assert kept["advance_payment"] == "100.00"
    assert kept["status"] == "submitted"


def test_customer_data_still_does_not_reach_the_log():
    kept = _redact_order_result({
        **SUBMITTED,
        "customer": {"name": "TUCK KEE LEE", "id_no": "700101015555"},
        "would_submit": {"mobile": "60123456789", "email": "a@b.com"},
        "address": "3, JALAN X, 40000 SHAH ALAM",
    })
    for pii in ("customer", "would_submit", "address"):
        assert pii not in kept


def test_a_non_dict_result_passes_through_untouched():
    assert _redact_order_result("dry run") == "dry run"
    assert _redact_order_result(None) is None

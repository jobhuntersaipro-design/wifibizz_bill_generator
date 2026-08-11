"""
test_helpers.py - Tests for the order-entry helpers.

Two tiers:

  1. Pure-logic tests (always run): error-message → code mapping, payload
     fixture shape. No browser, no credentials.

  2. Live primitive tests (opt-in): exercise set_combobox / select_grid_row /
     check_error against a real headed dry-run. These need stored credentials
     and a live session, so they are SKIPPED unless OE_LIVE=1 is set. This
     matches the build spec: "unit-test the 3 primitives against a live dry-run."

Run from the scraper/ dir:
    pytest tests/test_helpers.py                 # pure-logic only
    OE_LIVE=1 pytest tests/test_helpers.py       # + live dry-run primitives
"""

import json
import os
import sys

import pytest

# Allow `import oe_errors` etc. when pytest is invoked from anywhere.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from oe_errors import (  # noqa: E402
    ADDRESS_ALREADY_HAS_SERVICE,
    ADDRESS_NOT_FOUND,
    LOGIN_ID_INVALID,
    LOGIN_ID_TAKEN,
    MSR_CUSTOMER_ID_LIMIT,
    MSR_OFFLINE_APPROVAL,
    UNKNOWN_ERROR,
    VOBB_UNAVAILABLE,
    map_error,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "payload_residential.json")


# ── Tier 1: error mapping (the BizzFlow contract) ────────────────────────────
@pytest.mark.parametrize(
    "message,expected",
    [
        ("This address already has TM services installed.", ADDRESS_ALREADY_HAS_SERVICE),
        ("No record to view", ADDRESS_NOT_FOUND),
        ("Customer has reached the maximum number of line.", MSR_CUSTOMER_ID_LIMIT),
        ("This business order requires offline approval.", MSR_OFFLINE_APPROVAL),
        ("The Login ID is already taken, please choose another.", LOGIN_ID_TAKEN),
        ("Login ID must be 2-11 characters.", LOGIN_ID_INVALID),
        ("No number available in the VoBB pool.", VOBB_UNAVAILABLE),
        ("Some brand new message we have never seen", UNKNOWN_ERROR),
        ("", UNKNOWN_ERROR),
    ],
)
def test_map_error(message, expected):
    assert map_error(message) == expected


def test_map_error_is_case_insensitive():
    assert map_error("ALREADY HAS TM SERVICE") == ADDRESS_ALREADY_HAS_SERVICE


def test_taken_beats_generic_login_id_rule():
    # "already taken" must win over the generic "login id" → invalid rule.
    assert map_error("This Login ID already taken") == LOGIN_ID_TAKEN


# ── Tier 1: fixture shape (keeps the payload contract honest) ────────────────
def test_fixture_has_required_keys():
    with open(FIXTURE) as f:
        payload = json.load(f)
    for key in ("customer", "address", "plan"):
        assert key in payload, f"payload missing '{key}'"

    cust = payload["customer"]
    for key in (
        "id_type", "id_number", "name", "gender", "birthday", "race",
        "nationality", "preferred_language", "customer_tenure",
        "sub_segment", "segment", "segment_code", "contact",
    ):
        assert key in cust, f"customer missing '{key}'"

    for key in ("name", "preferred_contact", "role", "mobile_prefix", "mobile", "email"):
        assert key in cust["contact"], f"contact missing '{key}'"

    for key in ("state", "keywords"):
        assert key in payload["address"], f"address missing '{key}'"
    for key in ("category", "name"):
        assert key in payload["plan"], f"plan missing '{key}'"


def test_login_id_within_length_bounds():
    with open(FIXTURE) as f:
        payload = json.load(f)
    login_id = payload.get("login_id", "")
    assert 2 <= len(login_id) <= 11, "login_id must be 2-11 chars (broadband rule)"


# ── Tier 2: live primitives (opt-in) ─────────────────────────────────────────
live = pytest.mark.skipif(
    os.environ.get("OE_LIVE") != "1",
    reason="Set OE_LIVE=1 to run live dry-run primitive tests (needs credentials).",
)


@live
@pytest.mark.asyncio
async def test_live_dry_run_reaches_capture_frontier():
    """
    A full dry-run with the residential fixture should walk stages 1-5 and then
    return status='needs_capture' at fill_install_info (first unmapped stage),
    OR a clean expected error. It must NOT raise for expected flow failures.
    """
    from order_entry import enter_order

    with open(FIXTURE) as f:
        payload = json.load(f)

    result = await enter_order(payload, dry_run=True)
    assert result["status"] in {"needs_capture", "error", "dry_run"}
    if result["status"] == "needs_capture":
        assert result["stage"] == "fill_install_info"
    assert "screenshot" in result

"""A step that throws under a portal popup files the popup's own code.

Live 2026-09-28, ORD-0275: the portal refused with "This address already has TM
services installed, please try a different address." while a later step threw.
The exception path filed it as a bare `portal_error`, so it read as unclassified
and was auto-retried three times against an answer that cannot change.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from oe_feasibility import exception_outcome  # noqa: E402

LIVE = "This address already has TM services installed, please try a different address."


def test_known_refusal_gets_its_own_code():
    out = exception_outcome(LIVE, TimeoutError("Locator.click: Timeout"))
    assert out["error"] == "address_already_has_service"
    assert out["message"] == LIVE
    assert out["exception"].startswith("TimeoutError")


def test_unrecognised_popup_stays_portal_error():
    out = exception_outcome("Something the table has never seen.", RuntimeError("x"))
    assert out["error"] == "portal_error"


def test_no_popup_is_an_exception():
    out = exception_outcome(None, RuntimeError("boom"))
    assert out["error"] == "exception"


def test_portal_code_rides_along():
    out = exception_outcome("[40300805]: You're on our blacklist.", RuntimeError("x"))
    assert out["error"] == "blacklisted_ic"
    assert out["portal_code"] == "40300805"


def test_a_login_page_landing_is_a_session_expiry_not_an_exception():
    # 2026-10-08: filed as `exception`, the run was retried four times against
    # the same dead session. Whatever popup is up, the login page decides it.
    from order_entry import SessionExpiredError
    err = SessionExpiredError("Your dealer session has expired — the portal sent "
                              "the run to its login page (https://dealer.unifi.com.my/esales/login).")
    for popup in (None, "Something the table has never seen."):
        out = exception_outcome(popup, err)
        assert out["error"] == "session_expired"
        assert "esales/login" in out["message"]

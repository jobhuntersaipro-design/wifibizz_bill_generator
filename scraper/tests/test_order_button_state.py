"""Classifying why the portal will not take an order yet.

The live failure (ORD-0006, attempts 4-6, 2026-08-19): `.js-orderNow` was
present and not disabled but carried Bootstrap's `hide`, so the old
`is_enabled()` guard passed it through and the click sat 45s waiting for a
visibility that never came — then reported "the portal may be slow", which sent
the operator to retry six times against a portal that was answering correctly.

These cases are the four states that guard now has to tell apart. They are pure
dict-in/string-out, so they need no browser.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from oe_feasibility import describe_order_not_ready  # noqa: E402


def test_the_live_failure_is_reported_as_the_portal_hiding_the_button():
    """The exact DOM the log captured: present, enabled, hidden, offer chosen."""
    why = describe_order_not_ready({
        "present": True, "disabled": False, "visible": False,
        "className": "btn btn-default js-orderNow hide",
        "rows": 6, "selected": ["Unifi Home 500Mbps Premium Value With Device (36M)"],
    })
    assert "hidden" in why
    assert "Unifi Home 500Mbps Premium Value With Device (36M)" in why
    # The message that caused six retries must not come back.
    assert "slow" not in why.lower()


def test_an_unselected_offer_is_named_as_such():
    """Ours to fix, so it must not read like the portal refusing us."""
    why = describe_order_not_ready({
        "present": True, "disabled": False, "visible": False,
        "rows": 4, "selected": [],
    })
    assert "No offer row is selected" in why
    assert "4 offer" in why


def test_a_missing_button_is_not_confused_with_a_hidden_one():
    """Different diagnosis entirely — we are probably on the wrong page."""
    why = describe_order_not_ready({"present": False, "rows": 0, "selected": []})
    assert "never rendered" in why


def test_a_disabled_button_is_reported_before_visibility():
    """Disabled is a stronger, more specific statement than not-visible, and a
    disabled button can also be off-screen — so it must win."""
    why = describe_order_not_ready({
        "present": True, "disabled": True, "visible": False,
        "rows": 3, "selected": ["X"],
    })
    assert "disabled" in why


def test_a_read_failure_reports_itself_rather_than_guessing():
    """If the probe could not run, saying "the portal is hiding it" would be an
    invention — we did not look."""
    why = describe_order_not_ready({"error": "no order-entry iframe"})
    assert why == "no order-entry iframe"

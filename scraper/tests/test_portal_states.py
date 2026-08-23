"""The Select Address State combobox spells the federal territories its own way.

Live portal, 2026-08-23: the options are SABAH, SARAWAK, TERENGGANU,
**W.P. KUALA LUMPUR**, **W.P. PUTRAJAYA**, **W.P. LABUAN**. A draft stores what
the agent pasted from the portal's address line — "Wilayah Persekutuan Kuala
Lumpur" — and the old code merely uppercased it, so the option never matched and
every KL / Putrajaya / Labuan order died at the address step.

Run from the scraper/ dir:
    pytest tests/test_portal_states.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from portal_states import PORTAL_STATES, to_portal_state  # noqa: E402


def test_the_three_federal_territories_get_their_wp_prefix():
    assert to_portal_state("Kuala Lumpur") == "W.P. KUALA LUMPUR"
    assert to_portal_state("Putrajaya") == "W.P. PUTRAJAYA"
    assert to_portal_state("Labuan") == "W.P. LABUAN"


def test_the_spelling_drafts_actually_carry():
    """What the portal's own address line says, which is what agents paste."""
    assert to_portal_state("Wilayah Persekutuan Kuala Lumpur") == "W.P. KUALA LUMPUR"
    assert to_portal_state("WILAYAH PERSEKUTUAN LABUAN") == "W.P. LABUAN"
    assert to_portal_state("WP Putrajaya") == "W.P. PUTRAJAYA"
    assert to_portal_state("W.P. KUALA LUMPUR") == "W.P. KUALA LUMPUR"


def test_ordinary_states_are_just_uppercased():
    assert to_portal_state("Selangor") == "SELANGOR"
    assert to_portal_state("negeri sembilan") == "NEGERI SEMBILAN"
    assert to_portal_state("PULAU PINANG") == "PULAU PINANG"


def test_common_aliases():
    assert to_portal_state("Penang") == "PULAU PINANG"
    assert to_portal_state("Malacca") == "MELAKA"
    assert to_portal_state("Negri Sembilan") == "NEGERI SEMBILAN"


def test_every_output_is_a_real_combobox_option():
    """The whole point: what comes out must be selectable in the portal."""
    for value in ("Kuala Lumpur", "Wilayah Persekutuan Putrajaya", "Penang",
                  "Selangor", "W.P. LABUAN", "johor"):
        assert to_portal_state(value) in PORTAL_STATES


def test_an_unknown_state_is_not_rewritten_into_a_different_one():
    """It must fail at the combobox, naming the value — never be guessed into
    a state the customer does not live in."""
    assert to_portal_state("Atlantis") == "ATLANTIS"
    assert to_portal_state("") == ""
    assert to_portal_state(None) == ""

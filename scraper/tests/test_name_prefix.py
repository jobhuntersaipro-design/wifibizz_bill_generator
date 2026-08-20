"""Advanced Query matches Customer Name as a PREFIX — so a draft whose name
diverges after the first word is still findable by its leading token.

Probed live 2026-08-20 against IC 820505034434, registered as "HONG LIONG TONG":

    "HONG TUNG TUNG" (the draft)  -> 0 rows + "Customer record does not exist"
    "HONG"                        -> 4 rows
    "H"                           -> 0 rows   (below the minimum length)
    "%"                           -> 0 rows   (no wildcard support)

That is what ORD-0010 kept failing on: the search matched IC AND name, the CRM
held a different name, and the two screens disagreed forever. The IC is a
mandatory exact criterion, so a shorter name can never pull in a stranger.

Run from the scraper/ dir:
    pytest tests/test_name_prefix.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import name_prefix  # noqa: E402


def test_the_live_case():
    # The exact retry that finds HONG LIONG TONG.
    assert name_prefix("HONG TUNG TUNG") == "HONG"


def test_single_token_has_nothing_new_to_try():
    # The first token IS the whole name — retrying it repeats the search that
    # already failed, so there is no second attempt to make.
    assert name_prefix("MADONNA") is None


def test_short_first_token_is_refused():
    # "H" returned nothing live: below the portal's minimum, a prefix search is
    # a wasted round trip, not a wider net.
    assert name_prefix("H TUNG TUNG") is None
    assert name_prefix("LI WEI CHONG") is None  # "LI" is 2 chars


def test_extra_whitespace_does_not_change_the_token():
    assert name_prefix("  HONG   TUNG  TUNG ") == "HONG"


def test_empty_and_none():
    assert name_prefix("") is None
    assert name_prefix(None) is None


def test_three_letter_token_is_allowed():
    assert name_prefix("LEE CHONG WEI") == "LEE"

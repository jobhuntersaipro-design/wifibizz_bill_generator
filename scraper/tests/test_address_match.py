"""select_address grid matching — whitespace runs must not break the match.

Live incident 2026-09-03 (order cmtky82by000604l76cdw59aq): the By-keyword
search returned exactly the right unit, but its concatAddress title carried a
DOUBLE space where a blank segment sits ("TAIB -  KAMPUNG") while the stored
street — pasted from rendered HTML, which collapses whitespace runs — carried
one ("TAIB - KAMPUNG"). The old exact-equality comparison refused the row and
the run died `address_not_matched` four times.

The titles below are the REAL row read back from the live portal grid by a
droplet probe, byte-for-byte.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from oe_feasibility import _norm_addr, match_address_row  # noqa: E402

# The live grid row: 9 td titles; the 99-char one is the concatAddress with
# the portal's double space after the blank-segment hyphen.
LIVE_TITLES = [
    "SELANGOR",
    "PULAU INDAH",
    "TAN SRI MUHAMAD TAIB",
    "KAMPUNG SUNGAI PINANG",
    "Landed",
    "LOT 5558-A1 JALAN TAN SRI MUHAMAD TAIB -  KAMPUNG SUNGAI PINANG "
    "PULAU INDAH SELANGOR MALAYSIA 42920",
    "Residential",
    "FTTH",
    "28059227",
]

# The stored street, exactly as production held it: single spaces throughout.
STORED = ("LOT 5558-A1 JALAN TAN SRI MUHAMAD TAIB - KAMPUNG SUNGAI PINANG "
          "PULAU INDAH SELANGOR MALAYSIA 42920")


def test_live_double_space_row_matches_stored_single_space():
    """The reported failure: the portal's double space must compare equal."""
    assert match_address_row([LIVE_TITLES], _norm_addr(STORED)) == 0


def test_old_exact_equality_provably_misses_the_live_row():
    """Control: the pre-fix comparison genuinely cannot match this row."""
    want = STORED.strip().upper()
    assert not any(t.strip().upper() == want and len(t) > 20
                   for t in LIVE_TITLES)


def test_identical_title_still_matches():
    titles = [t if "5558" not in t else STORED for t in LIVE_TITLES]
    assert match_address_row([titles], _norm_addr(STORED)) == 0


def test_wrong_unit_does_not_match():
    other = [t.replace("5558-A1", "5559-B2") for t in LIVE_TITLES]
    assert match_address_row([other], _norm_addr(STORED)) is None


def test_right_row_found_among_wrong_ones():
    other = [t.replace("5558-A1", "5559-B2") for t in LIVE_TITLES]
    assert match_address_row([other, LIVE_TITLES], _norm_addr(STORED)) == 1


def test_short_cells_never_stand_in_for_the_address():
    # A short cell equal to a short `want` must not count as an address match.
    assert match_address_row([["SELANGOR", "FTTH"]], _norm_addr("SELANGOR")) is None


def test_norm_collapses_tabs_nbsp_and_trims():
    assert _norm_addr("  a\t b  c  ") == "A B C"
    assert _norm_addr(None) == ""

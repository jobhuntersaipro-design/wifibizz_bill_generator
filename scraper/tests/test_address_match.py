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

from oe_feasibility import (  # noqa: E402
    _norm_addr, bracketless_keyword, match_address_row, portal_search_error)

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


# ---------------------------------------------------------------------------
# Brackets (2026-09-25, order cmugj47yz00000agme8927057 and its sibling
# cmughddp8000404l0o7vod0hy). The grid returned exactly the right unit and the
# run still died address_not_matched, three times over. The title below is the
# one the failure message printed.
# ---------------------------------------------------------------------------

HERMINGTON_GRID = ("B-17-03 JALAN KUCHAI 8 17 RESIDENSI HERMINGTON (BLOK B) "
                   "TAMAN LIAN HOE KUALA LUMPUR WILAYAH PERSEKUTUAN MALAYSIA 58200")
HERMINGTON_ROWS = [["W.P. KUALA LUMPUR", "KUALA LUMPUR", HERMINGTON_GRID, "High-rise"]]


def _old_norm(value):
    """The comparison as it shipped, kept so the fix can be shown to fix it."""
    import re
    return re.sub(r"\s+", " ", value or "").strip().upper()


def test_old_rule_refuses_a_bracket_spacing_the_grid_does_not_share():
    # The control: without it, the tests below could pass on a build that never
    # had the bug.
    stored = HERMINGTON_GRID.replace("HERMINGTON (BLOK B)", "HERMINGTON(BLOK B)")
    assert _old_norm(stored) != _old_norm(HERMINGTON_GRID)


def test_the_live_row_matches_whatever_the_brackets_look_like():
    for stored in (
        HERMINGTON_GRID,                                                    # identical
        HERMINGTON_GRID.replace("(BLOK B)", "( BLOK B )"),                  # padded
        HERMINGTON_GRID.replace("HERMINGTON (BLOK B)", "HERMINGTON(BLOK B)"),  # unspaced
        HERMINGTON_GRID.replace("(BLOK B)", "BLOK B"),                      # no brackets
        HERMINGTON_GRID.replace("(BLOK B)", "\uff08BLOK B\uff09"),          # full-width
    ):
        assert match_address_row(HERMINGTON_ROWS, _norm_addr(stored)) == 0, stored


def test_a_different_block_is_still_refused():
    # Dropping brackets must never make two different units equal.
    stored = HERMINGTON_GRID.replace("(BLOK B)", "(BLOK A)")
    assert match_address_row(HERMINGTON_ROWS, _norm_addr(stored)) is None


def test_invisible_characters_do_not_decide_the_match():
    # A zero-width space or a BOM prints as nothing and survives a paste.
    for junk in ("\u200b", "\ufeff", "\u00ad"):
        stored = HERMINGTON_GRID.replace("KUCHAI", "KUC" + junk + "HAI")
        assert _old_norm(stored) != _old_norm(HERMINGTON_GRID)
        assert match_address_row(HERMINGTON_ROWS, _norm_addr(stored)) == 0


def test_brackets_become_a_space_so_words_never_fuse():
    assert "HERMINGTON BLOK B" in _norm_addr("HERMINGTON(BLOK B)")


def test_the_search_keyword_never_carries_a_bracket():
    # The portal parses the keyword as an Oracle Text query, where ( ) group;
    # a group inside a run of words is a syntax error (ORA-29902, live today).
    kw = bracketless_keyword(HERMINGTON_GRID)
    assert "(" not in kw and ")" not in kw
    assert kw == HERMINGTON_GRID.replace("(BLOK B)", "BLOK B")
    assert bracketless_keyword("HERMINGTON(BLOK B)") == "HERMINGTON BLOK B"
    assert bracketless_keyword("NO BRACKETS") == "NO BRACKETS"


def test_the_bracketless_keyword_still_finds_the_bracketed_row():
    # What the portal returns for the stripped keyword is the SAME bracketed
    # row, and the match must still take it — both halves have to agree.
    stored = HERMINGTON_GRID
    assert match_address_row(HERMINGTON_ROWS, _norm_addr(stored)) == 0


# The Warning the portal raised over the empty grid, verbatim from the screenshot.
ORACLE_WARNING = ("ORA-29902: error in executing ODCIIndexStart() routine "
                  "ORA-20000: Oracle Text error: DRG-50901: text query parser "
                  "syntax error on line 1, column 215")
SELECT_ADDRESS_MODAL = ("Customer Type Consumer Search Type By keyword By Street "
                        "By Building By Address Id State W.P. KUALA LUMPUR Keywords Query")


def test_an_oracle_refusal_is_named_not_read_as_no_address():
    said = portal_search_error([SELECT_ADDRESS_MODAL, ORACLE_WARNING])
    assert "DRG-50901" in said
    # The Select Address modal is a visible dialog too; its text is not the error.
    assert "Search Type" not in said


def test_no_oracle_code_means_nothing_to_report():
    assert portal_search_error([SELECT_ADDRESS_MODAL]) == ""
    assert portal_search_error([]) == ""
    assert portal_search_error(None) == ""


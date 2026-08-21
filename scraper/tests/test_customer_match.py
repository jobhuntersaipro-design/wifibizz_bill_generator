"""One IC is one customer: when may an existing CRM record receive this order?

No portal, no browser. This decides whether a real, chargeable order gets
attached to a customer record and billed through that customer's account, so it
is exactly the kind of rule that must be settled here rather than live — the
live version of "getting it wrong" is a stranded order on a stranger's account,
and two of those are already outstanding from precisely this bug.

Run:  scraper/venv/bin/python -m pytest tests/test_customer_match.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from customer_match import (  # noqa: E402
    describe_ic_name_mismatch,
    may_attach_existing,
    names_agree,
    normalize_name,
)


def test_the_ord_0018_regression():
    """The case this rule exists for.

    Live 2026-08-21: IC 900505065434 was registered at Unifi as WOJAK LANG from
    an earlier order on the same test IC; the draft was for ZAINUDDEEN BIN ABDUL
    BAARI. The duplicate-IC recovery picked the record by IC alone and attached
    WOJAK LANG, along with WOJAK LANG's billing account 7041941910, minting two
    real portal orders before the run fell over.
    """
    assert not names_agree("ZAINUDDEEN BIN ABDUL BAARI", "WOJAK LANG")


def test_a_shared_surname_is_not_the_same_customer():
    # The tempting loose rule — "the names overlap, close enough" — is how two
    # people in one family become one customer. Overlap is deliberately not
    # tested for.
    assert not names_agree("LEE CHONG WEI", "LEE MEI LING")
    assert not names_agree("MUHAMMAD ALI", "MUHAMMAD HASSAN")


def test_typing_differences_are_the_same_customer():
    # A record that differs only in how it was typed IS the record. Refusing
    # here would block a legitimate order over a double space.
    assert names_agree("Tuck Kee  Lee", "TUCK KEE LEE")
    assert names_agree("tuck kee lee", "Tuck Kee Lee")
    assert names_agree("LIM, AH  BENG", "LIM AH BENG")


def test_a_truncated_record_is_the_same_customer():
    # The portal stores and matches names by prefix and will hand back a
    # shortened one. A shorter view of the same name is not a different person.
    assert names_agree("HONG LIONG TONG", "HONG LIONG")
    assert names_agree("HONG LIONG", "HONG LIONG TONG")


def test_a_prefix_must_end_on_a_WHOLE_token():
    # "HONG TUNG" must not match "HONG TUNGABALINGA". Comparing joined strings
    # instead of tokens is what would let it, which is why normalize_name
    # returns a list.
    assert not names_agree("HONG TUNG", "HONG TUNGABALINGA")


def test_a_diverging_middle_is_refused():
    # ORD-0010's pair (HONG TUNG TUNG vs the registered HONG LIONG TONG). It no
    # longer reaches this gate — the name-prefix retry attaches it one step
    # earlier, since the portal's own prefix search on "HONG" finds it — but if
    # it ever does arrive here, two names that disagree mid-way are a question
    # for the agent, not something to decide silently.
    assert not names_agree("HONG TUNG TUNG", "HONG LIONG TONG")


def test_an_unreadable_registered_name_refuses():
    # False, not True. This function gates a chargeable order: "we could not
    # read who this record belongs to" is a reason to stop, never a reason to
    # proceed. _read_pii_registered_name is best-effort and DOES return None.
    assert not names_agree("ZAINUDDEEN BIN ABDUL BAARI", None)
    assert not names_agree("ZAINUDDEEN BIN ABDUL BAARI", "")
    assert not names_agree("ZAINUDDEEN BIN ABDUL BAARI", "   ")
    assert not names_agree(None, "WOJAK LANG")


def test_normalize_name_drops_punctuation_and_blanks():
    assert normalize_name("  LIM,  AH-BENG ") == ["LIM", "AH", "BENG"]
    assert normalize_name(None) == []
    assert normalize_name("///") == []


def test_the_refusal_names_both_names_and_the_ic():
    # The agent has to make one of exactly two edits and is the only one who
    # knows which. A message that says only "customer mismatch" sends them to
    # the portal to look up what we already have in hand.
    msg = describe_ic_name_mismatch(
        "900505065434", "ZAINUDDEEN BIN ABDUL BAARI", "WOJAK LANG")
    assert "900505065434" in msg
    assert "ZAINUDDEEN BIN ABDUL BAARI" in msg
    assert "WOJAK LANG" in msg
    # And it must send them to void the part-made order. The order NUMBER is
    # minted two steps before this check can run, so refusing here always leaves
    # something behind at Unifi; a refusal that reads as "nothing happened" is
    # how that becomes a stranded order nobody looks for.
    assert "oid" in msg  # "Void"
    assert "stopped" in msg


def test_the_refusal_says_so_when_the_name_could_not_be_read():
    # Must not render "registered at Unifi as None" — that reads as a customer
    # literally named None and sends the agent looking for one.
    msg = describe_ic_name_mismatch("900505065434", "ZAINUDDEEN", None)
    assert "None" not in msg
    assert "could not be read" in msg


# ── The gate itself, against the three shapes _create_customer_via_dialog returns ──


def test_a_customer_we_created_ourselves_needs_no_check():
    # The ordinary new-customer path. It is registered under exactly the name we
    # typed, so there is nothing to disagree with — and refusing here would
    # block every genuinely new customer, which is most of them.
    assert may_attach_existing(
        {"status": "ok", "created": True}, "ZAINUDDEEN BIN ABDUL BAARI")


def test_an_existing_record_with_a_matching_name_may_be_attached():
    assert may_attach_existing(
        {"status": "ok", "created": False, "registered_name": "TUCK KEE LEE"},
        "Tuck Kee Lee")


def test_an_existing_record_with_a_different_name_is_refused():
    assert not may_attach_existing(
        {"status": "ok", "created": False, "registered_name": "WOJAK LANG"},
        "ZAINUDDEEN BIN ABDUL BAARI")


def test_a_duplicate_ic_whose_owner_could_not_be_read_is_refused():
    # The picker failed. The IC IS taken (that is why this path ran at all), so
    # the old fall-through — re-search on the draft name, find nothing, report
    # "customer not found" — was both wrong and a dead end. Refuse and say the
    # record exists.
    assert not may_attach_existing(
        {"status": "ok", "created": False}, "ZAINUDDEEN BIN ABDUL BAARI")
    assert not may_attach_existing(
        {"status": "ok", "created": False, "registered_name": None}, "ZAINUDDEEN")


def test_created_must_be_exactly_True_to_skip_the_check():
    # `created` is absent on the picker-failed shape, and a truthy-ish reading of
    # a missing key is how a refusal turns back into a silent attach.
    assert not may_attach_existing({"status": "ok"}, "ZAINUDDEEN")

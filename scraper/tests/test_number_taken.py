"""The portal refusing a voice number as "taken by another order".

Seen live 2026-08-21 on ORD-0018 / order 2608000121894804, as an Error dialog
raised a beat AFTER the number picker's OK:

    [40330227]: The number is taken by another order, please choose another
    number.

Nothing looked for it, so `_pick_voice_number` reported the number as chosen,
the dialog stayed up, and the TV tab's first click died 6s later on
`<div class="modal-backdrop in">` — a Playwright timeout that named neither the
tab nor the portal's complaint. The order was already minted, so it stranded.

Two pure pieces carry the retry, and both are tested here:
  * `is_number_taken`  — decides whether to re-pick at all. A false positive
    burns a number over an unrelated warning; a false negative is the stranding
    above.
  * `next_number_card` — decides WHICH number. The pool re-queries in the same
    order every time, so picking by a fixed index would re-offer the number the
    portal just refused and spend the whole budget on one number.

Run from the scraper/ dir:
    pytest tests/test_number_taken.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_errors import VOICE_NUMBER_TAKEN, map_error, portal_code  # noqa: E402
from oe_feasibility import (  # noqa: E402
    VOICE_NUMBER_ATTEMPTS,
    is_login_taken,
    is_number_taken,
    next_number_card,
)

LIVE = ("[40330227]: The number is taken by another order, please choose "
        "another number.")


# ── recognising the rejection ───────────────────────────────────────────────
def test_the_live_message():
    assert is_number_taken(LIVE)


def test_wording_variants():
    assert is_number_taken("The number is taken by another order.")
    assert is_number_taken("Please choose another number.")
    assert is_number_taken("the NUMBER IS TAKEN")  # case insensitive


def test_unrelated_warnings_never_trigger_a_re_pick():
    for msg in (
        "Please select one offer in the Smart Device group.",
        "The data is incomplete.",
        "Some errors exist in this page. Please check and input again.",
        "no available slots found in the calendar",
        "[40300338]: Sorry, the SAMSUNG TV 55\" is currently out of stock.",
        "",
        None,
    ):
        assert not is_number_taken(msg), msg


def test_a_login_collision_is_not_a_number_collision():
    """The two rejections have their own retries — crossing them would re-roll a
    username in answer to a taken phone number, and vice versa."""
    login = ("[40330205]: Operate resource error, RESERVELOGIN error. [1]:LOGIN_ID "
             "[tklee812@iptv] provided in input is already in use by other customer")
    assert is_login_taken(login) and not is_number_taken(login)
    assert is_number_taken(LIVE) and not is_login_taken(LIVE)


# ── the error code BizzFlow branches on ─────────────────────────────────────
def test_mapped_to_its_own_code():
    assert map_error(LIVE) == VOICE_NUMBER_TAKEN
    assert portal_code(LIVE) == "40330227"


def test_the_login_rules_below_it_still_win_their_own_messages():
    assert map_error("This username is already taken.") == "login_id_taken"
    assert map_error("LOGIN_ID already in use") == "login_id_taken"


# ── choosing the next number ────────────────────────────────────────────────
def test_first_card_when_nothing_has_been_tried():
    assert next_number_card(["0312345678", "0312345679"], set()) == 0


def test_skips_every_number_the_portal_already_refused():
    numbers = ["0312345678", "0312345679", "0312345680"]
    assert next_number_card(numbers, {"0312345678"}) == 1
    assert next_number_card(numbers, {"0312345678", "0312345679"}) == 2


def test_none_when_the_whole_grid_is_burned():
    numbers = ["0312345678", "0312345679"]
    assert next_number_card(numbers, set(numbers)) is None
    assert next_number_card([], set()) is None


def test_a_card_with_no_readable_number_is_still_offered_once():
    """An unreadable label is not evidence the number is bad, but it must not be
    offered forever either — the caller records it positionally."""
    assert next_number_card(["", "0312345679"], set()) == 0
    assert next_number_card(["", "0312345679"], {"#0"}) == 1
    assert next_number_card(["", ""], {"#0", "#1"}) is None


def test_the_retry_budget_is_the_agreed_one():
    assert VOICE_NUMBER_ATTEMPTS == 10


def test_exhaustion_reports_the_code_bizzflow_has_copy_for():
    """`submitErrorCopy` looks the result's `error` up verbatim, so the exhausted
    budget must report the oe_errors code and not a step-local name."""
    import oe_feasibility
    import inspect

    src = inspect.getsource(oe_feasibility._pick_voice_number)
    assert '"error": VOICE_NUMBER_TAKEN' in src
    assert VOICE_NUMBER_TAKEN == "voice_number_taken"

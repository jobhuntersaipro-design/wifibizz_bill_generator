"""The appointment slot-taken race (portal 40301147), without a portal.

Live incident (order 2608000122520811, 2026-08-26): the slot booked at the
appointment step was taken by another order before the pay-tail Next, the
portal cleared the field and blocked the Next with
  "Please input the appointment date."
while the actual cause sat in a separate Error dialog:
  "[40301147]: Technical Error - Slot has been taken. Kindly refresh the page"

Two pieces make the retry safe and are pinned here:
  is_slot_taken()  - recognises the race in BOTH the dialog wording and the
                     page-state dump line, and in nothing else.
  choose_slot(exclude=) - drops already-taken slots BEFORE the policy runs,
                     because the calendar can serve stale availability and
                     re-offering the collided slot would loop forever.
"""
import pathlib
import sys
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from appointment_policy import choose_slot  # noqa: E402
from oe_errors import (  # noqa: E402
    APPOINTMENT_SLOT_TAKEN,
    LOGIN_ID_TAKEN,
    VOICE_NUMBER_TAKEN,
    is_slot_taken,
    map_error,
)

# The two strings the live incident actually produced.
DIALOG_MSG = ("[40301147]: Technical Error - Slot has been taken. "
              "Kindly refresh the page")
STATE_DUMP_LINE = ("Error :: [40301147]: Technical Error - Slot has been taken. "
                   "Kindly refresh the page")

NOW = datetime(2026, 8, 26, 9, 0, 0)
DAY30 = [f"2026-08-30 {t}:00" for t in ("09:30", "12:00", "14:30", "17:00")]
DAY31 = [f"2026-08-31 {t}:00" for t in ("09:30", "12:00", "14:30", "17:00")]
SLOTS = DAY30 + DAY31
POLICY = {"strategy": "first_available", "lead_hours": 12}


def test_is_slot_taken_on_the_real_dialog():
    assert is_slot_taken(DIALOG_MSG)


def test_is_slot_taken_on_the_state_dump_line():
    # Detection reads _attachment_page_state()'s "Title :: message" strings.
    assert is_slot_taken(STATE_DUMP_LINE)


def test_is_slot_taken_by_code_alone():
    # The portal code is the stable half; wording can drift.
    assert is_slot_taken("[40301147]: something reworded entirely")


def test_consequence_message_is_not_the_race():
    # The blocked Next's own message is the consequence, not the cause.
    assert not is_slot_taken("Please input the appointment date.")
    assert not is_slot_taken(None)
    assert not is_slot_taken("")


def test_slot_taken_does_not_misfile_as_login_or_voice():
    assert map_error(DIALOG_MSG) == APPOINTMENT_SLOT_TAKEN
    # The pre-existing "taken" rules keep their meanings.
    assert map_error("LOGIN_ID already taken") == LOGIN_ID_TAKEN
    assert map_error("The number is taken by another order, "
                     "please choose another number.") == VOICE_NUMBER_TAKEN


def test_exclude_skips_the_taken_slot():
    r = choose_slot(SLOTS, POLICY, NOW, exclude={DAY30[0]})
    assert r["slot"] == DAY30[1]
    assert DAY30[0] not in r["candidates"]


def test_exclude_accumulates_across_rebooks():
    r = choose_slot(SLOTS, POLICY, NOW, exclude={DAY30[0], DAY30[1]})
    assert r["slot"] == DAY30[2]


def test_all_slots_taken_says_so():
    r = choose_slot(SLOTS, POLICY, NOW, exclude=set(SLOTS))
    assert r["error"] == "no_slots"
    assert "taken" in r["message"]


def test_no_exclude_is_unchanged():
    assert choose_slot(SLOTS, POLICY, NOW)["slot"] == DAY30[0]


def test_fixed_date_never_leaves_its_day():
    # Every slot on the pinned day taken -> fail, never book another day.
    pol = {"strategy": "fixed_date", "fixed_date": "2026-08-30"}
    r = choose_slot(SLOTS, pol, NOW, exclude=set(DAY30))
    assert r["error"] == "no_slots_on_date"

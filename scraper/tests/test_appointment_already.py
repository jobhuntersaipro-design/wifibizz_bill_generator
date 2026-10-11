""""You have an appointment already." is a claim, checked against the table.

Live 2026-10-08: the pay tail met [40301147] "Slot has been taken" and went to
rebook. The edit control on the existing row was not found, so the run pressed
"+ Add", the portal answered "You have an appointment already.", and the step
returned `skipped` — taken at its word, as if the rebook had happened. The run
failed with "You have an appointment already.. Slots already taken:
['2026-10-08 17:00:00']", and was run twice more, each time minting an order.

Run from the scraper/ dir:
    pytest tests/test_appointment_already.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_errors import APPOINTMENT_NOT_BOOKED, APPOINTMENT_SLOT_TAKEN  # noqa: E402
from oe_feasibility import already_booked_outcome, appointment_row_slot  # noqa: E402

WARN = "You have an appointment already."
# What _APPOINTMENT_ROW_JS reads off a booked row (cells joined by a space).
ROW = "AP2610000042 2026-10-08 17:00:00 19:00:00 Edit"
BOOKED = {"status": "ok", "rows": 1, "row": ROW}
EMPTY = {"status": "norow"}
UNREADABLE = {"status": "noheader"}


def test_the_row_slot_is_read_in_the_calendars_own_format():
    assert appointment_row_slot(ROW) == "2026-10-08 17:00:00"
    assert appointment_row_slot("AP1 2026-08-29 13:30 16:00") == "2026-08-29 13:30:00"
    assert appointment_row_slot("AP1 no date here") is None
    assert appointment_row_slot(None) is None


def test_a_rebook_that_cannot_change_the_slot_stops_and_says_so():
    # THE live bug: this used to be `skipped`.
    out = already_booked_outcome(WARN, BOOKED, rebooking=True)
    assert out["status"] == "error"
    assert out["error"] == APPOINTMENT_SLOT_TAKEN
    assert "2026-10-08 17:00:00" in out["message"]
    assert "Install Information" in out["message"]


def test_a_rebook_with_an_empty_table_is_not_booked():
    out = already_booked_outcome(WARN, EMPTY, rebooking=True)
    assert out["status"] == "error"
    assert out["error"] == APPOINTMENT_NOT_BOOKED


def test_a_rebook_never_reads_as_done_even_when_the_table_is_unreadable():
    out = already_booked_outcome(WARN, UNREADABLE, rebooking=True)
    assert out["status"] == "error"


def test_a_first_booking_with_a_row_is_booked_and_names_its_slot():
    out = already_booked_outcome(WARN, BOOKED, rebooking=False)
    assert out["status"] == "ok"
    assert out["slot"] == "2026-10-08 17:00:00"


def test_a_first_booking_with_an_empty_table_is_not_booked():
    # The portal's claim and its own table disagree; Pay would refuse later
    # with a sentence that names neither.
    out = already_booked_outcome(WARN, EMPTY, rebooking=False)
    assert out["status"] == "error"
    assert out["error"] == APPOINTMENT_NOT_BOOKED


def test_a_first_booking_that_cannot_be_read_is_accepted_unverified():
    # "Could not tell" is not "absent" — the same rule the OK path applies.
    out = already_booked_outcome(WARN, UNREADABLE, rebooking=False)
    assert out["status"] == "skipped"
    assert "unverified" in out["note"]

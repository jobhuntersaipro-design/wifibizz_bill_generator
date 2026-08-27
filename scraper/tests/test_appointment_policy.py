"""Slot selection and failure reporting, against fixed slot lists.

No portal, no browser. The appointment step mints a real order BEFORE it runs,
so anything decided here that can only be checked live costs a stranded order to
check — two are outstanding from exactly that loop.

Run:  scraper/venv/bin/python tests/test_appointment_policy.py
"""
import pathlib
import sys
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from appointment_policy import (  # noqa: E402
    choose_slot,
    describe_read_failure,
    normalize_policy,
)

NOW = datetime(2026, 8, 17, 9, 0, 0)

# Two days, four slots each — the shape the live calendar actually offers.
DAY30 = [f"2026-08-30 {t}:00" for t in ("09:30", "12:00", "14:30", "17:00")]
DAY31 = [f"2026-08-31 {t}:00" for t in ("09:30", "12:00", "14:30", "17:00")]
SLOTS = DAY30 + DAY31

failures = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def main() -> int:
    print("\nchoose_slot — first_available")
    r = choose_slot(SLOTS, {"strategy": "first_available", "lead_hours": 12}, NOW)
    check("takes the earliest slot past the lead time", r.get("slot") == DAY30[0], str(r))

    # A slot 2h out with a 12h lead must be skipped, and the NEXT one taken —
    # not reported as "nothing available".
    soon = ["2026-08-17 11:00:00"] + SLOTS
    r = choose_slot(soon, {"strategy": "first_available", "lead_hours": 12}, NOW)
    check("skips a slot inside the lead time", r.get("slot") == DAY30[0], str(r))

    r = choose_slot(soon, {"strategy": "first_available", "lead_hours": 1}, NOW)
    check("a shorter lead time lets the earlier slot through",
          r.get("slot") == "2026-08-17 11:00:00", str(r))

    r = choose_slot(["2026-08-17 11:00:00"],
                    {"strategy": "first_available", "lead_hours": 12}, NOW)
    check("everything inside the lead time is its own named failure",
          r.get("error") == "all_before_lead" and "12-hour" in r.get("message", ""),
          str(r))

    print("\nchoose_slot — fixed_date")
    r = choose_slot(SLOTS, {"strategy": "fixed_date", "fixed_date": "2026-08-31"}, NOW)
    check("books the EARLIEST slot on the named day", r.get("slot") == "2026-08-31 09:30:00",
          str(r))
    check("candidates stay inside the named day",
          all(s.startswith("2026-08-31") for s in r.get("candidates", [])),
          str(r.get("candidates")))

    r = choose_slot(SLOTS, {"strategy": "fixed_date", "fixed_date": "2026-08-29"}, NOW)
    check("a day with no slots FAILS and names the date",
          r.get("error") == "no_slots_on_date" and "2026-08-29" in r.get("message", ""),
          str(r))
    check("…and books nothing else", "slot" not in r, str(r))

    # The lead time is a floor under first_available only. A fixed date is an
    # explicit override, so a same-day booking must not be vetoed by it.
    r = choose_slot(["2026-08-17 11:00:00"],
                    {"strategy": "fixed_date", "fixed_date": "2026-08-17",
                     "lead_hours": 12}, NOW)
    check("a fixed date overrides the lead time", r.get("slot") == "2026-08-17 11:00:00", str(r))

    print("\nchoose_slot — degenerate input")
    check("no slots at all", choose_slot([], None, NOW).get("error") == "no_slots")
    check("unparseable slots are not slots",
          choose_slot(["tomorrow-ish"], None, NOW).get("error") == "no_slots")

    print("\nnormalize_policy")
    check("defaults when absent", normalize_policy(None) ==
          {"strategy": "first_available", "lead_hours": 12, "fixed_date": None})
    check("unknown strategy falls back", normalize_policy(
        {"strategy": "whenever"})["strategy"] == "first_available")
    check("a non-numeric lead time falls back", normalize_policy(
        {"lead_hours": "soon"})["lead_hours"] == 12)
    check("fixed_date with no date is not a fixed date", normalize_policy(
        {"strategy": "fixed_date"})["strategy"] == "first_available")
    check("an ISO datetime is trimmed to its date", normalize_policy(
        {"strategy": "fixed_date", "fixed_date": "2026-08-31T00:00:00Z"}
    )["fixed_date"] == "2026-08-31")

    print("\ndescribe_read_failure — each cause gets its own sentence")
    msgs = {
        "no dialog": describe_read_failure({"dialog": False}),
        "no day cells": describe_read_failure({"dialog": True, "dayCells": 0}),
        "no events": describe_read_failure({"dialog": True, "dayCells": 42, "events": 0}),
        "unmapped": describe_read_failure({"dialog": True, "dayCells": 42, "events": 96,
                                           "unmatched": 96, "matchedBy": "geometry"}),
    }
    check("dialog never opened", "did not open" in msgs["no dialog"], msgs["no dialog"])
    check("day cells not found", "day cells not found" in msgs["no day cells"],
          msgs["no day cells"])
    check("genuinely empty calendar", "offered no slots" in msgs["no events"],
          msgs["no events"])
    check("events that mapped to no date say so, with counts",
          "could not map" in msgs["unmapped"] and "96" in msgs["unmapped"],
          msgs["unmapped"])
    check("all four messages differ", len(set(msgs.values())) == 4)

    # "No slots" is a claim about the portal; how long we watched is what makes
    # it credible rather than a claim about our own patience.
    waited = describe_read_failure({"dialog": True, "dayCells": 42, "events": 0,
                                    "waitedMs": 25000})
    check("the message says how long the calendar was watched",
          "watched 25s" in waited, waited)

    print(f"\n{len(failures)} failed" if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())


# ── the lead time is measured on the PORTAL's clock ─────────────────────────
# Live 2026-08-27: the droplet container has no TZ, so datetime.now() is UTC,
# while the calendar's slot strings are Malaysia time. choose_slot() defaulted
# `now` to the container clock, so a 12-hour lead was really a 4-hour one.
from datetime import datetime, timedelta, timezone  # noqa: E402

from appointment_policy import choose_slot, portal_now  # noqa: E402


def test_portal_now_is_malaysia_time_not_the_container_clock():
    utc = datetime.now(timezone.utc).replace(tzinfo=None)
    assert abs((portal_now() - utc) - timedelta(hours=8)) < timedelta(seconds=5)


def test_choose_slot_reports_the_now_and_cutoff_it_applied():
    now = datetime(2026, 8, 27, 12, 40)
    picked = choose_slot(["2026-08-27 17:00:00", "2026-08-28 09:30:00"],
                         {"strategy": "first_available", "lead_hours": 12}, now=now)
    assert picked["slot"] == "2026-08-28 09:30:00"
    assert picked["now"] == "2026-08-27 12:40:00"
    assert picked["cutoff"] == "2026-08-28 00:40:00"

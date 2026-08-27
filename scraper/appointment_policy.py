"""appointment_policy.py — which calendar slot to book, and why none was booked.

Pure functions, no I/O and no Playwright, so the decisions can be tested against
fixed slot lists instead of against a live portal. That matters here more than
usual: the appointment step mints a real order BEFORE it runs, so every wrong
guess exercised against production strands an order that has to be voided by
hand.

Two jobs:

  choose_slot()          - apply the admin's booking policy to the slots the
                           calendar offered.
  describe_read_failure() - turn the reader's diagnostic object into a message
                           that names WHICH thing went wrong.

The second exists because the previous code collapsed five different situations
into one sentence ("no available slots found in the calendar"), which is how a
selector that had stopped matching went on looking like an empty calendar.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

FIRST_AVAILABLE = "first_available"
FIXED_DATE = "fixed_date"

DEFAULT_STRATEGY = FIRST_AVAILABLE
DEFAULT_LEAD_HOURS = 12

# The calendar's slot strings are Malaysia wall-clock time, so the lead-time
# cutoff must be measured on that clock — NOT the host's. The droplet container
# runs with no TZ (UTC), which silently turned a 12-hour lead into a 4-hour one.
PORTAL_TZ = ZoneInfo("Asia/Kuala_Lumpur")


def portal_now() -> datetime:
    """Naive Malaysia-time 'now', comparable with the portal's slot strings."""
    return datetime.now(PORTAL_TZ).replace(tzinfo=None)


def normalize_policy(raw) -> dict:
    """Coerce whatever the payload carries into a usable policy.

    Defaults on every field: a submit must never fail because the settings row
    was missing, malformed, or from an older BizzFlow build. The worst case is
    the behaviour that shipped before this existed.
    """
    raw = raw if isinstance(raw, dict) else {}
    strategy = str(raw.get("strategy") or DEFAULT_STRATEGY).strip().lower()
    if strategy not in (FIRST_AVAILABLE, FIXED_DATE):
        strategy = DEFAULT_STRATEGY
    try:
        lead_hours = int(raw.get("lead_hours", DEFAULT_LEAD_HOURS))
    except (TypeError, ValueError):
        lead_hours = DEFAULT_LEAD_HOURS
    if lead_hours < 0:
        lead_hours = 0
    fixed_date = raw.get("fixed_date") or None
    if fixed_date:
        fixed_date = str(fixed_date).strip()[:10]  # tolerate an ISO datetime
    # A fixed_date strategy with no date is not a fixed date; fall back rather
    # than fail every submit on a half-saved setting.
    if strategy == FIXED_DATE and not fixed_date:
        strategy = FIRST_AVAILABLE
    return {"strategy": strategy, "lead_hours": lead_hours, "fixed_date": fixed_date}


def _parse(slot: str):
    """'YYYY-MM-DD HH:MM:SS' -> datetime, or None if it isn't one."""
    try:
        return datetime.strptime(slot.strip()[:19], "%Y-%m-%d %H:%M:%S")
    except (ValueError, AttributeError):
        return None


def choose_slot(slots, policy=None, now=None, exclude=None) -> dict:
    """Pick the slot to book.

    Returns either {"slot": "YYYY-MM-DD HH:MM:SS", "candidates": [...]} or
    {"error": <code>, "message": <human sentence>}.

    `candidates` are the remaining acceptable slots in order, so the caller can
    fall through to the next one when the portal rejects the first — without
    ever falling outside the policy.

    `exclude` holds slots another order has already taken (portal error
    40301147). They are dropped BEFORE the policy runs, because the calendar
    can serve stale availability — "kindly refresh the page" — and re-offering
    the very slot that just collided would loop the retry forever.

    Within a permitted day the EARLIEST slot always wins, which is what makes
    `fixed_date` = 31 Aug book 09:30-12:00 rather than an arbitrary one of that
    day's four.
    """
    pol = normalize_policy(policy)
    now = now or portal_now()
    excluded = {str(s).strip() for s in (exclude or [])}

    parsed = sorted(
        (dt, s) for s in (slots or [])
        if s not in excluded and (dt := _parse(s)) is not None
    )
    if not parsed:
        if excluded and any(_parse(s) for s in (slots or [])):
            return {"error": "no_slots",
                    "message": ("every slot the portal offered has already been "
                                "taken by another order")}
        return {"error": "no_slots", "message": "the portal offered no slots"}

    if pol["strategy"] == FIXED_DATE:
        want = pol["fixed_date"]
        on_day = [s for dt, s in parsed if s.startswith(want)]
        if not on_day:
            # Deliberately NOT "book the nearest other day". A fixed date is an
            # instruction; quietly substituting a different one is worse than
            # stopping, because nobody finds out until the installer doesn't
            # turn up.
            offered = ", ".join(sorted({s[:10] for _, s in parsed})[:5])
            return {"error": "no_slots_on_date",
                    "message": f"no slots on {want} (the portal offered {offered})"}
        return {"slot": on_day[0], "candidates": on_day}

    cutoff = now + timedelta(hours=pol["lead_hours"])
    fmt = "%Y-%m-%d %H:%M:%S"
    ok = [s for dt, s in parsed if dt > cutoff]
    if not ok:
        return {"error": "all_before_lead",
                "message": (f"the earliest slot is {parsed[0][1]}, inside the "
                            f"{pol['lead_hours']}-hour lead time (now {now:{fmt}}, "
                            f"cutoff {cutoff:{fmt}})"),
                "now": f"{now:{fmt}}", "cutoff": f"{cutoff:{fmt}}"}
    # `now`/`cutoff` are reported so the run log PROVES which lead time was
    # applied, on which clock.
    return {"slot": ok[0], "candidates": ok,
            "now": f"{now:{fmt}}", "cutoff": f"{cutoff:{fmt}}"}


def describe_read_failure(diag) -> str:
    """Name WHICH of the calendar-reading failures happened.

    The five causes were previously one message. Telling them apart is the
    difference between a five-minute selector fix and another round of
    production submits.
    """
    diag = diag if isinstance(diag, dict) else {}
    # How long the reader watched before giving up. Without it, "no slots" reads
    # as a fact about the portal when it may be a fact about our patience.
    waited = diag.get("waitedMs")
    took = f" (watched {round(waited / 1000)}s)" if waited else ""
    if diag.get("error") == "nodoc" or not diag.get("dialog"):
        return f"the appointment dialog did not open{took}"
    if not diag.get("dayCells"):
        return ("could not read the calendar (day cells not found; tried "
                f".fc-daygrid-day, .fc-day, td[data-date]){took}")
    if not diag.get("events"):
        return f"the portal offered no slots{took}"
    # Days and events both present, yet nothing came back with a date.
    return (f"found {diag.get('events')} slots across {diag.get('dayCells')} day "
            f"cells but could not map them to dates "
            f"({diag.get('unmatched')} unmatched, matcher={diag.get('matchedBy')})")

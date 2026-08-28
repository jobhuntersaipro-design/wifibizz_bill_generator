"""
oe_errors.py - Error codes + message mapping for the Unifi eSales order flow.

Every expected flow failure (MSR, address-taken, validation) surfaces as a
jQuery UI dialog (`.ui-dialog.modal-danger`) with a human-readable message in
`.modal-message`. `map_error()` turns that message into a stable code BizzFlow
can branch on. Unmapped messages return `UNKNOWN_ERROR` so the caller can log
the verbatim text and we can add the mapping later.
"""
import re

# ── Stable error codes (the contract with BizzFlow) ──
ADDRESS_ALREADY_HAS_SERVICE = "address_already_has_service"
ADDRESS_NOT_FOUND = "address_not_found"
# The address exists and is known to the portal, but TM does not serve it — only
# other operators do. The near-opposite of ADDRESS_ALREADY_HAS_SERVICE, and not
# something a retry or a different package can fix: no Unifi order can be placed
# here at all. Observed verbatim (ORD-0006, 2026-08-19):
#   "This address only offers services from other operators and does not have
#    any services provided by TM."
ADDRESS_NO_TM_SERVICE = "address_no_tm_service"
MSR_CUSTOMER_ID_LIMIT = "msr_customer_id_limit"
MSR_OFFLINE_APPROVAL = "msr_offline_approval"
LOGIN_ID_INVALID = "login_id_invalid"
LOGIN_ID_TAKEN = "login_id_taken"
VOBB_UNAVAILABLE = "vobb_unavailable"
# Every voice number the run offered was already reserved by another order:
#   [40330227]: The number is taken by another order, please choose another number.
# Distinct from VOBB_UNAVAILABLE (an empty pool) — here the portal HAS numbers,
# they are just spoken for, so the advice is "run it again", not "the pool is
# dry". Only reported after the whole retry budget is spent; a single collision
# is handled in the flow and never reaches BizzFlow.
VOICE_NUMBER_TAKEN = "voice_number_taken"
DEVICE_OUT_OF_STOCK = "device_out_of_stock"
# The booked appointment slot was taken by another order between booking and the
# pay-tail Next, where the portal re-validates it:
#   [40301147]: Technical Error - Slot has been taken. Kindly refresh the page
# The portal clears the appointment field ("Please input the appointment date.")
# and blocks the Next. Handled in the flow by rebooking the next slot the admin
# policy accepts; only reported after the rebook budget is spent, so reaching
# BizzFlow means the calendar was contended, not that anything is wrong.
APPOINTMENT_SLOT_TAKEN = "appointment_slot_taken"
# The order reached the pay tail with NO appointment on it. Our own check, like
# ERF_NOT_DOWNLOADED — the portal only ever says the consequence ("Please input
# the appointment date."), which names neither the step that failed nor why.
# Live 2026-08-28 (order 2608000122824032): the Appointment dialog closed, no row
# was ever created, the step reported ok, and this was the first thing to notice
# four steps later.
APPOINTMENT_NOT_BOOKED = "appointment_not_booked"
# An order is not finished until its registration form is in hand. This is the
# only code here NOT matched from portal wording — the portal never says it. It
# is our own completeness check: a submit that produced no e-RF is incomplete,
# whether it stopped at the Pay gate or paid and then failed to fetch the form.
ERF_NOT_DOWNLOADED = "erf_not_downloaded"
# The ID number is already registered at Unifi under a DIFFERENT name. Like
# ERF_NOT_DOWNLOADED this is our own check, not portal wording — the portal is
# perfectly happy to hand its record for that IC to the order and bill it. One
# IC is one customer, so a name that disagrees means the draft and the CRM
# describe two different people, and only a human can say which is wrong.
# See customer_match.py for what happened while this went ungated.
CUSTOMER_IC_NAME_MISMATCH = "customer_ic_name_mismatch"
UNKNOWN_ERROR = "unknown_error"

# ── Substring → code rules (matched against .modal-message, case-insensitive) ──
# Order matters: first match wins, so put more specific substrings first.
_RULES: list[tuple[str, str]] = [
    # Device stock. The portal refuses the order at the device step with e.g.
    #   [40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.
    # This fires AFTER the order number is minted, so it strands a real order —
    # the agent has to pick a different device, which is why it gets its own code
    # instead of falling into the generic device_rejected bucket.
    ("out of stock", DEVICE_OUT_OF_STOCK),
    ("no stock", DEVICE_OUT_OF_STOCK),
    ("stock is not available", DEVICE_OUT_OF_STOCK),
    # Appointment slot race. Must stay ABOVE the generic "taken" rules below:
    # "slot has been taken" would otherwise file as a login-id collision.
    ("slot has been taken", APPOINTMENT_SLOT_TAKEN),
    # Feasibility / address.
    # This pair must stay ABOVE the "already has" rules: the portal's sentence
    # for an unserved address contains "services provided by TM", and a loose
    # rule ordering would file "no TM service here" as "already has TM service"
    # — opposite meanings, opposite advice to the agent.
    ("does not have any services provided by tm", ADDRESS_NO_TM_SERVICE),
    ("only offers services from other operators", ADDRESS_NO_TM_SERVICE),
    ("already has tm service", ADDRESS_ALREADY_HAS_SERVICE),
    ("already has tm services", ADDRESS_ALREADY_HAS_SERVICE),
    ("address already has", ADDRESS_ALREADY_HAS_SERVICE),
    ("no record to view", ADDRESS_NOT_FOUND),
    ("address not found", ADDRESS_NOT_FOUND),
    # MSR (Multi-Service Request) edge cases
    ("maximum number of line", MSR_CUSTOMER_ID_LIMIT),
    ("max line", MSR_CUSTOMER_ID_LIMIT),
    ("customer id limit", MSR_CUSTOMER_ID_LIMIT),
    ("offline approve", MSR_OFFLINE_APPROVAL),
    ("offline approval", MSR_OFFLINE_APPROVAL),
    # Voice number pool. Must stay ABOVE the login-id rules: the collision
    # wording is about a NUMBER, and "taken" alone would file it as a login id.
    ("taken by another order", VOICE_NUMBER_TAKEN),
    ("choose another number", VOICE_NUMBER_TAKEN),
    # Broadband login id
    ("login id already", LOGIN_ID_TAKEN),
    ("login id is taken", LOGIN_ID_TAKEN),
    ("already taken", LOGIN_ID_TAKEN),
    ("already in use", LOGIN_ID_TAKEN),
    ("login id", LOGIN_ID_INVALID),  # generic login-id complaint → invalid
    # VoBB number pool
    ("no number available", VOBB_UNAVAILABLE),
    ("number pool", VOBB_UNAVAILABLE),
    ("vobb", VOBB_UNAVAILABLE),
]


def map_error(message: str) -> str:
    """
    Map a `.modal-message` string to a stable error code.

    Returns UNKNOWN_ERROR when no rule matches — the caller should log the
    verbatim message so a new rule can be added.
    """
    if not message:
        return UNKNOWN_ERROR
    text = message.strip().lower()
    for needle, code in _RULES:
        if needle in text:
            return code
    return UNKNOWN_ERROR


# The portal prefixes its dialogs with its own numeric code, e.g.
#   [40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.
# It is worth surfacing verbatim: it is the only string a dealer can quote at
# Unifi support, and it stays meaningful even when our own wording is wrong.
_PORTAL_CODE_RE = re.compile(r"\[\s*(\d{4,})\s*\]")


def portal_code(message: str) -> str | None:
    """Pull the portal's own bracketed numeric code out of a dialog message."""
    if not message:
        return None
    m = _PORTAL_CODE_RE.search(message)
    return m.group(1) if m else None


# The portal's wording when the order carries no appointment. It says this for
# BOTH causes — a slot another dealer took out from under us, and a booking that
# never happened — so it cannot classify on its own; it means "there is no
# appointment on this order", and the caller decides what to do about it.
_NO_APPOINTMENT_RE = re.compile(
    r"please\s+input\s+the\s+appointment\s+date|"
    r"please\s+(?:select|enter)\s+(?:the\s+)?appointment", re.I)


def is_missing_appointment(message: str | None) -> bool:
    """Is the portal saying this order has no appointment date on it?

    Deliberately separate from `is_slot_taken`: that one needs the [40301147]
    code or "slot has been taken", and on 2026-08-28 the blocked Next carried
    NEITHER — only this sentence, with an empty dialog list. The rebook path was
    therefore never entered and a recoverable run stranded a real order.
    """
    return bool(_NO_APPOINTMENT_RE.search(message or ""))


def is_slot_taken(message: str | None) -> bool:
    """Is this dialog the appointment-slot race (40301147 / 'Slot has been taken')?

    Checks the portal code as well as the wording: the live incident surfaced the
    code in an Error dialog while the blocked Next itself reported only the
    consequence ("Please input the appointment date."), so callers test every
    message they can see.
    """
    return (map_error(message or "") == APPOINTMENT_SLOT_TAKEN
            or portal_code(message or "") == "40301147")

"""
oe_errors.py - Error codes + message mapping for the Unifi eSales order flow.

Every expected flow failure (MSR, address-taken, validation) surfaces as a
jQuery UI dialog (`.ui-dialog.modal-danger`) with a human-readable message in
`.modal-message`. `map_error()` turns that message into a stable code BizzFlow
can branch on. Unmapped messages return `UNKNOWN_ERROR` so the caller can log
the verbatim text and we can add the mapping later.
"""

# ── Stable error codes (the contract with BizzFlow) ──
ADDRESS_ALREADY_HAS_SERVICE = "address_already_has_service"
ADDRESS_NOT_FOUND = "address_not_found"
MSR_CUSTOMER_ID_LIMIT = "msr_customer_id_limit"
MSR_OFFLINE_APPROVAL = "msr_offline_approval"
LOGIN_ID_INVALID = "login_id_invalid"
LOGIN_ID_TAKEN = "login_id_taken"
VOBB_UNAVAILABLE = "vobb_unavailable"
UNKNOWN_ERROR = "unknown_error"

# ── Substring → code rules (matched against .modal-message, case-insensitive) ──
# Order matters: first match wins, so put more specific substrings first.
_RULES: list[tuple[str, str]] = [
    # Feasibility / address
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

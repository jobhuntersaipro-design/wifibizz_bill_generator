"""Malaysian state names as the portal's own State combobox spells them.

The Select Address modal does not offer "Kuala Lumpur". It offers
**"W.P. KUALA LUMPUR"**, and likewise "W.P. PUTRAJAYA" and "W.P. LABUAN" — the
three federal territories, and only those three, carry the W.P. prefix. A draft
stores whatever the agent pasted from the portal's own address line, which for
KL is usually "Wilayah Persekutuan Kuala Lumpur".

Uppercasing that gets "WILAYAH PERSEKUTUAN KUALA LUMPUR", the combobox has no
such option, and set_combobox raises — so every KL, Putrajaya and Labuan order
died at the address step. The BizzFlow side already knew this
(`toPortalState()` in src/lib/malaysia-address.ts); the scraper did not, and the
scraper is what drives the combobox.

`to_portal_state()` is deliberately forgiving on input and exact on output: it
returns an option the combobox actually has, or the plain uppercased input so an
unrecognised state still fails loudly at the widget rather than being silently
rewritten into a state the customer does not live in.
"""

import re

# Exact combobox option titles, verified against the live Select Address modal.
PORTAL_STATES = (
    "JOHOR", "KEDAH", "KELANTAN", "MELAKA", "NEGERI SEMBILAN", "PAHANG",
    "PERAK", "PERLIS", "PULAU PINANG", "SABAH", "SARAWAK", "SELANGOR",
    "TERENGGANU", "W.P. KUALA LUMPUR", "W.P. PUTRAJAYA", "W.P. LABUAN",
)

# The federal territories, keyed by their bare name. Everything that reduces to
# one of these keys gets the portal's W.P. spelling.
_FEDERAL = {
    "KUALA LUMPUR": "W.P. KUALA LUMPUR",
    "PUTRAJAYA": "W.P. PUTRAJAYA",
    "LABUAN": "W.P. LABUAN",
}

# Names people and other systems use that the portal does not.
_ALIASES = {
    "PENANG": "PULAU PINANG",
    "PENANG ISLAND": "PULAU PINANG",
    "MALACCA": "MELAKA",
    "NEGRI SEMBILAN": "NEGERI SEMBILAN",
    "N SEMBILAN": "NEGERI SEMBILAN",
    "KL": "W.P. KUALA LUMPUR",
    "WILAYAH PERSEKUTUAN": "W.P. KUALA LUMPUR",
}

# "W.P.", "WP", "W P", "WILAYAH PERSEKUTUAN" — all the ways the prefix is written
# before the territory's actual name. Stripped, then re-applied in the portal's
# own spelling, so the input's punctuation never has to be guessed exactly.
_PREFIX = re.compile(r"^(?:W\s*P|WILAYAH\s+PERSEKUTUAN)\s+")


def _normalize(value: str) -> str:
    """Uppercase, punctuation to spaces, whitespace collapsed."""
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", (value or "").upper())).strip()


def to_portal_state(value: str) -> str:
    """Map any spelling of a Malaysian state to the portal's combobox option.

    Unrecognised input comes back merely uppercased — the old behaviour — so a
    state this table has never seen fails at the combobox, where the message
    names the field and the value, instead of being quietly turned into a
    different state.
    """
    key = _normalize(value)
    if not key:
        return ""

    # An already-correct "W.P. KUALA LUMPUR" normalises to "W P KUALA LUMPUR";
    # stripping the prefix and re-applying it below handles that on the same path.
    bare = _PREFIX.sub("", key).strip() or key

    if bare in _FEDERAL:
        return _FEDERAL[bare]
    if bare in _ALIASES:
        return _ALIASES[bare]
    if key in _ALIASES:
        return _ALIASES[key]
    if bare in PORTAL_STATES:
        return bare
    return key

"""Does the portal's registered customer match the one the draft is for?

One IC is one customer. The Unifi CRM keys a customer record on the ID number,
so an IC that already exists belongs to exactly one person — and if the name on
that record is not the name on the draft, the draft is claiming a SECOND
customer on that IC, which cannot exist. One of the two is wrong, and neither
this code nor the portal can tell which.

Why this needs to be a decision and not a note
----------------------------------------------
Live, 2026-08-21 (ORD-0018): the draft was for ZAINUDDEEN BIN ABDUL BAARI on IC
900505065434. That IC was already registered at Unifi as WOJAK LANG, from an
earlier order on the same (test) IC. The Advanced Query search matched nothing,
the flow fell through to the duplicate-IC recovery, which picks the record by IC
ALONE — and attached WOJAK LANG, together with WOJAK LANG's existing billing
account 7041941910. Two real portal orders were minted against the wrong
customer's account before the run fell over.

The recovery was built for the opposite case (ORD-0010: HONG LIONG TONG vs the
draft's HONG TUNG TUNG — one person, spelled two ways) and carried no similarity
check at all, so a name sharing not one character with the draft attached
silently.

Scope: only the duplicate-IC path needs this
--------------------------------------------
The ordinary search path cannot attach a stranger. The portal matches Customer
Name as a PREFIX of the registered name, so any row a search for "ZAINUDDEEN"
returns has a registered name beginning with "ZAINUDDEEN" — WOJAK LANG could
never come back from it. Only the duplicate-IC picker bypasses the name
entirely, and that is the one place this gate belongs.
"""
import re

# Everything that is punctuation or spacing in a Malaysian name as the two sides
# happen to render it: "BIN"/"A/L" separators, double spaces, stray full stops.
# Comparing on the letters and the word boundaries is the point — a record that
# differs only in how it was typed is the SAME record.
_PUNCT = re.compile(r"[^A-Z0-9]+")


def normalize_name(name: str | None) -> list[str]:
    """A name as its comparable tokens: uppercase, punctuation-free, no blanks.

    Returns a list rather than a string so a prefix test can be done on whole
    tokens. Comparing joined strings would let "HONG TUNG" prefix-match
    "HONG TUNGABALINGA", which is a different person.
    """
    return [t for t in _PUNCT.sub(" ", (name or "").upper()).split() if t]


def names_agree(draft: str | None, registered: str | None) -> bool:
    """Are these two names the same customer?

    True when the tokens are equal, or when one is a whole-token prefix of the
    other. The prefix allowance is not generosity — it is what the portal itself
    does: it stores and matches names by prefix, and it truncates. A record read
    back as "HONG LIONG" for a draft of "HONG LIONG TONG" is the same person
    seen through a shorter field.

    Anything else is refused. In particular a shared SURNAME is not agreement:
    "LEE CHONG WEI" and "LEE MEI LING" share a token and are two people, so this
    deliberately does not test for overlap.

    An empty registered name is NOT agreement. This function decides whether a
    real order gets billed to a record, and "we could not read the name" is not
    a reason to proceed — it is a reason to stop and let a human look.
    """
    a, b = normalize_name(draft), normalize_name(registered)
    if not a or not b:
        return False
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return long[: len(short)] == short


def describe_ic_name_mismatch(
    ic: str | None, draft: str | None, registered: str | None
) -> str:
    """The refusal, written so the agent can act on it without opening the portal.

    Names BOTH names and the IC, because the fix is one of exactly two edits and
    the agent is the only one who knows which: correct the name on the draft, or
    correct the IC. Saying only "customer mismatch" sends them to the portal to
    find out what we already know.
    """
    who = f"registered at Unifi as {registered!r}" if normalize_name(registered) else (
        "already registered at Unifi, but the registered name could not be read"
    )
    # Deliberately does NOT claim the order was left unattached. By the time the
    # names can be compared, the portal has already minted the order number (at
    # the Order click, two steps earlier) and the duplicate-IC picker has been
    # clicked through in order to READ the name at all. What is certain is that
    # the run stopped rather than finish against a record it could not vouch
    # for; what became of the half-made order is a question for the portal, and
    # claiming otherwise would send the agent away from an order needing voiding.
    return (
        f"ID number {ic} is {who}, and the draft is for {draft!r}. "
        "One ID number belongs to one customer, so this run stopped rather than "
        "complete the order against that record. Check the ID number on the "
        "draft \u2014 a typo is the usual cause \u2014 or correct the name to match "
        "the registered customer. Void the part-made order in the portal first."
    )


def may_attach_existing(create_result: dict, draft_name: str | None) -> bool:
    """May the order proceed against what `_create_customer_via_dialog` found?

    Pure, and separate from the flow, because the three shapes that function
    returns each mean something different and the wrong reading is expensive:

    - ``created: True`` — no existing record was involved; we made this customer
      ourselves, under exactly the name we typed. Nothing to check.
    - ``created: False`` with a ``registered_name`` — the IC was already taken
      and the duplicate picker read whose it is. Proceed only if that name is
      this customer.
    - ``created: False`` with NO ``registered_name`` — the IC was already taken
      and the picker could not say by whom. Refuse: the record exists, so the
      old "customer not found" reading was wrong as well as unhelpful.
    """
    if create_result.get("created") is True:
        return True
    return names_agree(draft_name, create_result.get("registered_name"))

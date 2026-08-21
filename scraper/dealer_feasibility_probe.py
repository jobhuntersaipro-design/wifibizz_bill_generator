"""
dealer_feasibility_probe.py — "Does TM actually sell anything here?", asked
without creating anything.

An address existing in the portal's address database is NOT the same as the
address being serviceable: the BSP 21 building is findable by
`dealer_address_search` and still answers "only offers services from other
operators". The only proof is the Subscription Plan List filling with rows.

That grid fills right after the Select Address OK and BEFORE any customer is
involved — the Customer dialog only appears once an offer row is double-clicked
(see `run_feasibility` in oe_feasibility.py). So the question is answerable with
no customer profile, no Order click, and nothing minted.

This module deliberately does LESS than `run_feasibility(dry_run=True)`, which
creates a real customer profile in Unifi's CRM before it gets here. It selects
the address by `address_id` only — a keyword select needs an exact string match
against a grid row, which a hand-typed address almost never satisfies.

Read-only. Clicks: the Feasibility Check button, the address row, the modal OK.
Nothing else.

Public entrypoint:
    await probe_offers(session_path, state, address_id) -> dict
"""

import asyncio

import dealer_web_login
import oe_feasibility
from oe_feasibility import OFFER_ROW_INDEX_JS, open_feasibility, select_address
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry, InfraError

# The portal's own explanation for an address that lists nothing, kept identical
# to select_plan's `no_offers_listed` message. A probe and a real run must not
# describe the same address in two different ways.
NO_OFFERS_MESSAGE = (
    "The portal listed no offers at all for this address — "
    "it is likely not serviceable by TM (the portal reports "
    "'services from other operators' for such addresses)."
)


async def read_offers(page, frame) -> list:
    """Offer titles currently in the Subscription Plan List, or [] if it stays empty.

    Split out from probe_offers so it can be tested against a fixture page
    without a portal session. Waits for the rows, not just the grid element —
    the portal fills them by a separate AJAX call after the address OK, so
    reading too early makes a slow query look like an unserviceable address.
    """
    # ATTACHED, not visible. An offer grid with no rows has zero height, so a
    # visibility wait is satisfied by the very thing we are trying to detect
    # never arriving — the wait times out on the GRID and an unserviceable
    # address stalls for the full grid timeout, blamed on the wrong step. The
    # row wait below is what decides serviceability, and it must be the one
    # doing the waiting.
    try:
        await frame.locator(".js-offer-grid").first.wait_for(state="attached", timeout=20000)
    except Exception:
        return []
    rows = frame.locator(".js-offer-grid tr.jqgrow")
    try:
        # Read the timeout off the module rather than binding it at import, so a
        # test can shrink it instead of waiting the full 15s out.
        await rows.first.wait_for(
            state="attached", timeout=oe_feasibility.OFFER_ROWS_TIMEOUT_MS)
    except Exception:
        return []
    # Reuse the production reader: it already knows to take the longest title
    # cell per row and to drop the 24-char internal ids. Passing a name we can
    # never match keeps `i` at -1 and leaves `offers` as the whole list.
    picked = await page.evaluate(OFFER_ROW_INDEX_JS, "\x00no-such-offer\x00")
    return [o for o in (picked.get("offers") or []) if o]


async def probe_offers(session_path: str, state: str, address_id: str) -> dict:
    """
    Ask the portal what it offers at one address.

    Returns:
      {"success": True, "serviceable": True,  "matched": "<concatAddress>",
       "offers": [...], "count": N}
      {"success": True, "serviceable": False, "message": NO_OFFERS_MESSAGE}
      {"success": False, "error": "<code>", "message": "..."}   # expected failures

    Raises InfraError only on a lost session / browser failure, matching
    order_entry.py's contract, so the caller can tell "reconnect" apart from
    "this address sells nothing".
    """
    state = (state or "").strip().upper()
    address_id = str(address_id or "").strip()
    if not state or not address_id:
        return {"success": False, "error": "missing_fields",
                "message": "state and address_id are required."}

    pw = browser = context = page = None
    try:
        try:
            pw, browser, context, page = await dealer_web_login.open_context_from_session(
                session_path, landing_url=ORDER_ENTRY_URL
            )
        except Exception as e:  # noqa: BLE001
            raise InfraError(f"Could not open dealer session: {e}") from e

        await ensure_on_order_entry(page)
        frame = _frame(page)

        r = await open_feasibility(frame)
        if r["status"] != "ok":
            return {"success": False, "error": r.get("error", "open_feasibility_failed"),
                    "message": r.get("message") or "Could not open the Feasibility Check."}
        await asyncio.sleep(2)

        # By Address Id — exactly one row, no exact-string matching involved.
        r = await select_address(frame, {"state": state, "address_id": address_id})
        if r["status"] != "ok":
            return {"success": False, "error": r.get("error", "select_address_failed"),
                    "message": r.get("message") or "The portal did not accept this address id."}

        offers = await read_offers(page, frame)
        if not offers:
            return {"success": True, "serviceable": False, "count": 0, "offers": [],
                    "matched": r.get("matched"), "message": NO_OFFERS_MESSAGE}

        return {"success": True, "serviceable": True, "count": len(offers),
                "offers": offers, "matched": r.get("matched")}

    finally:
        for closer in (
            (context.close if context else None),
            (browser.close if browser else None),
            (pw.stop if pw else None),
        ):
            if closer:
                try:
                    await closer()
                except Exception:
                    pass


# ── CLI smoke test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, json as _json

    sess = sys.argv[1]
    st = sys.argv[2]
    addr_id = sys.argv[3]
    print(_json.dumps(asyncio.run(probe_offers(sess, st, addr_id)), indent=2))

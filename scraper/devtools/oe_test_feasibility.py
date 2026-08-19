"""DEV: dry-run feasibility using a REAL draft from the DB. Reads the newest
draft (or one by id), builds the feasibility payload from its stored address +
offer, and runs enter_feasibility(dry_run=True) — walks address + plan, checks
the Order button is enabled, and STOPS (no order created).

    python oe_test_feasibility.py <session.json> [order_id]
"""
import asyncio
import os
import sys

from oe_feasibility import enter_feasibility

# The scraper doesn't carry a DB driver; pass the draft in via env or use the
# values fetched from Neon. For this test we read them from the environment so
# the same script works for any draft (the caller exports them).
DRAFT = {
    "state": os.environ.get("FEAS_STATE", "SELANGOR"),
    "address_id": os.environ.get("FEAS_ADDRESS_ID") or None,
    "address_full": os.environ.get("FEAS_ADDRESS_FULL", ""),
    "offer_name": os.environ.get("FEAS_OFFER", ""),
}


async def main(session_path):
    payload = {
        "address": {
            "state": DRAFT["state"].upper(),
            "customer_type": "Consumer",
            "address_id": DRAFT["address_id"],
            "address_full": DRAFT["address_full"],
            "keywords": DRAFT["address_full"],  # keyword = full stored address
        },
        "plan": {"name": DRAFT["offer_name"]},
    }
    print("→ feasibility dry-run payload:")
    print(f"    state       : {payload['address']['state']}")
    print(f"    address_id  : {payload['address']['address_id'] or '(none — keyword+exact-match)'}")
    print(f"    address_full: {payload['address']['address_full'][:80]}…")
    print(f"    plan        : {payload['plan']['name']}")
    # user_key is derived from the session filename.
    user_key = os.path.basename(session_path).replace("dealer_", "").replace(".json", "")
    result = await enter_feasibility(payload, dry_run=True, user_key=user_key)
    print("\n=== RESULT ===")
    print(result)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess))

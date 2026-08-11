"""Create the customer profile FOR REAL (order-entry stage): enter_order with
stop_after_customer_create=True -> fills the Personal Customer form, uploads the
ID doc from R2, clicks OK to create the profile, then STOPS (no Pay, no order).
Headed with --headed. Requires R2_* env vars for the ID-doc download.

    python oe_create_customer.py <session.json> [--headed]  (reads /tmp/draft.json)
"""
import asyncio
import json
import os
import sys

import login_manager
from order_entry import enter_order
from order_to_payload import order_to_payload


async def main(session_path, draft_path, headed):
    if headed:
        from inspect_order_entry import _headed_launch_safe
        login_manager._launch_browser_safe = _headed_launch_safe

    order = json.load(open(draft_path))
    payload = order_to_payload(order)
    user_key = os.path.basename(session_path).replace("dealer_", "").replace(".json", "")
    print(f"→ CREATING CUSTOMER (real): {order.get('fullName')} / {order.get('idNumber')}")
    print(f"  session user_key: {user_key}")
    result = await enter_order(
        payload, dry_run=False, stop_after_customer_create=True, user_key=user_key
    )
    print("\n=== RESULT ===")
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess, "/tmp/draft.json", headed=("--headed" in sys.argv)))

"""
dry_run_customer.py - First headed dry-run of the order flow's customer stage.

Loads a user's captured dealer session, opens the eSales order entry, and FILLS
the Personal Customer profile from a saved BizzFlow draft (or a built-in test
payload) — then STOPS before saving. Nothing is submitted and no customer record
is created; it exists to eyeball whether stage-1 field mapping is correct against
the live portal.

Usage (run from the scraper/ directory):
    python dry_run_customer.py                       # latest draft of the default user
    python dry_run_customer.py --user-key <cuid>     # a specific BizzFlow user
    python dry_run_customer.py --draft-id <id>       # a specific draft
    python dry_run_customer.py --test                # built-in fake payload (no DB)
    python dry_run_customer.py --headless            # don't open a window
"""

import argparse
import asyncio
import json
import os
import random

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())

import login_manager
import order_entry
from order_to_payload import order_to_payload

# The user whose captured dealer session we drive by default (has a live
# sessions/dealer_<user>.json).
DEFAULT_USER_KEY = "cmno32fci000004jn760fh8fl"


def _random_mykad() -> str:
    """A syntactically valid, likely-unused MyKad (YYMMDD-PB-###G) so the test
    doesn't trip the 'multiple customer records' dialog on a reused IC."""
    yy = random.randint(60, 99)          # 1960s-90s birth years
    mm = random.randint(1, 12)
    dd = random.randint(1, 28)
    pb = random.choice([1, 3, 6, 8, 10, 12, 14])  # a state-of-birth code
    serial = random.randint(1000, 9999)
    return f"{yy:02d}{mm:02d}{dd:02d}{pb:02d}{serial:04d}"


_TEST_ORDER = {
    "id": "test-payload",
    "idType": "MyKad",
    "idNumber": _random_mykad(),
    "fullName": "ROHANA BINTI MAT ISA",
    "mobilePrefix": "60",
    "mobile": "142427170",
    "email": "rohana@example.com",
    "street": "LOT 4086 JALAN ARA PANJANG",
    "postcode": "33800",
    "city": "Manong",
    "state": "Perak",
    "offerName": "Unifi Home 500Mbps Premium Value With Device (36M)",
    "offerCategory": "Home",
}


def _fetch_draft(user_key: str, draft_id: str | None) -> dict | None:
    """Pull one draft order for the user from Postgres. Returns a dict of the
    order's columns, or None if none found / no DATABASE_URL."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("⚠️  DATABASE_URL not set — falling back to the test payload.")
        return None
    import psycopg2
    import psycopg2.extras

    where = "user_id = %s" + (" AND id = %s" if draft_id else " AND status = 'draft'")
    params = (user_key, draft_id) if draft_id else (user_key,)
    sql = (
        "SELECT id, id_type, id_number, full_name, gender, birthday, race, "
        "nationality, mobile_prefix, mobile, email, street, postcode, city, "
        "state, offer_name, offer_category, remarks, documents "
        f"FROM orders WHERE {where} ORDER BY created_at DESC LIMIT 1"
    )
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


async def _run(user_key: str, payload: dict, headed: bool):
    if headed:
        # Reuse inspect_order_entry's headed launcher (headed + slow-mo) without
        # touching login_manager.py.
        from inspect_order_entry import _headed_launch_safe

        login_manager._launch_browser_safe = _headed_launch_safe

    result = await order_entry.enter_order(
        payload,
        dry_run=True,
        user_key=user_key,
        stop_after_customer_fill=True,
    )
    return result


def _sample_id_doc() -> str:
    """A tiny valid PNG so the --test run can exercise the attachment upload
    without needing a real file in R2."""
    import base64

    path = os.path.join("logs", "sample_id.png")
    os.makedirs("logs", exist_ok=True)
    if not os.path.exists(path):
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        with open(path, "wb") as f:
            f.write(png)
    return os.path.abspath(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-key", default=DEFAULT_USER_KEY)
    ap.add_argument("--draft-id", default=None)
    ap.add_argument("--test", action="store_true", help="use the built-in payload, skip the DB")
    ap.add_argument("--doc", default=None, help="local file path to upload as the ID copy")
    ap.add_argument("--headless", action="store_true", help="don't open a browser window")
    args = ap.parse_args()

    if args.test:
        order = _TEST_ORDER
        print("Using built-in TEST payload.")
    else:
        order = _fetch_draft(args.user_key, args.draft_id)
        if order is None:
            order = _TEST_ORDER
            print("No draft found — using built-in TEST payload.")
        else:
            print(f"Using draft {order.get('id')}: {order.get('full_name')} ({order.get('id_number')})")

    payload = order_to_payload(order)
    # Attachment source: an explicit --doc, else a generated sample for --test,
    # else the order's R2 keys (id_doc_keys) resolved by the backend.
    if args.doc:
        payload["customer"]["id_doc_path"] = os.path.abspath(args.doc)
    elif args.test and not payload["customer"].get("id_doc_keys"):
        payload["customer"]["id_doc_path"] = _sample_id_doc()
    print("\n── Payload (customer) ──")
    print(json.dumps(payload["customer"], indent=2, ensure_ascii=False))
    print("\nOpening portal with session for user:", args.user_key)
    print("(fills the customer form, then STOPS before saving)\n")

    result = asyncio.run(_run(args.user_key, payload, headed=not args.headless))
    print("\n── Result ──")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

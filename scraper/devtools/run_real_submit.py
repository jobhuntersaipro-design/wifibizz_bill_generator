"""DEV: run ONE full order submit locally with the fixed code, exactly as the
Flask service would (same payload build, same enter_full_order call).

    venv/bin/python -m devtools.run_real_submit logs/ord0010-order.json [--pay]

WITHOUT --pay it stops at the Pay gate (status ready_to_pay) — no charge.
WITH --pay it clicks the REAL, billable Pay button and places a live order.

Writes logs/<ref>-result.json (result + every stage event) for the DB write-back.
"""
import asyncio, json, sys, time
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

from order_to_payload import order_to_payload

async def main(order_path, do_pay):
    blob = json.load(open(order_path))
    order, user_key = blob["order"], blob["user_key"]
    payload = order_to_payload(order)
    # api_server stamps the authenticated user onto the artefact reference AFTER
    # the payload is built, so R2 keys always come from the caller's identity.
    if isinstance(payload.get("order_ref"), dict):
        payload["order_ref"]["user_id"] = user_key

    events = []
    def on_stage(name, detail=None):
        events.append({"stage": name, "detail": detail, "at": time.time()})
        print(f"  ▸ STAGE {name} {json.dumps(detail) if detail else ''}", flush=True)

    from oe_feasibility import enter_full_order
    print(f"\n=== SUBMIT {order.get('fullName')} · attempt {order.get('attempt')} "
          f"· do_pay={do_pay} ===\n", flush=True)
    result = await enter_full_order(payload, user_key=user_key, dry_run=False,
                                    submit=True, do_pay=do_pay, on_stage=on_stage)
    out = {"result": result, "events": events, "dbId": blob["dbId"],
           "attempt": order.get("attempt"), "do_pay": do_pay}
    path = order_path.replace("-order.json", "-result.json")
    json.dump(out, open(path, "w"), indent=2, default=str)
    print("\n=== RESULT ===")
    print(json.dumps(result, indent=2, default=str)[:3000])
    print(f"\nwritten -> {path}")

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], "--pay" in sys.argv))

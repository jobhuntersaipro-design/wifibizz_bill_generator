"""Exercise the admin live view end to end WITHOUT a dealer session.

A viewer's frames live in the api_server PROCESS that runs the job, so this
script cannot feed a separately running server — it IS the server: it imports
api_server, registers a fake live-view job in-process, screencasts a public
page (example.com) into that job's store, and serves Flask on :5000 for the
Next.js dev server's browser to reach.

Nothing here touches the Unifi portal or a dealer session.

Usage (from scraper/, in the 3.12 venv, with ORDER_ENTRY_API_TOKEN in .env,
and no other api_server on :5000):
    python devtools/live_view_demo.py            # 8 stages, 6 s apart, success
    python devtools/live_view_demo.py --fail     # ends with result error "demo refusal"
    python devtools/live_view_demo.py --no-live  # job registered with live_view False (refusal check)
    python devtools/live_view_demo.py --slow     # 20 s per stage (viewer-cap check across tabs)

Then point a DEV order's job_id at the printed id (and status 'submitting'),
open /admin/orders/<id>/live, and restore the order afterwards.
"""
import argparse
import asyncio
import os
import sys
import threading
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("LIVE_VIEW_ORIGIN", "http://localhost:3000")

import api_server  # noqa: E402
import live_view  # noqa: E402

JOB_ID = "demo0000000000000000000000000000"
STAGES = ["validating_draft", "checking_session", "creating_customer", "checking_address",
          "checking_plan", "placing_order", "attaching_customer", "capturing_order_no"]


def _now() -> str:
    return datetime.utcnow().isoformat()


def _serve():
    api_server.app.run(host="0.0.0.0", port=5000, threaded=True, use_reloader=False)


async def _drive(args):
    from playwright.async_api import async_playwright
    log_path = os.path.join(api_server._logs_dir(), f"{JOB_ID}.log")
    open(log_path, "w").close()  # a fresh log per demo run
    with api_server.JOBS_LOCK:
        api_server.JOBS[JOB_ID] = {"status": "running", "live_view": not args.no_live, "log_path": log_path,
                                   "created_at": _now(), "started_at": _now(),
                                   "params": {"kind": "order_entry", "user_key": "demo"}, "stages": []}
    print(f"demo job registered: {JOB_ID} (live_view={not args.no_live}, fail={args.fail}, "
          f"stage_s={args.stage_s})", flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto("https://example.com")
        session = await live_view.attach(page, JOB_ID)
        with open(log_path, "a") as lf:
            for i, st in enumerate(STAGES):
                entry = {"name": st, "detail": None if i % 2 else f"detail {i}", "at": _now() + "Z"}
                with api_server.JOBS_LOCK:
                    api_server.JOBS[JOB_ID]["stage"] = st
                    api_server.JOBS[JOB_ID]["stages"].append(entry)
                live_view.publish_stage(JOB_ID, entry)
                lf.write(f"[{_now()}] stage {st}\n")
                lf.flush()
                await page.evaluate(f"document.body.style.background='hsl({i * 40},60%,85%)'; document.title='{st}'")
                await page.evaluate(f"document.querySelector('h1').textContent='Step {i + 1}: {st}'")
                print(f"  stage {i + 1}/{len(STAGES)}: {st}", flush=True)
                await asyncio.sleep(args.stage_s)
        await live_view.detach(JOB_ID, session)
        result = ({"status": "error", "message": "demo refusal"} if args.fail
                  else {"status": "success", "order_id": "2609000000000000"})
        with api_server.JOBS_LOCK:
            api_server.JOBS[JOB_ID].update(status="done", finished_at=_now(), result=result)
        await browser.close()
    print("demo run finished; server still up — Ctrl-C to quit", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fail", action="store_true", help='finish with result {"status":"error","message":"demo refusal"}')
    ap.add_argument("--no-live", action="store_true", help="register the job with live_view False")
    ap.add_argument("--slow", action="store_true", help="20 s per stage instead of 6 s")
    args = ap.parse_args()
    args.stage_s = 20 if args.slow else 6
    threading.Thread(target=_serve, daemon=True).start()
    asyncio.run(_drive(args))
    threading.Event().wait()

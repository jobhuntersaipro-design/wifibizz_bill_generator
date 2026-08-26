"""
Flask API server for BizzFlow's Unifi dealer Order Entry.

Every route that touches the portal is AUTH-GATED on `X-Internal-Token`
(see `_order_entry_authorized`) because it submits real, billable orders.
`/health` is the only deliberately public route, and it returns a bare
count — Caddy serves this host on the open internet.

This file previously also carried the WifiBizz-crawler and Google-Sheets
routes under a "NO AUTHORIZATION / accessible to everyone" posture. They
were removed: their modules (`date_utils`, `gsheets_writer`) no longer
exist so most could only 500, the Next.js app replaced that crawler, and
`/download_csv` was an unauthenticated arbitrary-file-read
(`outputs/<filename>` with no traversal check). Do not reintroduce an
unauthenticated route here.
"""

import os
import uuid
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from threading import Lock, Thread

from dotenv import find_dotenv, load_dotenv
from flask import Flask, jsonify, request

# Load the project root .env (walks up from scraper/) so ORDER_ENTRY_API_TOKEN
# and the rest are available without exporting them by hand.
load_dotenv(find_dotenv())

# Local dev: OE_HEADED=1 runs order/feasibility jobs in a VISIBLE Chromium so you
# can watch the portal flow. login_manager launches headless by default; reuse
# inspect_order_entry's headed monkeypatch. Never set this on the droplet (no X).
if os.environ.get("OE_HEADED") == "1":
    try:
        import login_manager
        from inspect_order_entry import _headed_launch_safe
        login_manager._launch_browser_safe = _headed_launch_safe
        print("⚠ OE_HEADED=1 — order jobs will run in a VISIBLE browser window.")
    except Exception as _e:  # noqa: BLE001
        print(f"OE_HEADED requested but headed patch failed: {_e}")

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint.

    `active_jobs` exists for deploy.sh: a rebuild restarts this process and
    destroys the JOBS registry along with every in-flight submit, so the deploy
    has to be able to ask whether anything is running. Deliberately a bare count
    — no ids, params or customer data — because Caddy serves /health publicly
    with no token check.

    JOBS/JOBS_LOCK are defined below this function; that's fine, they resolve at
    call time, long after the module has finished importing.
    """
    with JOBS_LOCK:
        active = sum(
            1 for job in JOBS.values() if job.get("status") in ("queued", "running")
        )

    return jsonify(
        {
            "status": "healthy",
            "active_jobs": active,
            "timestamp": datetime.now().isoformat(),
            "service": "BizzFlow order-entry API",
        }
    )


# ---- Minimal in-memory job registry ----
JOBS = (
    {}
)  # job_id -> {status, created_at, started_at, finished_at, params, result, error, log_path}
JOBS_LOCK = Lock()


def _jobs_dir():
    d = os.path.join(os.getcwd(), "jobs")
    os.makedirs(d, exist_ok=True)
    return d


def _logs_dir():
    d = os.path.join(os.getcwd(), "logs")
    os.makedirs(d, exist_ok=True)
    return d


def _is_order_job(job) -> bool:
    return bool(job) and job.get("params", {}).get("kind") == "order_entry"


@app.get("/jobs/<job_id>")
def job_status(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "unknown_job"}), 404
    # Order jobs carry customer PII — gate them like /orders, unlike the open
    # scrape jobs that share this registry.
    if _is_order_job(job) and not _order_entry_authorized(request):
        return jsonify({"error": "unauthorized"}), 401
    # Don't dump large results; return a summary.
    # NOTE: this passes through `stages`, whose details carry customer name and
    # address. That is safe only because order jobs are auth-gated above — the
    # same reason `result` is redacted. Keep both facts together.
    resp = {k: v for k, v in job.items() if k not in {"result"}}
    # Include success shorthand if available
    if (
        "result" in job
        and isinstance(job["result"], dict)
        and "success" in job["result"]
    ):
        resp["success"] = job["result"]["success"]
        # small message if present
        if "message" in job["result"]:
            resp["message"] = job["result"]["message"]
    # For order jobs (auth-gated above), return the PII-free result fields so
    # BizzFlow can read status / order_id / warning / error.
    if _is_order_job(job) and isinstance(job.get("result"), dict):
        resp["result"] = _redact_order_result(job["result"])
    return jsonify({"job_id": job_id, **resp}), 200


@app.get("/jobs/<job_id>/log")
def job_log(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "unknown_job"}), 404
    # Order-job logs may contain customer PII — require the shared secret.
    if _is_order_job(job) and not _order_entry_authorized(request):
        return jsonify({"error": "unauthorized"}), 401
    log_path = job.get("log_path")
    if not log_path or not os.path.exists(log_path):
        return jsonify({"log": ""}), 200
    # Stream back as text/plain
    with open(log_path, "r") as f:
        return app.response_class(f.read(), mimetype="text/plain")


# ───────────────────────────────────────────────────────────────────────────
# Order Entry (Unifi eSales) — AUTH-GATED, unlike the open scrape routes.
#
# This submits real, billable orders, so it does NOT inherit the "NO
# AUTHORIZATION" posture of the rest of this file. Callers must send the shared
# secret in `X-Internal-Token`, matched against ORDER_ENTRY_API_TOKEN. If that
# env var is unset, the route is hard-disabled (503) rather than left open.
#
# dry_run defaults to True. A real submission requires an explicit
# {"dry_run": false} in the body. Order jobs reuse the JOBS registry + global
# lock, so they never run concurrently with a scrape (single browser).
# ───────────────────────────────────────────────────────────────────────────
def _order_entry_authorized(req) -> bool:
    expected = os.environ.get("ORDER_ENTRY_API_TOKEN")
    if not expected:
        return False  # route disabled when no secret is configured
    return req.headers.get("X-Internal-Token") == expected


def _redact_order_result(result):
    """Strip customer PII (name/IC/mobile/email/address, dry-run `would_submit`)
    before it lands in a log file — logs are readable and must stay PII-free."""
    if not isinstance(result, dict):
        return result
    safe_keys = {"status", "error", "stage", "order_id", "screenshot",
                 # `advance_payment` is what pay_and_submit actually returns;
                 # `ap_amount` was the old name and never matched, so the
                 # "Advance Payment RM…" note could never reach the UI.
                 "ap_amount", "advance_payment", "deposit_amount", "message", "warning",
                 # Device diagnostics — codes/names of hardware offers, not PII.
                 # BizzFlow persists these to stop offering a device this package
                 # refuses, so they MUST survive redaction.
                 "rejected_device_code", "rejected_device_name",
                 "substituted_device_code", "substituted_device_name",
                 "available_devices", "offered", "groups",
                 # The portal's own numeric code (e.g. 40300338) and the shape of
                 # the dialog it came from. `dialog` is diagnostic — it is how one
                 # live run answers "which selector actually matched?" — and both
                 # are portal metadata, not customer data.
                 "portal_code", "dialog",
                 # The e-RF's R2 key and the portal order URL. NOT PII: the key is
                 # order-screenshots/<userId>/<orderId>/<portalOrderNumber>_erf.pdf
                 # and the URL carries the order number only.
                 #
                 # Their absence here is why a run that paid, downloaded the form
                 # and uploaded it to R2 came back reading "finished without
                 # downloading the e-RF" and was demoted from Submitted to Order
                 # Entered: BizzFlow decides that on `erf_key`, and redaction
                 # removed it. Same trap as `ap_amount` above — a whitelist a
                 # returned field never joined.
                 "erf_key", "order_url"}
    return {k: v for k, v in result.items() if k in safe_keys}


def _run_order_job(job_id: str, payload: dict, dry_run: bool, user_key: str = None,
                   stop_after_customer_fill: bool = False,
                   stop_after_customer_create: bool = False,
                   full_order: bool = False, do_pay: bool = False,
                   notify_order_id: str = None):
    """Background runner for enter_order()/enter_full_order(); logs to logs/<job_id>.log.

    `notify_order_id` is BizzFlow's own Order id. When set, this job POSTs an
    `order_finished` event once it reaches a terminal state, which is what makes
    the result email arrive even though the browser tab is closed.

    Batch members pass None: the batch summary covers them, and one email per
    order inside a batch is exactly what the summary exists to avoid.
    """
    import asyncio

    from order_entry import InfraError, enter_order

    # Hard cap on a single order run. A wedged portal step (slow AJAX, a lost
    # session mid-flow) must not let the job — and its Chromium — run forever.
    # On timeout, wait_for cancels the run, whose finally tears the browser down,
    # so no headless_shell leaks. The full flow (customer create + feasibility +
    # attach) is longer, so it gets a bigger cap.
    # The full flow now drives the whole New Connection detail flow through Pay
    # (page 1 + sub-tabs + device + attachments + appointment + delivery + T&C +
    # Pay), so it needs a much larger cap than the order-id-only path.
    # seconds; override via OE_ORDER_TIMEOUT (e.g. a manual-appointment + real Pay
    # run needs headroom so it doesn't get killed while you pick the slot / it pays).
    OVERALL_ORDER_TIMEOUT = int(os.environ.get("OE_ORDER_TIMEOUT", "600" if full_order else "210"))

    def _set_stage(name, detail=None):
        """Record a stage milestone on the job.

        Keeps BOTH the current stage (unchanged, older BizzFlow reads it) and an
        append-only history. The history is what lets the UI show a value per
        step: a fast stage used to be overwritten before a 2s poll ever saw it,
        so steps went green by inference rather than observation.

        A stage is emitted twice — bare when it starts, again with the resolved
        detail — so the list is capped to keep a wedged loop from growing the
        in-memory job record without bound.
        """
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if job is None:
                return
            job["stage"] = name
            stages = job.setdefault("stages", [])
            if len(stages) < 200:
                stages.append({
                    "name": name,
                    "detail": detail,
                    # Explicitly UTC. utcnow().isoformat() alone has no offset,
                    # and JS Date() reads a bare timestamp as LOCAL time — which
                    # would shift every step in the timeline by the viewer's
                    # timezone.
                    "at": datetime.utcnow().isoformat() + "Z",
                })
            JOBS[job_id] = job

    async def _run_bounded():
        if full_order:
            from oe_feasibility import enter_full_order
            return await asyncio.wait_for(
                enter_full_order(payload, user_key=user_key, dry_run=dry_run,
                                 submit=True, do_pay=do_pay, on_stage=_set_stage),
                timeout=OVERALL_ORDER_TIMEOUT,
            )
        return await asyncio.wait_for(
            enter_order(
                payload, dry_run=dry_run, user_key=user_key,
                stop_after_customer_fill=stop_after_customer_fill,
                stop_after_customer_create=stop_after_customer_create,
            ),
            timeout=OVERALL_ORDER_TIMEOUT,
        )

    log_path = os.path.join(_logs_dir(), f"{job_id}.log")
    with open(log_path, "w", buffering=1) as lf, redirect_stdout(lf), redirect_stderr(lf):
        print(f"[{datetime.utcnow().isoformat()}] Order job {job_id} started (dry_run={dry_run})")
        with JOBS_LOCK:
            job = JOBS.get(job_id, {})
            job.update(status="running", started_at=datetime.utcnow().isoformat(), log_path=log_path)
            JOBS[job_id] = job
        try:
            result = asyncio.run(_run_bounded())
            # Log a redacted summary only; the full result (with PII) is kept in
            # the in-memory job record, which is auth-gated.
            print(f"[{datetime.utcnow().isoformat()}] enter_order result: {_redact_order_result(result)}")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job.update(
                    status="done",
                    finished_at=datetime.utcnow().isoformat(),
                    result=result,
                    log_path=log_path,
                )
                JOBS[job_id] = job
        except asyncio.TimeoutError:
            # Overall cap hit — enter_order was cancelled and tore its browser
            # down. Surface an actionable message (busy portal / expired session)
            # rather than letting the client fall back to a generic timeout.
            print(f"[{datetime.utcnow().isoformat()}] ORDER TIMEOUT after {OVERALL_ORDER_TIMEOUT}s")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job.update(
                    status="error",
                    finished_at=datetime.utcnow().isoformat(),
                    error="The portal did not respond in time — it may be busy or your dealer session may have expired. Reconnect and try again.",
                    error_kind="portal_timeout",
                    log_path=log_path,
                )
                JOBS[job_id] = job
        except InfraError as e:
            # Infrastructure failure — caller may retry.
            print(f"[{datetime.utcnow().isoformat()}] INFRA ERROR: {e!r}")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job.update(
                    status="error",
                    finished_at=datetime.utcnow().isoformat(),
                    error=str(e),
                    error_kind="infra",
                    log_path=log_path,
                )
                JOBS[job_id] = job
        except Exception as e:
            print(f"[{datetime.utcnow().isoformat()}] UNEXPECTED ERROR: {e!r}")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job.update(
                    status="error",
                    finished_at=datetime.utcnow().isoformat(),
                    error=str(e),
                    error_kind="unexpected",
                    log_path=log_path,
                )
                JOBS[job_id] = job

        # Outside every except: a run that errored is just as finished as one
        # that succeeded, and a failed submit is the result an agent most needs
        # told about.
        if notify_order_id:
            _notify_bizzflow({"event": "order_finished", "orderId": notify_order_id,
                              "jobId": job_id})


# ───────────────────────────────────────────────────────────────────────────
# Completion webhooks — the droplet telling BizzFlow a run finished.
#
# The droplet deliberately holds NO email credentials and renders no templates:
# it reports completion and BizzFlow (which can read customer names out of its
# own database) decides what to send. Delivery failure is logged and dropped —
# BizzFlow's polling still reconciles every order, so a lost event costs the
# email, never the result.
# ───────────────────────────────────────────────────────────────────────────
def _webhook_send(url, headers, body):
    """One HTTP POST, returning its status code. Split out so the retry logic in
    batch_runner can be tested without a network."""
    import requests

    return requests.post(url, headers=headers, json=body, timeout=10).status_code


def _notify_bizzflow(body: dict) -> bool:
    from batch_runner import post_webhook

    return post_webhook(
        os.environ.get("BIZZFLOW_WEBHOOK_URL"),
        os.environ.get("SCRAPER_WEBHOOK_SECRET"),
        body,
        _webhook_send,
    )


@app.post("/orders")
def create_order():
    """
    Start an Order Entry run (auth-gated, non-blocking).

    Headers: X-Internal-Token: <ORDER_ENTRY_API_TOKEN>
    Body: {"payload": {...}, "dry_run": true}   # dry_run defaults to true

    Returns 202 {"job_id", "status"}. Poll GET /jobs/<job_id> for the result
    (status=success|error|needs_capture|dry_run inside `result`).
    """
    if not _order_entry_authorized(request):
        if not os.environ.get("ORDER_ENTRY_API_TOKEN"):
            return jsonify({"success": False, "error": "ORDER_ENTRY_DISABLED",
                            "message": "ORDER_ENTRY_API_TOKEN not configured on server."}), 503
        return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401

    data = request.get_json(silent=True) or {}
    payload = data.get("payload")
    # Accept either a pre-built `payload` or a raw BizzFlow `order` we map here
    # (so the payload logic lives in one place, order_to_payload).
    if not isinstance(payload, dict):
        order = data.get("order")
        if isinstance(order, dict):
            from order_to_payload import order_to_payload
            payload = order_to_payload(order)
    if not isinstance(payload, dict):
        return jsonify({"success": False, "error": "PAYLOAD_REQUIRED",
                        "message": "Body must include an order `payload` or `order` object."}), 400

    # Which user's captured dealer session to drive the order with. Required so
    # each order submits under the dealer account that user connected — never a
    # shared identity.
    user_key = data.get("user_key") or None

    # Stamp the authenticated user onto the artefact reference. Done HERE, after
    # the payload is built, so the R2 prefix a screenshot lands under always comes
    # from the caller's identity rather than anything in the request body.
    if user_key and isinstance(payload.get("order_ref"), dict):
        payload["order_ref"]["user_id"] = user_key

    # Safety: dry_run is the default; a real submission needs explicit false.
    dry_run = data.get("dry_run", True)
    if not isinstance(dry_run, bool):
        return jsonify({"success": False, "error": "INVALID_DRY_RUN",
                        "message": "`dry_run` must be a boolean."}), 400
    stop_after_customer_fill = bool(data.get("stop_after_customer_fill", False))
    # "Order entry" mode: create the customer profile for real, then stop.
    stop_after_customer_create = bool(data.get("stop_after_customer_create", False))
    # Full per-order flow: create customer -> feasibility -> attach -> order id.
    full_order = bool(data.get("full_order", False))
    # Real, billable Pay/Submit at the end of the full flow (default False = stop
    # at the Pay gate). BizzFlow's submitOrder sends do_pay=true for real orders.
    do_pay = bool(data.get("do_pay", False))
    # Catalogue discovery: drive the flow only as far as the device Offer dialog,
    # read the package's mandatory groups, and stop. It still MINTS AN ORDER —
    # the dialog does not exist before Order is clicked — so the caller is
    # responsible for flagging that order for voiding.
    if bool(data.get("discover_only", False)):
        payload["discover_only"] = True

    # Single-browser global lock — reject if any job (scrape or order) is active.
    with JOBS_LOCK:
        for job in JOBS.values():
            if job.get("status") in ("queued", "running"):
                return jsonify({"success": False, "error": "JOB_IN_PROGRESS",
                                "message": "The server can only run one browser job at a time."}), 409
        job_id = uuid.uuid4().hex
        JOBS[job_id] = {
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "params": {"dry_run": dry_run, "kind": "order_entry"},
        }

    # Report this run's completion to BizzFlow so the result email arrives with
    # the tab closed. Only for a REAL submit: a dry run places nothing, and
    # mailing an agent about it would train them to ignore the ones that count.
    notify_order_id = None
    if not dry_run and isinstance(payload.get("order_ref"), dict):
        notify_order_id = payload["order_ref"].get("order_id")

    Thread(
        target=_run_order_job,
        args=(job_id, payload, dry_run, user_key, stop_after_customer_fill,
              stop_after_customer_create, full_order, do_pay, notify_order_id),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id, "status": "queued", "dry_run": dry_run}), 202


# ───────────────────────────────────────────────────────────────────────────
# Batch submit — AUTH-GATED.
#
# BizzFlow hands over the whole selection at once, already sorted oldest-created
# first, with a job id allocated per order. The loop runs HERE rather than in the
# browser so a closed tab cannot strand the remaining orders, and so there is one
# place that knows the whole run is over and can trigger the summary email.
#
# Members go through the SAME single-order machinery, sequentially: one dealer
# session cannot drive two portal flows at once.
# ───────────────────────────────────────────────────────────────────────────
def _run_batch_job(batch_job_id: str, batch_id: str, jobs, dry_run: bool,
                   user_key: str, full_order: bool, do_pay: bool):
    """Background runner for a whole batch. One member at a time, never stopping
    on a failure."""
    from batch_runner import run_batch
    from order_to_payload import order_to_payload

    def _progress(index, job_id):
        with JOBS_LOCK:
            job = JOBS.get(batch_job_id)
            if job is None:
                return
            job["current_index"] = index
            job["current_job_id"] = job_id
            JOBS[batch_job_id] = job

    def _run_one(job_id, order):
        payload = order_to_payload(order)
        # Same stamping rule as the single route: the R2 prefix comes from the
        # AUTHENTICATED user, never from anything in the request body.
        if user_key and isinstance(payload.get("order_ref"), dict):
            payload["order_ref"]["user_id"] = user_key
        # Called inline, not in a thread: the batch thread IS the worker, and a
        # second thread per member would run two portal flows at once.
        #
        # notify_order_id is None on purpose — the batch summary covers these,
        # and a per-member email is what the summary exists to replace.
        _run_order_job(job_id, payload, dry_run, user_key,
                       full_order=full_order, do_pay=do_pay)

    with JOBS_LOCK:
        job = JOBS.get(batch_job_id, {})
        job.update(status="running", started_at=datetime.utcnow().isoformat())
        JOBS[batch_job_id] = job

    try:
        results = run_batch(jobs, _run_one, on_progress=_progress)
    except Exception as e:  # noqa: BLE001 — the batch itself must still close out
        results = []
        with JOBS_LOCK:
            job = JOBS.get(batch_job_id, {})
            job.update(error=str(e), error_kind="batch_unexpected")
            JOBS[batch_job_id] = job

    with JOBS_LOCK:
        job = JOBS.get(batch_job_id, {})
        job.update(
            status="done",
            finished_at=datetime.utcnow().isoformat(),
            results=results,
            current_index=None,
            current_job_id=None,
        )
        JOBS[batch_job_id] = job
        # Any member still `queued` never ran — only reachable if run_batch
        # itself died. Left as-is it would look in-flight forever and block the
        # next /orders call with JOB_IN_PROGRESS, so it is failed explicitly
        # rather than abandoned.
        for job_id, _order in jobs:
            member = JOBS.get(job_id)
            if member and member.get("status") == "queued":
                member.update(
                    status="error",
                    finished_at=datetime.utcnow().isoformat(),
                    error="The batch ended before this order ran.",
                    error_kind="batch_aborted",
                )
                JOBS[job_id] = member

    # BizzFlow re-derives every outcome from its own reconciliation, so `results`
    # here is a log of what ran, not the verdict. The event is what matters.
    _notify_bizzflow({"event": "batch_finished", "batchId": batch_id,
                      "results": results})


@app.post("/orders/batch")
def create_order_batch():
    """Start a batch of Order Entry runs (auth-gated, non-blocking).

    Body: {"batch_id", "user_key", "jobs": [{"jobId", "order"}, ...],
           "dry_run", "full_order", "do_pay"}

    `jobs` arrives ALREADY SORTED (oldest order first) and each `jobId` is
    allocated by BizzFlow — both are preserved here, never re-derived.

    Returns 202 {"batch_job_id"}. Poll GET /orders/batch/<id> for batch progress;
    each member stays pollable at GET /jobs/<jobId> exactly as a single submit is,
    so the existing per-order progress UI keeps working unchanged.
    """
    if not _order_entry_authorized(request):
        if not os.environ.get("ORDER_ENTRY_API_TOKEN"):
            return jsonify({"success": False, "error": "ORDER_ENTRY_DISABLED",
                            "message": "ORDER_ENTRY_API_TOKEN not configured on server."}), 503
        return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401

    from batch_runner import BatchRequestError, normalize_batch_jobs

    data = request.get_json(silent=True) or {}
    batch_id = data.get("batch_id")
    if not isinstance(batch_id, str) or not batch_id:
        return jsonify({"success": False, "error": "BATCH_ID_REQUIRED",
                        "message": "Body must include a `batch_id`."}), 400
    try:
        jobs = normalize_batch_jobs(data.get("jobs"))
    except BatchRequestError as e:
        return jsonify({"success": False, "error": "INVALID_JOBS", "message": str(e)}), 400

    user_key = data.get("user_key") or None
    dry_run = data.get("dry_run", True)
    if not isinstance(dry_run, bool):
        return jsonify({"success": False, "error": "INVALID_DRY_RUN",
                        "message": "`dry_run` must be a boolean."}), 400
    full_order = bool(data.get("full_order", False))
    do_pay = bool(data.get("do_pay", False))

    # Same single-browser rule as /orders. Registering every member as `queued`
    # up front is deliberate: it makes GET /jobs/<id> answer from the moment the
    # batch starts (BizzFlow has already written those ids onto its orders), and
    # it makes a lone /orders call correctly refuse while a batch is mid-run.
    with JOBS_LOCK:
        for job in JOBS.values():
            if job.get("status") in ("queued", "running"):
                return jsonify({"success": False, "error": "JOB_IN_PROGRESS",
                                "message": "The server can only run one browser job at a time."}), 409
        for job_id, _order in jobs:
            if job_id in JOBS:
                return jsonify({"success": False, "error": "JOB_ID_TAKEN",
                                "message": f"Job id {job_id} is already known."}), 409
        batch_job_id = uuid.uuid4().hex
        JOBS[batch_job_id] = {
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "params": {"dry_run": dry_run, "kind": "order_batch", "batch_id": batch_id,
                       "total": len(jobs)},
        }
        for job_id, _order in jobs:
            JOBS[job_id] = {
                "status": "queued",
                "created_at": datetime.utcnow().isoformat(),
                "params": {"dry_run": dry_run, "kind": "order_entry",
                           "batch_job_id": batch_job_id},
            }

    Thread(
        target=_run_batch_job,
        args=(batch_job_id, batch_id, jobs, dry_run, user_key, full_order, do_pay),
        daemon=True,
    ).start()
    return jsonify({"batch_job_id": batch_job_id, "status": "queued",
                    "total": len(jobs)}), 202


@app.get("/orders/batch/<batch_job_id>")
def batch_status(batch_job_id):
    """Progress of one batch, for BizzFlow's UI poll."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()
    with JOBS_LOCK:
        job = JOBS.get(batch_job_id)
        if not job or job.get("params", {}).get("kind") != "order_batch":
            return jsonify({"success": False, "error": "NOT_FOUND"}), 404
        return jsonify({
            "status": job.get("status"),
            "total": job.get("params", {}).get("total"),
            "current_index": job.get("current_index"),
            "current_job_id": job.get("current_job_id"),
            "results": job.get("results", []),
            "error": job.get("error"),
        })


# ───────────────────────────────────────────────────────────────────────────
# Interactive per-user dealer login (two-step OTP) — AUTH-GATED.
#
# BizzFlow calls these server-side to let each user connect their own Unifi
# dealer account. Step 1 (request-otp) fills staff code + password, picks the
# Email/SMS channel, and clicks GET; the browser stays open (held by
# dealer_login_service on a persistent loop). Step 2 (submit-otp) submits the
# user-typed OTP and saves that user's session. Same shared-secret gate as
# /orders — never open.
# ───────────────────────────────────────────────────────────────────────────
def _internal_unauthorized_response():
    """Shared 401/503 response for internal, secret-gated routes."""
    if not os.environ.get("ORDER_ENTRY_API_TOKEN"):
        return jsonify({"success": False, "error": "DEALER_LOGIN_DISABLED",
                        "message": "ORDER_ENTRY_API_TOKEN not configured on server."}), 503
    return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401


@app.post("/dealer/login/request-otp")
def dealer_request_otp():
    """Step 1: fill credentials + channel, click GET. Body: {staff_code,
    password, channel, user_key, registered_email}. registered_email (the
    dealer account's registered email, needed for auto-OTP's `to:` filter) is
    optional — omitting it just skips auto-read, no manual-flow regression.
    Returns {pending_id, expires_in, auto_otp}."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    staff_code = (data.get("staff_code") or "").strip()
    password = data.get("password") or ""
    channel = (data.get("channel") or "Email").strip()
    user_key = data.get("user_key") or "shared"
    registered_email = (data.get("registered_email") or "").strip()
    if not staff_code or not password:
        return jsonify({"success": False, "error": "STAFF_CODE_PASSWORD_REQUIRED",
                        "message": "staff_code and password are required."}), 400

    import dealer_login_service

    result = dealer_login_service.request_otp(
        staff_code, password, channel, user_key, registered_email
    )
    if result.get("error"):
        return jsonify({"success": False, **result}), 502
    return jsonify({"success": True, **result}), 200


@app.post("/dealer/login/submit-otp")
def dealer_submit_otp():
    """Step 2: submit the user-typed OTP. Body: {pending_id, otp}. Saves the
    per-user session on success."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    pending_id = (data.get("pending_id") or "").strip()
    otp = (data.get("otp") or "").strip()
    user_key = data.get("user_key") or None
    if not pending_id or not otp:
        return jsonify({"success": False, "error": "PENDING_ID_OTP_REQUIRED",
                        "message": "pending_id and otp are required."}), 400

    import dealer_login_service

    result = dealer_login_service.submit_otp(pending_id, otp, user_key)
    if result.get("error"):
        status = 404 if result["error"] == "pending_not_found" else 401
        return jsonify({"success": False, **result}), status
    return jsonify({"success": True, **result}), 200


@app.post("/dealer/login/check-now")
def dealer_check_now():
    """One-shot manual retry: look at the shared inbox right now instead of
    waiting out the rest of the auto-read window or typing the code by hand.
    Body: {pending_id, user_key}. Same success shape as submit-otp; "error":
    "not_found" specifically means try again shortly, not a hard failure."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    pending_id = (data.get("pending_id") or "").strip()
    user_key = data.get("user_key") or None
    if not pending_id:
        return jsonify({"success": False, "error": "PENDING_ID_REQUIRED",
                        "message": "pending_id is required."}), 400

    import dealer_login_service

    result = dealer_login_service.check_now(pending_id, user_key)
    if result.get("error"):
        status = 404 if result["error"] == "pending_not_found" else 200
        return jsonify({"success": False, **result}), status
    return jsonify({"success": True, **result}), 200


@app.post("/dealer/login/auto-status")
def dealer_auto_otp_status():
    """Poll an in-flight auto-OTP read (see dealer_login_service module
    docstring). Body: {pending_id, user_key}. Returns {status:
    pending|completed|timeout|error|not_applicable|not_found}.
    "not_applicable" means this login used the SMS channel (auto-read only
    ever applies to Email); the client should show the manual OTP form
    immediately instead of polling."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    pending_id = (data.get("pending_id") or "").strip()
    user_key = data.get("user_key") or None
    if not pending_id:
        return jsonify({"success": False, "error": "PENDING_ID_REQUIRED",
                        "message": "pending_id is required."}), 400

    import dealer_login_service

    return jsonify({"success": True, **dealer_login_service.auto_status(pending_id, user_key)}), 200


@app.post("/dealer/login/logout")
def dealer_logout():
    """Drop a user's saved dealer session (disconnect). Body: {user_key}.
    No portal round-trip — just deletes the local session file."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    user_key = data.get("user_key") or "shared"

    import dealer_login_service

    return jsonify({"success": True, **dealer_login_service.logout(user_key)}), 200


@app.post("/dealer/login/status")
def dealer_status():
    """Validate a user's saved session. Body: {user_key}. Returns {connected}."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    user_key = data.get("user_key") or "shared"

    import dealer_login_service

    return jsonify({"success": True, **dealer_login_service.check_status(user_key)}), 200


@app.post("/dealer/login/cancel")
def dealer_cancel():
    """Abandon a pending login and close its browser. Body: {pending_id}."""
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    pending_id = (data.get("pending_id") or "").strip()
    user_key = data.get("user_key") or None

    import dealer_login_service

    return jsonify({"success": True, **dealer_login_service.cancel(pending_id, user_key)}), 200


@app.post("/dealer/address-search")
def dealer_address_search():
    """Look up serviceable addresses via the portal's QryNIGAddress service, using
    the user's saved dealer session. Read-only — no order/customer is created.

    Headers: X-Internal-Token: <ORDER_ENTRY_API_TOKEN>
    Body: {user_key, state, value, query_by?}  (query_by: keyword|street|building|address_id)
    Returns {success, count, addresses:[{addressId, addressFull, serviceCategory, …}]}.
    """
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    user_key = (data.get("user_key") or "").strip()
    state = (data.get("state") or "").strip()
    value = (data.get("value") or "").strip()
    query_by = (data.get("query_by") or "keyword").strip()
    if not user_key or not state or not value:
        return jsonify({"success": False, "error": "MISSING_FIELDS",
                        "message": "user_key, state and value are required."}), 400

    import asyncio

    import dealer_login_service
    from dealer_address_search import search_address
    from order_entry import InfraError

    session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
    if not os.path.exists(session_path):
        return jsonify({"success": False, "error": "NOT_CONNECTED",
                        "message": "No dealer session for this user — connect first."}), 409
    try:
        result = asyncio.run(search_address(session_path, state, value, query_by))
    except InfraError as e:
        # Lost/expired session or browser failure — the user must reconnect.
        return jsonify({"success": False, "error": "SESSION_EXPIRED", "message": str(e)}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": "SEARCH_FAILED", "message": str(e)}), 500

    status = 200 if result.get("success") else 422
    return jsonify(result), status


@app.post("/dealer/feasibility-probe")
def dealer_feasibility_probe():
    """Ask the portal what it OFFERS at one address id, using the user's saved
    dealer session. Read-only — no customer profile and no order is created.

    This is the difference between "the address exists" (which
    /dealer/address-search answers) and "TM sells something here", which only a
    filled Subscription Plan List proves.

    Headers: X-Internal-Token: <ORDER_ENTRY_API_TOKEN>
    Body: {user_key, state, address_id}
    Returns {success, serviceable, offers:[...], matched, message}.
    """
    if not _order_entry_authorized(request):
        return _internal_unauthorized_response()

    data = request.get_json(silent=True) or {}
    user_key = (data.get("user_key") or "").strip()
    state = (data.get("state") or "").strip()
    address_id = str(data.get("address_id") or "").strip()
    if not user_key or not state or not address_id:
        return jsonify({"success": False, "error": "MISSING_FIELDS",
                        "message": "user_key, state and address_id are required."}), 400

    import asyncio

    import dealer_login_service
    from dealer_feasibility_probe import probe_offers
    from order_entry import InfraError

    session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
    if not os.path.exists(session_path):
        return jsonify({"success": False, "error": "NOT_CONNECTED",
                        "message": "No dealer session for this user — connect first."}), 409
    try:
        result = asyncio.run(probe_offers(session_path, state, address_id))
    except InfraError as e:
        return jsonify({"success": False, "error": "SESSION_EXPIRED", "message": str(e)}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"success": False, "error": "PROBE_FAILED", "message": str(e)}), 500

    status = 200 if result.get("success") else 422
    return jsonify(result), status


@app.get("/health/browser")
def health_browser():
    import asyncio

    from playwright.async_api import async_playwright

    async def _probe():
        async with async_playwright() as p:
            b = await p.chromium.launch(
                headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            c = await b.new_context()
            pg = await c.new_page()
            await pg.goto("https://example.com", timeout=20000)
            await b.close()

    try:
        asyncio.run(_probe())
        return {"ok": True, "message": "browser runnable"}
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500


if __name__ == "__main__":
    # Create necessary directories
    os.makedirs("config", exist_ok=True)
    os.makedirs("outputs", exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    os.makedirs("sessions", exist_ok=True)
    os.makedirs("jobs", exist_ok=True)

    print("🌍 Starting Unifi Scraper API (OPEN ACCESS)")
    print("🔓 No authorization required - accessible to everyone")
    print("📱 Telegram bots, external services, and local calls all welcome")

    # Run server
    app.run(host="0.0.0.0", port=5000, debug=False)

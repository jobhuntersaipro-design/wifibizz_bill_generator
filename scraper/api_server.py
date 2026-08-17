"""
Flask API server for open scraping - NO AUTHORIZATION
Accessible to everyone including Telegram bots and any external services
"""

import asyncio
import io
import json
import os
import time
import uuid
from collections import defaultdict
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from threading import Lock, Thread
from zoneinfo import ZoneInfo

from dotenv import find_dotenv, load_dotenv
from flask import Flask, jsonify, request, send_file

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

from credential_manager import CredentialManager

# The order-scraper + Google-Sheets endpoints have pre-existing broken/misplaced
# module deps in this checkout (date_utils is missing; gsheets_writer sits under
# scraper/sessions/). They aren't needed by the dealer-login endpoints, so don't
# let them take down the whole server — the scrape/sheets routes will simply
# error at call time until those modules are restored.
try:
    from scrape_orders import scrape_month, scrape_orders_month
except Exception as e:  # noqa: BLE001 - startup must survive a bad optional dep
    print(f"⚠️ scrape_orders unavailable ({e}); /scrape and /jobs disabled.")
    scrape_month = scrape_orders_month = None

try:
    from gsheets_writer import month_tab_title, open_sheet
except Exception as e:  # noqa: BLE001
    print(f"⚠️ gsheets_writer unavailable ({e}); summary endpoints disabled.")
    month_tab_title = open_sheet = None

scrape_locks = defaultdict(Lock)
app = Flask(__name__)

# Initialize credential manager
cred_manager = CredentialManager()


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
            "service": "Unifi Scraper API (Open Access)",
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


def _run_job(job_id: str, params: dict):
    """
    Background runner: captures stdout/stderr to a log file and
    calls the existing synchronous scrape_month().
    """
    log_path = os.path.join(_logs_dir(), f"{job_id}.log")
    with open(log_path, "w", buffering=1) as lf, redirect_stdout(lf), redirect_stderr(
        lf
    ):
        print(
            f"[{datetime.utcnow().isoformat()}] Job {job_id} started with params: {json.dumps(params)}"
        )
        with JOBS_LOCK:
            job = JOBS.get(job_id, {})
            job["status"] = "running"
            job["started_at"] = datetime.utcnow().isoformat()
            job["log_path"] = log_path
            JOBS[job_id] = job
        try:
            # Required params
            month_text = (
                params.get("month_text")
                or params.get("month")
                or params.get("monthText")
            )
            year = params.get("year")
            if not month_text or not year:
                raise ValueError("month_text and year are required")

            # Optional param: full_sync (default True to capture everything)
            full_sync = bool(params.get("full_sync", True))

            print(
                f"→ Calling scrape_month(month_text={month_text!r}, year={year!r}, full_sync={full_sync})"
            )
            result = scrape_month(
                month_text=str(month_text), year=int(year), full_sync=full_sync
            )
            print(
                f"[{datetime.utcnow().isoformat()}] scrape_month finished, result: {result}"
            )

            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job["status"] = "done"
                job["finished_at"] = datetime.utcnow().isoformat()
                job["result"] = result
                job["log_path"] = log_path
                JOBS[job_id] = job
        except Exception as e:
            print(f"[{datetime.utcnow().isoformat()}] ERROR: {e!r}")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job["status"] = "error"
                job["finished_at"] = datetime.utcnow().isoformat()
                job["error"] = str(e)
                job["log_path"] = log_path
                JOBS[job_id] = job


@app.post("/jobs")
def create_job():
    """
    Start a long-running scrape without blocking the HTTP connection.
    GLOBAL LOCK ENFORCED: Rejects new jobs if ANY job is running.
    """
    data = request.get_json(silent=True) or {}

    # --- NEW: GLOBAL LOCK CHECK ---
    with JOBS_LOCK:
        for jid, job in JOBS.items():
            # If any job is currently active, REJECT the new one
            if job.get("status") in ["queued", "running"]:

                # Get info about the running job to show in the error
                params = job.get("params", {})
                running_month = params.get("month_text") or params.get("month") or "?"
                running_year = params.get("year") or "?"

                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "JOB_IN_PROGRESS",
                            "message": f"⚠️ System is busy processing {running_month} {running_year}.\n\nThe server can only run one scraper at a time. Please wait until it finishes.",
                        }
                    ),
                    409,
                )
    # ------------------------------

    # If no jobs are running, proceed to create the new one
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "params": data,
        }

    t = Thread(target=_run_job, args=(job_id, data), daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "status": "queued"}), 202


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
                 "available_devices", "offered", "groups"}
    return {k: v for k, v in result.items() if k in safe_keys}


def _run_order_job(job_id: str, payload: dict, dry_run: bool, user_key: str = None,
                   stop_after_customer_fill: bool = False,
                   stop_after_customer_create: bool = False,
                   full_order: bool = False, do_pay: bool = False):
    """Background runner for enter_order()/enter_full_order(); logs to logs/<job_id>.log."""
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

    Thread(
        target=_run_order_job,
        args=(job_id, payload, dry_run, user_key, stop_after_customer_fill,
              stop_after_customer_create, full_order, do_pay),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id, "status": "queued", "dry_run": dry_run}), 202


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


@app.route("/scrape", methods=["POST"])
def scrape():
    """
    Main scraping endpoint - OPEN ACCESS
    Body: {
        "chat_id": "123456789",  // Optional - for logging/tracking only
        "month": "Oct",
        "year": 2025,
        "full_sync": true,  // true = capture all, false = incremental
        "output_format": "sheets"  // or "csv"
    }
    """
    try:
        data = request.get_json() or {}

        # Get parameters (chat_id is optional, just for logging)
        chat_id = data.get("chat_id", "anonymous")
        month_text = data.get("month", "Oct")
        year = int(data.get("year", 2025))
        full_sync = data.get("full_sync", False)
        output_format = data.get("output_format", "sheets")

        print(
            f"🔍 Scrape request from: {chat_id} | Mode: {'Full' if full_sync else 'Incremental'}"
        )

        # Check if credentials exist
        if not cred_manager.credentials_exist():
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "NO_CREDENTIALS",
                        "message": "No credentials saved. Please save credentials first.",
                    }
                ),
                400,
            )

        # Get credentials
        creds = cred_manager.get_credentials()
        if not creds:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "INVALID_CREDENTIALS",
                        "message": "Could not decrypt credentials.",
                    }
                ),
                400,
            )

        username = creds["username"]
        password = creds["password"]

        if not month_text or not year:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "MONTH_YEAR_REQUIRED",
                        "message": "Month and year are required.",
                    }
                ),
                400,
            )

        # Run scraper
        result = asyncio.run(
            scrape_orders_month(
                username,
                password,
                month_text,
                year,
                output_format,
                None,
                full_sync,
            )
        )

        return jsonify(result)

    except Exception as e:
        return (
            jsonify({"success": False, "error": str(e), "message": "Scraping failed"}),
            500,
        )


from collections import defaultdict
from threading import Lock

# Change from single lock to per-month locks
scrape_locks = defaultdict(Lock)  # Instead of: scrape_lock = Lock()


@app.route("/scrape_full", methods=["POST"])
def scrape_full():
    """
    Scrape full month (OPEN ACCESS)
    Per-month locking to allow concurrent scrapes of different months
    """
    data = request.json or {}
    month = data.get("month")
    year = data.get("year")

    if not month or not year:
        return jsonify({"success": False, "error": "month and year required"}), 400

    # Use per-month lock
    lock_key = f"{month}_{year}"
    acquired = scrape_locks[lock_key].acquire(blocking=False)

    if not acquired:
        return (
            jsonify(
                {
                    "success": False,
                    "error": "SCRAPE_IN_PROGRESS",
                    "message": f"Scrape for {month} {year} is already in progress. Please wait.",
                    "month": month,
                    "year": year,
                }
            ),
            429,
        )

    try:
        full_sync = data.get("full_sync", False)

        # Import here to avoid circular imports
        from scrape_orders import scrape_month

        # Run the scrape
        result = scrape_month(month, year, full_sync=full_sync)

        # Brief cleanup pause
        time.sleep(2)

        return jsonify(result)

    except Exception as e:
        print(f"❌ Error in scrape_full: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        # Always release the lock for this specific month
        scrape_locks[lock_key].release()


@app.route("/scrape_incremental", methods=["POST"])
def scrape_incremental():
    """
    Incremental sync mode - only new/updated orders (OPEN ACCESS)
    Body: {
        "chat_id": "123456789",  // Optional
        "month": "Oct",
        "year": 2025
    }
    """
    try:
        data = request.get_json() or {}
        data["full_sync"] = False  # Force incremental sync

        # Extract parameters
        chat_id = data.get("chat_id", "anonymous")
        month_text = data.get("month", "Oct")
        year = int(data.get("year", 2025))
        output_format = data.get("output_format", "sheets")

        print(
            f"🔍 Incremental scrape request from: {chat_id} | Month: {month_text} {year}"
        )

        # Check credentials
        if not cred_manager.credentials_exist():
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "NO_CREDENTIALS",
                        "message": "No credentials saved. Please save credentials first.",
                    }
                ),
                400,
            )

        creds = cred_manager.get_credentials()
        if not creds:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "INVALID_CREDENTIALS",
                        "message": "Could not decrypt credentials.",
                    }
                ),
                400,
            )

        username = creds["username"]
        password = creds["password"]

        # Run scraper with full_sync=False
        result = asyncio.run(
            scrape_orders_month(
                username,
                password,
                month_text,
                year,
                output_format,
                None,
                False,  # full_sync=False
            )
        )

        return jsonify(result)

    except Exception as e:
        return (
            jsonify(
                {
                    "success": False,
                    "error": str(e),
                    "message": "Incremental scraping failed",
                }
            ),
            500,
        )


@app.route("/save_credentials", methods=["POST"])
def save_credentials():
    """
    Save login credentials (OPEN ACCESS)
    Body: {
        "chat_id": "123456789",  // Optional - for logging only
        "username": "TMRS00517",
        "password": "your_password"
    }
    """
    try:
        data = request.get_json()

        chat_id = data.get("chat_id", "anonymous")
        username = data.get("username")
        password = data.get("password")

        print(f"💾 Credentials save request from: {chat_id}")

        if not username or not password:
            return (
                jsonify({"success": False, "error": "USERNAME_PASSWORD_REQUIRED"}),
                400,
            )

        # Save credentials
        cred_manager.save_credentials(username, password)

        return jsonify({"success": True, "message": "Credentials saved securely"})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/download_csv", methods=["GET"])
def download_csv():
    """
    Download CSV file (OPEN ACCESS)
    Query params: filename=unifi_orders_20251020_123456.csv
    """
    filename = request.args.get("filename")

    if not filename:
        return jsonify({"error": "filename required"}), 400

    filepath = f"outputs/{filename}"

    if not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    return send_file(filepath, as_attachment=True)


@app.get("/get_current_summary")
def get_current_summary():
    """
    Returns ONLY the current month summary (Asia/Kuala_Lumpur local time).
    {
      "month": "Nov", "year": 2025,
      "total": 123, "completed": 100, "cancelled": 10, "other": 13
    }
    """
    try:
        # Resolve current month in KL time
        now = datetime.now(ZoneInfo("Asia/Kuala_Lumpur"))
        month_short = now.strftime("%b")  # e.g., "Nov"
        year = now.year

        # Open Google Sheet and select "<Mon> <Year>" tab
        spread = open_sheet()
        tab_title = month_tab_title(month_short, year)
        ws = spread.worksheet(tab_title)

        # Count statuses (same logic you use post-scrape)
        completed = cancelled = other = total = 0
        rows = ws.get_all_values()
        for row in rows[1:]:  # skip header
            if not row or len(row) < 2:
                continue
            order_number = (row[0] or "").strip().lstrip("'")
            status = (row[1] or "").strip()
            if not order_number:
                continue
            total += 1
            s = status.lower()
            if s.startswith("completed"):
                completed += 1
            elif s.startswith("cancelled") or s.startswith("canceled"):
                cancelled += 1
            else:
                other += 1

        return jsonify(
            {
                "month": month_short,
                "year": year,
                "total": total,
                "completed": completed,
                "cancelled": cancelled,
                "other": other,
            }
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/status", methods=["GET"])
def status():
    """Get system status (OPEN ACCESS)"""

    creds_exist = cred_manager.credentials_exist()
    cookies_exist = os.path.exists("sessions/session_cache.json")

    # Get latest CSV info
    latest_csv = None
    if os.path.exists("outputs"):
        csv_files = [f for f in os.listdir("outputs") if f.endswith(".csv")]
        if csv_files:
            csv_files.sort(reverse=True)
            latest_csv = csv_files[0]

    return jsonify(
        {
            "credentials_saved": creds_exist,
            "session_active": cookies_exist,
            "latest_scrape": latest_csv,
            "timestamp": datetime.now().isoformat(),
            "version": "open_access_dual_mode",
            "authorization": "disabled - open to everyone",
        }
    )


@app.route("/test_date_comparison", methods=["GET"])
def test_date_comparison():
    """Test endpoint to check date comparison logic (OPEN ACCESS)"""
    try:
        from scrape_orders import (
            parse_last_synced,
            parse_ui_date,
            should_rescrape_order,
        )

        # Test data
        ui_date = "29 Oct 2025 11:27:31"
        last_synced = "2025-10-29T10:00:00"

        ui_dt = parse_ui_date(ui_date)
        last_synced_dt = parse_last_synced(last_synced)

        should_rescrape = (
            should_rescrape_order("test_order", ui_date, {"test_order": last_synced_dt})
            if last_synced_dt
            else True
        )

        return jsonify(
            {
                "ui_date": ui_date,
                "ui_parsed": ui_dt.isoformat() if ui_dt else None,
                "last_synced": last_synced,
                "last_synced_parsed": (
                    last_synced_dt.isoformat() if last_synced_dt else None
                ),
                "should_rescrape": should_rescrape,
                "comparison": (
                    "UI is newer"
                    if ui_dt and last_synced_dt and ui_dt > last_synced_dt
                    else "Last synced is newer or equal"
                ),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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


@app.route("/get_months", methods=["GET"])
def get_months():
    """
    Get all month tabs from Google Sheets (OPEN ACCESS)
    Returns list of months that exist in the sheet
    """
    try:
        from gsheets_writer import get_all_month_tabs, open_sheet

        spread = open_sheet()
        month_tabs = get_all_month_tabs(spread)

        # Parse month tabs into structured data
        months = []
        for tab in month_tabs:
            # Tab format: "Nov 2025" or "Nov"
            parts = tab.split()
            month = parts[0]
            year = int(parts[1]) if len(parts) > 1 else 2025
            months.append({"month": month, "year": year, "tab": tab})

        return jsonify({"success": True, "months": months, "count": len(months)})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/get_latest_summary", methods=["GET"])
def get_latest_summary():
    """
    Get summary for the latest month from today's scrape (OPEN ACCESS)
    Returns only the most recent month (e.g., Nov 2025)
    """
    try:
        import glob
        from datetime import datetime

        summary_dir = "outputs/summaries"

        # Get all summary files from today
        today_str = datetime.now().strftime("%Y%m%d")
        pattern = f"{summary_dir}/summary_{today_str}_*.json"
        files = glob.glob(pattern)

        if not files:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "NO_SUMMARY_TODAY",
                        "message": "No summary file found for today. Scraping may not have run yet.",
                    }
                ),
                404,
            )

        # Read all summaries and find the latest month
        latest_summary = None
        latest_date = (0, 0)  # (year, month)

        for file in files:
            try:
                with open(file, "r", encoding="utf-8") as f:
                    summary = json.load(f)

                    year = summary.get("year", 0)
                    month_name = summary.get("month", "")

                    # Convert month name to number
                    month_map = {
                        "Jan": 1,
                        "Feb": 2,
                        "Mar": 3,
                        "Apr": 4,
                        "May": 5,
                        "Jun": 6,
                        "Jul": 7,
                        "Aug": 8,
                        "Sep": 9,
                        "Oct": 10,
                        "Nov": 11,
                        "Dec": 12,
                    }
                    month_num = month_map.get(month_name, 0)

                    # Check if this is the latest
                    if (year, month_num) > latest_date:
                        latest_date = (year, month_num)
                        latest_summary = summary
            except:
                continue

        if not latest_summary:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "NO_VALID_SUMMARY",
                        "message": "Could not read summary files.",
                    }
                ),
                500,
            )

        return jsonify({"success": True, "summary": latest_summary})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


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

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
from datetime import datetime
from threading import Lock, Thread

from dotenv import find_dotenv, load_dotenv
from flask import Flask, jsonify, request

from job_logging import install as _install_job_logging, job_log
import live_view

# Route stdout/stderr per THREAD before anything can print. Every job used to
# swap the global sys.stdout for its own log file, which two concurrent runs
# corrupt for the whole process — see job_logging.
_install_job_logging()

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
        # Reaping here is deliberate: /health is polled every 10s by every open
        # Orders page, which makes it the most reliable clock this process has.
        # A wedged job therefore clears itself without anyone deploying.
        _reap_stale_jobs_locked()
        _evict_finished_jobs_locked()
        active, oldest = _active_jobs_locked()
        slots = len(_active_slot_jobs_locked())

    return jsonify(
        {
            "status": "healthy",
            # Unchanged meaning — deploy.sh reads this to decide whether work is
            # in flight, so it must keep counting every active job.
            "active_jobs": active,
            # Slots in use vs available, for the UI's "3 of 4 agents are
            # submitting". Bare numbers with no ids and no owner, which is what
            # keeps them safe on a route Caddy serves publicly.
            "slots_in_use": slots,
            "capacity": MAX_CONCURRENT_JOBS,
            # Bare seconds, no id and no owner — enough for the UI to say how
            # long Submit has been blocked and to call out a run that has
            # outlived any legal one, and safe on a publicly-served route.
            "oldest_active_age_s": int(oldest) if oldest is not None else None,
            "max_job_runtime_s": JOB_MAX_RUNTIME,
            "timestamp": datetime.now().isoformat(),
            "service": "BizzFlow order-entry API",
        }
    )


# ---- Minimal in-memory job registry ----
JOBS = (
    {}
)  # job_id -> {status, created_at, started_at, finished_at, params, result, error, log_path}
JOBS_LOCK = Lock()

# job_id -> (event loop, task) for a run that can still be cancelled.
#
# Deliberately NOT stored inside JOBS: `job_status` jsonifies that record
# wholesale, and an asyncio.Task in it would 500 every poll. Entries are removed
# by the run itself, so a finished job cannot be "cancelled" into a stale loop.
JOB_TASKS = {}

# ---- Stale-job reaping ----------------------------------------------------
#
# WHY THIS EXISTS. Nothing but the owning thread ever moves a job out of
# queued/running, so a thread that dies — or blocks somewhere the run's own
# asyncio.wait_for cannot reach — leaves an immortal entry. That entry holds the
# global single-browser lock, which greys out Submit for EVERY agent, and the
# only remedy was restarting this process (which deploy.sh itself refuses while
# active_jobs > 0). Live case, 2026-08-29: a blocking R2 download pinned the
# event loop, the 600s cap never fired, and one job held the lock for 6h40m.
#
# The reaper makes that self-healing: the lock can never be held longer than one
# job's legal lifetime plus a grace margin.

# The outer backstop, DERIVED from the per-run cap rather than fixed beside it.
# A single run is capped at OE_ORDER_TIMEOUT (600s full-flow), and that is
# overridable on the droplet — a hardcoded 1800 here would quietly start
# abandoning real, billable runs the day somebody raised it to an hour. Three
# times the cap leaves room for a run that is shutting down cleanly.
JOB_MAX_RUNTIME = int(os.environ.get(
    "OE_JOB_MAX_RUNTIME",
    max(1800, int(os.environ.get("OE_ORDER_TIMEOUT", "600")) * 3),
))

# A single submit flips queued -> running the moment its thread starts, so a
# lone job still queued after this never got a thread at all.
JOB_MAX_QUEUED = int(os.environ.get("OE_JOB_MAX_QUEUED", "180"))

# Per batch member, for the batch parent's own cap: members run one at a time,
# so a 10-order batch legitimately holds the lock far longer than one order.
JOB_BATCH_PER_MEMBER = int(os.environ.get("OE_JOB_BATCH_PER_MEMBER", "900"))

# ---- Capacity -------------------------------------------------------------
#
# Two levels, and they answer different questions.
#
#   per user  — fixed at 1, NOT configurable. Two runs for one agent would drive
#               the same sessions/dealer_<user>.json and the same portal login.
#               That is a correctness rule, not a resource one, so there is no
#               env var to get it wrong with.
#   global    — OE_MAX_CONCURRENT_JOBS, a machine limit: RAM and CPU for N
#               concurrent Chromiums (~700MB and ~1 vCPU each).
#
# DEFAULT 1 = today's behaviour exactly. Concurrency is raised by moving one
# environment variable and restarting, and rolled back the same way — never by
# shipping code. That matters because the untestable part of this (how the
# portal reacts to concurrent dealer sessions from one datacenter IP) can only
# be learned by ramping, and a variable can be walked back in a minute.
MAX_CONCURRENT_JOBS = int(os.environ.get("OE_MAX_CONCURRENT_JOBS", "1"))

# Every browser this box may run at once — order jobs AND pending dealer logins,
# which launch their own Chromium under dealer_login_service's MAX_CONCURRENT_LOGINS
# and would otherwise be a second, invisible budget: at N=4 that is 4 + 4 = 8
# browsers, ~5.6GB, over an 8GB box once the base load is counted.
#
# The default reproduces today's implicit ceiling (1 order + 4 logins), so
# nothing changes until it is set deliberately alongside N.
MAX_BROWSERS = int(os.environ.get("OE_MAX_BROWSERS", str(MAX_CONCURRENT_JOBS + 4)))

# Refuse a new job below this much available memory. Roughly one Chromium's
# working set, so the check means "there is room for the run you are asking
# for". Only applied when something is ALREADY running: on an idle box the
# honest answer to low memory is to try, not to refuse every submit forever.
MIN_FREE_MB = int(os.environ.get("OE_MIN_FREE_MB", "700"))

# How long a FINISHED job stays readable. BizzFlow polls a job for minutes, not
# days; keeping every result forever grows this dict for the process's whole
# life on a 1GB box.
JOB_RETAIN_S = int(os.environ.get("OE_JOB_RETAIN", "86400"))


def _parse_job_time(value):
    """Parse a job timestamp. They are written naive-UTC; stages append a Z."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.rstrip("Z"))
    except ValueError:
        return None


def _job_age_s(job, now=None):
    """Seconds since this job last provably moved, or None if unknowable.

    Prefers started_at over created_at: a batch member sits legitimately queued
    while earlier members run, so its creation time says nothing about it.
    """
    now = now or datetime.utcnow()
    at = _parse_job_time(job.get("started_at")) or _parse_job_time(job.get("created_at"))
    if at is None:
        return None
    return max(0.0, (now - at).total_seconds())


def _job_deadline_s(job):
    """The age past which this job cannot still be legitimately working."""
    params = job.get("params") or {}
    if job.get("status") == "queued":
        # A member waiting its turn inside a live batch is not stale, however
        # long it waits — the batch parent is the one under a clock, and the
        # batch runner closes its own members out when it ends.
        if params.get("batch_job_id"):
            return None
        return JOB_MAX_QUEUED
    if params.get("kind") == "order_batch":
        total = params.get("total")
        total = total if isinstance(total, int) and total > 0 else 1
        return max(JOB_MAX_RUNTIME, total * JOB_BATCH_PER_MEMBER)
    return JOB_MAX_RUNTIME


def _reap_stale_jobs_locked(now=None):
    """Finalize jobs that cannot still be running. CALLER MUST HOLD JOBS_LOCK.

    Returns the reaped ids. `abandoned` is its own error_kind so BizzFlow can
    tell "we lost track of this run" from "the portal refused it" — the two need
    different words in front of an agent, and only one of them means a real
    order may exist at Unifi.
    """
    now = now or datetime.utcnow()
    reaped = []
    for job_id, job in list(JOBS.items()):
        if job.get("status") not in ("queued", "running"):
            continue
        deadline = _job_deadline_s(job)
        if deadline is None:
            continue
        age = _job_age_s(job, now)
        if age is None or age < deadline:
            continue
        job.update(
            status="error",
            finished_at=now.isoformat(),
            error=(
                "This run stopped reporting and was abandoned after "
                f"{int(age // 60)} minutes. It may have reached the portal — "
                "check at Unifi before submitting again."
            ),
            error_kind="abandoned",
            abandoned_after_s=int(age),
        )
        JOBS[job_id] = job
        JOB_TASKS.pop(job_id, None)
        reaped.append(job_id)
    if reaped:
        print(f"[{now.isoformat()}] reaped {len(reaped)} stale job(s): {', '.join(reaped)}")
    return reaped


def _evict_finished_jobs_locked(now=None):
    """Drop long-finished jobs. CALLER MUST HOLD JOBS_LOCK.

    Only terminal jobs are ever evicted, so this can never free the lock — that
    is the reaper's job, and conflating the two would let a wedged run vanish
    silently instead of being reported as abandoned.
    """
    now = now or datetime.utcnow()
    dropped = 0
    for job_id, job in list(JOBS.items()):
        if job.get("status") in ("queued", "running"):
            continue
        at = _parse_job_time(job.get("finished_at"))
        if at is None or (now - at).total_seconds() < JOB_RETAIN_S:
            continue
        JOBS.pop(job_id, None)
        JOB_TASKS.pop(job_id, None)
        dropped += 1
    return dropped


def _active_jobs_locked(now=None):
    """(count, oldest age in seconds or None). CALLER MUST HOLD JOBS_LOCK."""
    now = now or datetime.utcnow()
    ages = [
        _job_age_s(job, now) or 0.0
        for job in JOBS.values()
        if job.get("status") in ("queued", "running")
    ]
    return len(ages), (max(ages) if ages else None)


def _active_slot_jobs_locked():
    """Active jobs that occupy a browser slot. CALLER MUST HOLD JOBS_LOCK.

    A batch MEMBER does not hold a slot — its parent holds the single slot for
    the whole run and the members execute inside it, one at a time. Counting
    them would put a 10-order batch instantly over any capacity and refuse
    everybody, including the batch itself.
    """
    return [
        job for job in JOBS.values()
        if job.get("status") in ("queued", "running")
        and not (job.get("params") or {}).get("batch_job_id")
    ]


def _capacity_refusal_locked(user_key):
    """Why this caller may not start a job right now, or None. HOLD JOBS_LOCK.

    Returns (http_status, body) so both routes refuse identically — a second
    copy of this rule is how the single submit and the batch would come to
    disagree about who is allowed to run.
    """
    for job in JOBS.values():
        if job.get("status") not in ("queued", "running"):
            continue
        if user_key and (job.get("params") or {}).get("user_key") == user_key:
            # Their own run, including one started in another browser on a
            # shared login. Named separately from capacity because it is a
            # different fact: it clears when THEIR run ends, not when a queue
            # drains.
            return 409, {"success": False, "error": "USER_JOB_IN_PROGRESS",
                         "message": "A submit is already running on this account. "
                                    "Wait for it to finish, then try again."}

    slots = len(_active_slot_jobs_locked())
    if slots >= MAX_CONCURRENT_JOBS:
        return 409, {"success": False, "error": "SERVER_AT_CAPACITY",
                     "message": f"All {MAX_CONCURRENT_JOBS} submit slots are busy. "
                                "Your turn shortly.",
                     "active": slots, "capacity": MAX_CONCURRENT_JOBS}

    if slots + _pending_login_count() >= MAX_BROWSERS:
        return 409, {"success": False, "error": "SERVER_AT_CAPACITY",
                     "message": "The server is at its browser limit. Try again shortly.",
                     "active": slots, "capacity": MAX_CONCURRENT_JOBS}

    # Last line of defence, and the only one grounded in reality rather than in
    # a number somebody typed into an env file. A Chromium that cannot get its
    # memory does not fail cleanly — it takes the box into swap and drags every
    # other run past its timeout with it, and a submit that times out mid-flight
    # strands a real minted order at Unifi.
    free_mb = _available_memory_mb()
    if free_mb is not None and slots > 0 and free_mb < MIN_FREE_MB:
        return 503, {"success": False, "error": "SERVER_LOW_MEMORY",
                     "message": "The server is low on memory. Try again shortly.",
                     "available_mb": int(free_mb)}
    return None


def _available_memory_mb():
    """Memory actually available, or None if it cannot be read.

    None means "do not judge" — refusing submits because a stat file could not
    be parsed would be a self-inflicted outage. `MemAvailable` is the right
    field: MemFree ignores reclaimable cache and reads far lower than the truth.
    """
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024
    except Exception:  # noqa: BLE001
        return None
    return None


def _pending_login_count():
    """How many dealer logins are holding a browser right now.

    Imported lazily and failing OPEN (0): a login-service import problem must
    not be able to refuse every submit on the box.
    """
    try:
        import dealer_login_service
        with dealer_login_service._PENDING_LOCK:
            return len(dealer_login_service._PENDING)
    except Exception:  # noqa: BLE001
        return 0


def _job_summary(job_id, job, now=None):
    """One row for GET /jobs — no customer data, so it is safe to list.

    Deliberately omits `result`, `stages` and `params` beyond the kind: those
    carry the customer's name and address, and this listing exists to answer
    "what is holding the lock", which needs none of it.
    """
    params = job.get("params") or {}
    return {
        "job_id": job_id,
        "kind": params.get("kind"),
        # Which agent holds this slot. A BizzFlow user id (a cuid), not a name or
        # an email — enough to answer "whose run is this?" without the listing
        # carrying personal data.
        "user_key": params.get("user_key"),
        "dry_run": params.get("dry_run"),
        "batch_job_id": params.get("batch_job_id"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "age_s": int(_job_age_s(job, now) or 0),
        "error_kind": job.get("error_kind"),
        "cancellable": job_id in JOB_TASKS,
    }



def _fail_job_now(job_id, message, kind="spawn_failed"):
    """Finalize a job that never got off the ground.

    The registry entry is written BEFORE the thread starts, and everything the
    thread does before it sets status="running" is outside the try/except that
    guarantees a terminal status. A failure in that window used to leave a job
    queued forever — holding the single-browser lock for every agent.
    """
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job.get("status") not in ("queued", "running"):
            return
        job.update(status="error", finished_at=datetime.utcnow().isoformat(),
                   error=message, error_kind=kind)
        JOBS[job_id] = job


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


@app.get("/jobs")
def jobs_list():
    """List every job this process knows about — the answer to "what is running?".

    Auth-gated like /orders. Without this there is no way to ask which job holds
    the single-browser lock: GET /jobs/<id> needs an id you already have, and a
    job whose owner never reported one leaves nothing to look up. That is what
    made the 2026-08-29 incident un-diagnosable from outside the box.

    Rows carry no customer data — see _job_summary.
    """
    if not _order_entry_authorized(request):
        if not os.environ.get("ORDER_ENTRY_API_TOKEN"):
            return jsonify({"success": False, "error": "ORDER_ENTRY_DISABLED",
                            "message": "ORDER_ENTRY_API_TOKEN not configured on server."}), 503
        return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401

    now = datetime.utcnow()
    with JOBS_LOCK:
        reaped = _reap_stale_jobs_locked(now)
        _evict_finished_jobs_locked(now)
        rows = [_job_summary(jid, job, now) for jid, job in JOBS.items()]
        active, oldest = _active_jobs_locked(now)
        slots = len(_active_slot_jobs_locked())

    # Newest first: the thing you came to look at is almost always the last one.
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return jsonify({
        "jobs": rows,
        "active_jobs": active,
        # Same fields /health carries, so a caller that needs the per-agent rows
        # does not have to make a second request for the numbers.
        "slots_in_use": slots,
        "capacity": MAX_CONCURRENT_JOBS,
        "max_job_runtime_s": JOB_MAX_RUNTIME,
        "oldest_active_age_s": int(oldest) if oldest is not None else None,
        "reaped": reaped,
    }), 200


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


@app.post("/jobs/<job_id>/cancel")
def job_cancel(job_id):
    """Stop a running job.

    Auth-gated exactly like /orders: this aborts a real, billable portal run.

    Cancels the run's asyncio task — the same mechanism the overall-timeout
    already uses, so the run's `finally` tears its browser down rather than
    leaking a headless_shell. The cancel is REQUESTED here and observed by the
    job thread, so a 202 means "asked", not "already stopped"; the caller learns
    the outcome from the job's own terminal state.
    """
    if not _order_entry_authorized(request):
        if not os.environ.get("ORDER_ENTRY_API_TOKEN"):
            return jsonify({"success": False, "error": "ORDER_ENTRY_DISABLED",
                            "message": "ORDER_ENTRY_API_TOKEN not configured on server."}), 503
        return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401

    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "unknown_job"}), 404
    if job.get("status") not in ("queued", "running"):
        return jsonify({"error": "not_running",
                        "message": "That job has already finished."}), 409

    handle = JOB_TASKS.get(job_id)
    if not handle:
        # Running, but not yet inside its loop (or already past it). Nothing to
        # cancel — reported rather than silently claimed as stopped, because the
        # caller decides what to write on the order from this answer.
        #
        # `?force=1` finalizes the record anyway. That is for the wedged case:
        # a job whose thread is gone or blocked somewhere the task cancel cannot
        # reach still holds the global single-browser lock, and before this the
        # ONLY way to release it was restarting the process — which deploy.sh
        # refuses while a job is active, and which kills any genuinely running
        # submit with it. Forcing does NOT stop whatever may still be executing,
        # so it says so rather than claiming the run was stopped.
        if request.args.get("force") not in ("1", "true", "yes"):
            return jsonify({"error": "not_cancellable",
                            "message": "That job cannot be stopped right now. "
                                       "Retry with ?force=1 to release the lock "
                                       "without stopping the run."}), 409
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "unknown_job"}), 404
            if job.get("status") not in ("queued", "running"):
                return jsonify({"error": "not_running",
                                "message": "That job has already finished."}), 409
            job.update(
                status="error",
                finished_at=datetime.utcnow().isoformat(),
                error="Force-released by an administrator because it had stopped "
                      "reporting. It may have reached the portal — check at Unifi "
                      "before submitting again.",
                error_kind="abandoned",
            )
            JOBS[job_id] = job
        print(f"[{datetime.utcnow().isoformat()}] job {job_id} FORCE-RELEASED")
        return jsonify({"job_id": job_id, "forced": True,
                        "message": "Lock released. The run itself was not stopped."}), 200

    loop, task = handle
    # The job runs its own loop on its own thread; touching the task from this
    # request thread is only safe through the loop.
    loop.call_soon_threadsafe(task.cancel)
    return jsonify({"job_id": job_id, "cancelling": True}), 202


@app.get("/jobs/<job_id>/log")
# NOT named job_log: this module imports the job_log context manager from
# job_logging at the top, and a route def with the same name silently
# rebinds it — every order run then called this ROUTE with a file path,
# and jsonify off-request raised "Working outside of application context",
# killing the submit before its log even opened.
def get_job_log(job_id):
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
                   notify_order_id: str = None, live_view: bool = False):
    """Guarded entry point for one order run.

    Everything the runner does before it sets status="running" — the imports,
    opening the log file — sits outside the try/except that guarantees a
    terminal status. A failure there left the job queued forever, holding the
    global single-browser lock for every agent.

    Catches BaseException, not Exception, on purpose: the observed live case
    produced NO traceback in the job log, which is what a BaseException escaping
    an `except Exception` chain looks like. The job is finalized either way, then
    the raise continues — run_batch records it as that member's failure, and a
    lone thread's stderr keeps its own trace.
    """
    try:
        _run_order_job_inner(
            job_id, payload, dry_run, user_key, stop_after_customer_fill,
            stop_after_customer_create, full_order, do_pay, notify_order_id,
            live_view=live_view,
        )
    except BaseException as e:
        _fail_job_now(
            job_id,
            f"The run stopped without reporting: {e!r}",
            kind="runner_died",
        )
        raise


def _run_order_job_inner(job_id: str, payload: dict, dry_run: bool, user_key: str = None,
                         stop_after_customer_fill: bool = False,
                         stop_after_customer_create: bool = False,
                         full_order: bool = False, do_pay: bool = False,
                         notify_order_id: str = None, live_view: bool = False):
    """Background runner for enter_order()/enter_full_order(); logs to logs/<job_id>.log.

    `notify_order_id` is BizzFlow's own Order id. When set, this job POSTs an
    `order_finished` event once it reaches a terminal state, which is what makes
    the result email arrive even though the browser tab is closed.

    Batch members pass None: the batch summary covers them, and one email per
    order inside a batch is exactly what the summary exists to avoid.

    `live_view` attaches the admin's watch-only screencast to this run (via
    `enter_full_order`'s `live_view_job_id`) and feeds it every stage
    milestone; default off, so an ordinary agent submit is unchanged.
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
                # Explicitly UTC. utcnow().isoformat() alone has no offset,
                # and JS Date() reads a bare timestamp as LOCAL time — which
                # would shift every step in the timeline by the viewer's
                # timezone.
                entry = {"name": name, "detail": detail,
                         "at": datetime.utcnow().isoformat() + "Z"}
                stages.append(entry)
                # Feeds a live viewer, if any. No-op for every other job.
                #
                # This function's own `live_view` PARAMETER shadows the
                # module-level `import live_view` for every closure defined
                # in its body (this one included), so the bare name `live_view`
                # here would resolve to a bool, not the module. Importing it
                # fresh under its own name sidesteps that shadow rather than
                # relying on the (shadowed) outer binding.
                try:
                    import live_view as _live_view_mod
                    _live_view_mod.publish_stage(job_id, entry)
                except Exception as e:
                    # publish_stage() is documented as never raising, but this
                    # step runs on EVERY stage of every order — a live view
                    # defect must never cost an order, so belt and suspenders.
                    print(f"  ⚠ live view: publish_stage failed ({type(e).__name__}: {e})", flush=True)
            JOBS[job_id] = job

    async def _cancellable():
        """Publish this run's loop + task, then do the work.

        Registered from INSIDE the coroutine so the handle is only ever
        published once the loop is actually running — a task captured before
        that could not be cancelled from another thread.
        """
        JOB_TASKS[job_id] = (asyncio.get_running_loop(), asyncio.current_task())
        try:
            return await _run_bounded()
        finally:
            JOB_TASKS.pop(job_id, None)

    async def _run_bounded():
        if full_order:
            from oe_feasibility import enter_full_order
            return await asyncio.wait_for(
                enter_full_order(payload, user_key=user_key, dry_run=dry_run,
                                 submit=True, do_pay=do_pay, on_stage=_set_stage,
                                 live_view_job_id=job_id if live_view else None),
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
    # NOT redirect_stdout: that swaps the process-global sys.stdout, and two
    # overlapping runs restore each other's file — leaving sys.stdout pointing at
    # a CLOSED one, after which every print in the process raises
    # ValueError('I/O operation on closed file.'). See job_logging for the full
    # sequence and the sixteen truncated job logs it produced.
    with job_log(log_path) as lf:
        print(f"[{datetime.utcnow().isoformat()}] Order job {job_id} started (dry_run={dry_run})")
        with JOBS_LOCK:
            job = JOBS.get(job_id, {})
            job.update(status="running", started_at=datetime.utcnow().isoformat(), log_path=log_path)
            JOBS[job_id] = job
        try:
            result = asyncio.run(_cancellable())
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
        except asyncio.CancelledError:
            # Somebody pressed Stop. The cancel propagated into the run, whose
            # `finally` tore the browser down — the same path the overall
            # timeout takes. Reported with its OWN error_kind so BizzFlow can
            # tell a deliberate stop from a failure: a stop must never be handed
            # back to the automatic retry.
            print(f"[{datetime.utcnow().isoformat()}] ORDER CANCELLED by request")
            with JOBS_LOCK:
                job = JOBS.get(job_id, {})
                job.update(
                    status="error",
                    finished_at=datetime.utcnow().isoformat(),
                    error="Stopped by the agent while it was running. The portal may already hold an order for this customer — check at Unifi before submitting again.",
                    error_kind="cancelled",
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
    # Admin's watch-only live view. Only a job created with this flag ever
    # attaches a screencast; an agent's run sends nothing and is unchanged.
    live_view_on = bool(data.get("live_view", False))
    # Catalogue discovery: drive the flow only as far as the device Offer dialog,
    # read the package's mandatory groups, and stop. It still MINTS AN ORDER —
    # the dialog does not exist before Order is clicked — so the caller is
    # responsible for flagging that order for voiding.
    if bool(data.get("discover_only", False)):
        payload["discover_only"] = True

    # Single-browser global lock — reject if any job (scrape or order) is active.
    with JOBS_LOCK:
        # Reap first: a job that cannot still be running must not be allowed to
        # refuse a real one.
        _reap_stale_jobs_locked()
        refusal = _capacity_refusal_locked(user_key)
        if refusal:
            status, body = refusal
            return jsonify(body), status
        job_id = uuid.uuid4().hex
        JOBS[job_id] = {
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            # user_key is recorded so the gate can be PER AGENT rather than
            # global: without it there is nothing in the registry to tell one
            # agent's run from another's.
            "params": {"dry_run": dry_run, "kind": "order_entry",
                       "user_key": user_key},
            "live_view": live_view_on,
        }

    # Report this run's completion to BizzFlow so the result email arrives with
    # the tab closed. Only for a REAL submit: a dry run places nothing, and
    # mailing an agent about it would train them to ignore the ones that count.
    notify_order_id = None
    if not dry_run and isinstance(payload.get("order_ref"), dict):
        notify_order_id = payload["order_ref"].get("order_id")

    try:
        Thread(
            target=_run_order_job,
            args=(job_id, payload, dry_run, user_key, stop_after_customer_fill,
                  stop_after_customer_create, full_order, do_pay, notify_order_id),
            kwargs={"live_view": live_view_on},
            daemon=True,
        ).start()
    except Exception as e:  # noqa: BLE001 — the entry is already registered
        # Without this the queued entry outlives the failure and blocks every
        # later submit as though the box were at capacity.
        _fail_job_now(job_id, f"Could not start the run: {e}")
        return jsonify({"success": False, "error": "SPAWN_FAILED",
                        "message": f"Could not start the run: {e}"}), 500
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
        # next /orders call as though the box were at capacity, so it is failed explicitly
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
        # Reap first: a job that cannot still be running must not be allowed to
        # refuse a real one.
        _reap_stale_jobs_locked()
        refusal = _capacity_refusal_locked(user_key)
        if refusal:
            status, body = refusal
            return jsonify(body), status
        for job_id, _order in jobs:
            if job_id in JOBS:
                return jsonify({"success": False, "error": "JOB_ID_TAKEN",
                                "message": f"Job id {job_id} is already known."}), 409
        batch_job_id = uuid.uuid4().hex
        JOBS[batch_job_id] = {
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
            "params": {"dry_run": dry_run, "kind": "order_batch", "batch_id": batch_id,
                       "total": len(jobs), "user_key": user_key},
        }
        for job_id, _order in jobs:
            JOBS[job_id] = {
                "status": "queued",
                "created_at": datetime.utcnow().isoformat(),
                "params": {"dry_run": dry_run, "kind": "order_entry",
                           "batch_job_id": batch_job_id, "user_key": user_key},
            }

    try:
        Thread(
            target=_run_batch_job,
            args=(batch_job_id, batch_id, jobs, dry_run, user_key, full_order, do_pay),
            daemon=True,
        ).start()
    except Exception as e:  # noqa: BLE001 — parent AND members are registered
        # Every member was registered queued up front, so all of them have to be
        # closed out here or they hold the lock forever.
        _fail_job_now(batch_job_id, f"Could not start the batch: {e}")
        for job_id, _order in jobs:
            _fail_job_now(job_id, "The batch never started.", kind="batch_aborted")
        return jsonify({"success": False, "error": "SPAWN_FAILED",
                        "message": f"Could not start the batch: {e}"}), 500
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


def _login_refusal(user_key):
    """Why this user may not start a dealer login right now, or None.

    Two separate reasons, and only the first is about capacity:

    1. **They have an order job in flight.** A fresh portal login on the same
       dealer account mid-run may invalidate the very session that run is
       driving, and because the portal mints the order number early, losing a
       run mid-flight strands a real order at Unifi. This is the one deliberate
       behaviour change at the default concurrency of 1.
    2. **The box is at its browser limit.** A login launches its own Chromium,
       so it draws from the same budget as order jobs — otherwise it is a second
       invisible pool and the RAM sizing is fiction.
    """
    with JOBS_LOCK:
        _reap_stale_jobs_locked()
        for job in JOBS.values():
            if job.get("status") not in ("queued", "running"):
                continue
            if user_key and (job.get("params") or {}).get("user_key") == user_key:
                return 409, {
                    "success": False, "error": "ORDER_JOB_IN_PROGRESS",
                    "message": "A submit is running on this account. Reconnecting now "
                               "could break it — wait for it to finish.",
                }
        slots = len(_active_slot_jobs_locked())
    if slots + _pending_login_count() >= MAX_BROWSERS:
        return 409, {"success": False, "error": "SERVER_AT_CAPACITY",
                     "message": "The server is at its browser limit. Try again shortly."}
    return None


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

    refusal = _login_refusal(user_key)
    if refusal:
        status, body = refusal
        return jsonify(body), status

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

    # Same rule as connecting, for the same reason: a run in flight is driving
    # this user's session. Deleting the file does not kill the live browser (the
    # cookies are already in memory), but the run's own reconnect logic and any
    # later step that re-reads the session would find nothing.
    with JOBS_LOCK:
        _reap_stale_jobs_locked()
        busy = any(
            job.get("status") in ("queued", "running")
            and (job.get("params") or {}).get("user_key") == user_key
            for job in JOBS.values()
        )
    if user_key and busy:
        return jsonify({"success": False, "error": "ORDER_JOB_IN_PROGRESS",
                        "message": "A submit is running on this account. Disconnecting "
                                   "now could break it — wait for it to finish, or stop "
                                   "the submit first."}), 409

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

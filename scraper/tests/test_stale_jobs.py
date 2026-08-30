"""
The stale-job reaper, the /jobs listing, and the force-release.

WHY THESE EXIST. On 2026-08-29 a job held the droplet's global single-browser
lock for 6h40m: a blocking R2 download pinned the event loop, so the run's own
asyncio.wait_for(600s) could never fire, and nothing else moves a job out of
`running`. Every agent's Submit was greyed out and the only remedy was
restarting the process — which deploy.sh refuses while a job is active.

These pin the three things that make that impossible to repeat: the lock frees
itself, somebody can ask what is holding it, and it can be released by hand
without a restart.

No portal and no browser — the registry is the whole subject.

Run:  scraper/venv/bin/python -m pytest tests/test_stale_jobs.py
"""

import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("ORDER_ENTRY_API_TOKEN", "test-token")

import api_server  # noqa: E402

AUTH = {"X-Internal-Token": os.environ["ORDER_ENTRY_API_TOKEN"]}


def _client():
    api_server.app.config["TESTING"] = True
    return api_server.app.test_client()


def _reset():
    with api_server.JOBS_LOCK:
        api_server.JOBS.clear()
    api_server.JOB_TASKS.clear()


def _ago(seconds):
    return (datetime.utcnow() - timedelta(seconds=seconds)).isoformat()


def _job(status="running", age_s=0, kind="order_entry", **extra):
    params = {"dry_run": False, "kind": kind}
    params.update(extra.pop("params", {}))
    job = {
        "status": status,
        "created_at": _ago(age_s),
        "params": params,
    }
    if status != "queued":
        job["started_at"] = _ago(age_s)
    job.update(extra)
    return job


# ── the lock frees itself ──────────────────────────────────────────────────

def test_running_job_past_the_cap_is_reaped():
    """The live case: running, far past any legal runtime, never reported again."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=6 * 3600)
    resp = _client().get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["active_jobs"] == 0
    job = api_server.JOBS["stuck"]
    assert job["status"] == "error"
    # Its own kind: BizzFlow must be able to tell "we lost track of this" from
    # "the portal refused it" — only one of them means an order may exist.
    assert job["error_kind"] == "abandoned"
    assert "check at Unifi" in job["error"]


def test_a_job_inside_its_cap_is_left_alone():
    """Reaping a run that is genuinely working would abandon a billable order."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job("running", age_s=120)
    assert _client().get("/health").get_json()["active_jobs"] == 1
    assert api_server.JOBS["working"]["status"] == "running"


def test_a_lone_queued_job_that_never_started_is_reaped():
    """A single submit flips to running at once; still queued = it got no thread."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["never_ran"] = _job("queued", age_s=api_server.JOB_MAX_QUEUED + 60)
    assert _client().get("/health").get_json()["active_jobs"] == 0
    assert api_server.JOBS["never_ran"]["error_kind"] == "abandoned"


def test_a_queued_batch_member_is_never_reaped_for_waiting():
    """Members run one at a time, so a long wait is correct, not stale.

    Reaping these would fail orders the batch is still going to run.
    """
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["member"] = _job(
            "queued", age_s=4 * 3600, params={"batch_job_id": "parent"})
    _client().get("/health")
    assert api_server.JOBS["member"]["status"] == "queued"


def test_a_running_batch_gets_a_cap_scaled_to_its_size():
    """A 10-order batch legitimately holds the lock far longer than one order."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["batch"] = _job(
            "running", age_s=40 * 60, kind="order_batch", params={"total": 10})
    assert _client().get("/health").get_json()["active_jobs"] == 1
    assert api_server.JOBS["batch"]["status"] == "running"


def test_a_stale_job_cannot_refuse_a_real_submit():
    """The point of the whole feature: the lock must not outlive the work.

    /orders reaps before it checks, so a wedged entry stops blocking every agent.
    The runner is stubbed out — this is about the gate, not about the run.
    """
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=6 * 3600)

    real = api_server._run_order_job
    api_server._run_order_job = lambda *a, **k: None
    try:
        resp = _client().post(
            "/orders",
            json={"payload": {"customer": {}}, "dry_run": True},
            headers=AUTH,
        )
    finally:
        api_server._run_order_job = real

    assert resp.status_code == 202, resp.get_data(as_text=True)
    assert api_server.JOBS["stuck"]["status"] == "error"


def test_a_genuinely_running_job_still_refuses_a_second_submit():
    """The single-browser rule is the reason the lock exists — reaping must not
    weaken it for a run that is actually working."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job("running", age_s=60)
    resp = _client().post(
        "/orders", json={"payload": {"customer": {}}, "dry_run": True}, headers=AUTH)
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "JOB_IN_PROGRESS"


# ── somebody can ask what is holding it ────────────────────────────────────

def test_health_reports_how_long_the_lock_has_been_held():
    """The UI needs an age to say more than an unbounded "please wait"."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job("running", age_s=300)
    body = _client().get("/health").get_json()
    assert body["active_jobs"] == 1
    assert 295 <= body["oldest_active_age_s"] <= 320
    assert body["max_job_runtime_s"] == api_server.JOB_MAX_RUNTIME


def test_health_reports_no_age_when_idle():
    _reset()
    body = _client().get("/health").get_json()
    assert body["active_jobs"] == 0
    assert body["oldest_active_age_s"] is None


def test_jobs_listing_names_the_job_holding_the_lock():
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job("running", age_s=90, stage="creating_customer")
    body = _client().get("/jobs", headers=AUTH).get_json()
    row = next(r for r in body["jobs"] if r["job_id"] == "working")
    assert row["status"] == "running"
    assert row["stage"] == "creating_customer"
    assert row["kind"] == "order_entry"
    assert row["age_s"] >= 85


def test_jobs_listing_carries_no_customer_data():
    """It answers "what is holding the lock", which needs no PII.

    `result` and `stages` carry the customer's name and address; a listing that
    leaked them would be a worse problem than the one it solves.
    """
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job(
            "running", age_s=10,
            result={"customer_name": "MUHAMMAD SAHINU BIN INSANU"},
            stages=[{"name": "creating_customer", "detail": "12 JALAN SECRET"}],
        )
    raw = _client().get("/jobs", headers=AUTH).get_data(as_text=True)
    assert "SAHINU" not in raw
    assert "JALAN SECRET" not in raw


def test_jobs_listing_requires_the_token():
    _reset()
    assert _client().get("/jobs").status_code == 401


# ── it can be released without a restart ───────────────────────────────────

def test_force_releases_a_job_with_no_task_handle():
    """Before this, the only way to free a wedged lock was restarting."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=60)
    resp = _client().post("/jobs/stuck/cancel?force=1", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json()["forced"] is True
    assert api_server.JOBS["stuck"]["status"] == "error"
    assert api_server.JOBS["stuck"]["error_kind"] == "abandoned"


def test_force_does_not_claim_the_run_was_stopped():
    """It releases a lock; it cannot reach a thread the task cancel could not."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=60)
    body = _client().post("/jobs/stuck/cancel?force=1", headers=AUTH).get_json()
    assert "not stopped" in body["message"]


def test_without_force_an_uncancellable_job_still_refuses():
    """The ordinary Stop path must keep reporting honestly."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=60)
    resp = _client().post("/jobs/stuck/cancel", headers=AUTH)
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "not_cancellable"
    assert api_server.JOBS["stuck"]["status"] == "running"


def test_force_requires_the_token():
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = _job("running", age_s=60)
    assert _client().post("/jobs/stuck/cancel?force=1").status_code == 401
    assert api_server.JOBS["stuck"]["status"] == "running"


# ── registry hygiene ───────────────────────────────────────────────────────

def test_long_finished_jobs_are_evicted():
    """JOBS otherwise grows for the process's whole life on a 1GB box."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["old"] = {
            "status": "done", "created_at": _ago(api_server.JOB_RETAIN_S + 600),
            "finished_at": _ago(api_server.JOB_RETAIN_S + 60), "params": {},
        }
        api_server.JOBS["recent"] = {
            "status": "done", "created_at": _ago(120),
            "finished_at": _ago(60), "params": {},
        }
    _client().get("/health")
    assert "old" not in api_server.JOBS
    assert "recent" in api_server.JOBS


def test_eviction_never_touches_an_active_job():
    """Evicting a running job would free the lock silently instead of reporting it."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["working"] = _job("running", age_s=60)
    _client().get("/health")
    assert api_server.JOBS["working"]["status"] == "running"


def test_a_job_with_unreadable_timestamps_is_left_alone():
    """Never reap on a guess — an unparseable time is not evidence of staleness."""
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["weird"] = {
            "status": "running", "created_at": "not-a-date", "params": {},
        }
    _client().get("/health")
    assert api_server.JOBS["weird"]["status"] == "running"


def test_the_reaper_cap_can_never_sit_below_the_per_run_cap():
    """The two must not be able to disagree.

    OE_ORDER_TIMEOUT is overridable on the droplet. A reaper cap fixed beside it
    would start abandoning real, billable runs the day somebody raised it — a
    silent misconfiguration whose symptom is lost orders.
    """
    per_run = int(os.environ.get("OE_ORDER_TIMEOUT", "600"))
    assert api_server.JOB_MAX_RUNTIME >= per_run * 3

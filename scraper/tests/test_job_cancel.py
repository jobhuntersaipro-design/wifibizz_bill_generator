"""
Stopping a running order job.

The interesting part is not the route's status codes but that a cancel really
reaches a run on ANOTHER thread with its own event loop, and that the run then
reports the stop as a stop — `error_kind="cancelled"` — rather than as a
failure. BizzFlow keys on that: a failure is handed to the automatic retry, and
a retry that undoes a deliberate stop is the one outcome this must never have.

No portal and no browser: the "run" is a sleep, which is exactly what a real run
looks like to the cancel — a coroutine parked on an await.

Run:  scraper/venv/bin/python -m pytest tests/test_job_cancel.py
"""

import asyncio
import os
import sys
import time
from threading import Thread

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


def _start_fake_run(job_id, seconds=30):
    """A job whose work is a long await — the shape a real portal step has.

    Registers itself in JOB_TASKS from inside its own loop, exactly as
    `_run_order_job` does, and records how it ended.
    """
    ended = {}

    def worker():
        async def main():
            api_server.JOB_TASKS[job_id] = (
                asyncio.get_running_loop(),
                asyncio.current_task(),
            )
            try:
                await asyncio.sleep(seconds)
                ended["how"] = "finished"
            finally:
                api_server.JOB_TASKS.pop(job_id, None)

        try:
            asyncio.run(main())
        except asyncio.CancelledError:
            ended["how"] = "cancelled"
            with api_server.JOBS_LOCK:
                job = api_server.JOBS.get(job_id, {})
                job.update(status="error", error_kind="cancelled",
                           error="Stopped by the agent while it was running.")
                api_server.JOBS[job_id] = job

    with api_server.JOBS_LOCK:
        api_server.JOBS[job_id] = {"status": "running",
                                   "params": {"kind": "order_entry"}}
    t = Thread(target=worker, daemon=True)
    t.start()
    # Wait for the run to publish its handle — a cancel before that is the case
    # the route answers with 409 not_cancellable, tested separately below.
    for _ in range(200):
        if job_id in api_server.JOB_TASKS:
            break
        time.sleep(0.01)
    return t, ended


def test_cancel_stops_a_running_job_and_files_it_as_stopped():
    _reset()
    thread, ended = _start_fake_run("j-run")
    res = _client().post("/jobs/j-run/cancel", headers=AUTH)
    assert res.status_code == 202, res.data
    assert res.get_json()["cancelling"] is True

    thread.join(timeout=5)
    assert not thread.is_alive(), "the run should have ended, not run its full sleep"
    # The point of the whole feature: it ended because it was stopped, and says
    # so in a way BizzFlow can tell apart from a failure.
    assert ended["how"] == "cancelled"
    assert api_server.JOBS["j-run"]["error_kind"] == "cancelled"
    # And the handle is gone, so a second cancel cannot reach a dead loop.
    assert "j-run" not in api_server.JOB_TASKS


def test_cancel_needs_the_token():
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["j-auth"] = {"status": "running",
                                     "params": {"kind": "order_entry"}}
    # Caddy serves this host on the open internet; aborting somebody's billable
    # portal run must not be reachable without the shared secret.
    res = _client().post("/jobs/j-auth/cancel")
    assert res.status_code == 401


def test_unknown_job_is_404_not_a_silent_success():
    _reset()
    res = _client().post("/jobs/nope/cancel", headers=AUTH)
    assert res.status_code == 404


def test_finished_job_refuses_rather_than_pretending_to_stop():
    _reset()
    with api_server.JOBS_LOCK:
        api_server.JOBS["j-done"] = {"status": "done",
                                     "params": {"kind": "order_entry"}}
    res = _client().post("/jobs/j-done/cancel", headers=AUTH)
    # 409, not 202: the caller writes "stopped" on the order from this answer,
    # and a run that already finished may have placed a real order.
    assert res.status_code == 409
    assert res.get_json()["error"] == "not_running"


def test_running_job_with_no_handle_reports_it_rather_than_claiming_a_stop():
    _reset()
    # Queued, or between threads — there is no task to cancel yet. Answering
    # 202 here would tell BizzFlow a run had been stopped that is about to start.
    with api_server.JOBS_LOCK:
        api_server.JOBS["j-early"] = {"status": "queued",
                                      "params": {"kind": "order_entry"}}
    res = _client().post("/jobs/j-early/cancel", headers=AUTH)
    assert res.status_code == 409
    assert res.get_json()["error"] == "not_cancellable"


def test_a_cancelled_job_record_still_serializes():
    """The handle must never land in JOBS itself.

    `job_status` jsonifies that record wholesale, so an asyncio.Task stored in
    it would 500 every poll — which is how BizzFlow reads the outcome.
    """
    _reset()
    thread, _ = _start_fake_run("j-json")
    res = _client().get("/jobs/j-json", headers=AUTH)
    assert res.status_code == 200, res.data
    _client().post("/jobs/j-json/cancel", headers=AUTH)
    thread.join(timeout=5)
    assert _client().get("/jobs/j-json", headers=AUTH).status_code == 200

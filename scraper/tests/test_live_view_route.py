"""GET /jobs/<id>/live — the stream, and the flag that turns it on.

Run from the scraper/ dir:  pytest tests/test_live_view_route.py
"""
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("ORDER_ENTRY_API_TOKEN", "test-token")
os.environ["LIVE_VIEW_ORIGIN"] = "https://bizzflow.example"

import api_server  # noqa: E402
import live_view  # noqa: E402
import oe_feasibility  # noqa: E402

AUTH = {"X-Internal-Token": os.environ["ORDER_ENTRY_API_TOKEN"]}
ORDER = {"customer": {"name": "T"}, "order_ref": {"order_id": "ord1", "attempt": 1}}


def _client():
    api_server.app.config["TESTING"] = True
    return api_server.app.test_client()


def _reset():
    with api_server.JOBS_LOCK:
        api_server.JOBS.clear()
    api_server.JOB_TASKS.clear()
    live_view._STORES.clear()
    live_view._VIEWERS[0] = 0


def test_live_view_flag_is_recorded_on_the_job(monkeypatch):
    _reset()
    seen = {}
    monkeypatch.setattr(api_server, "_run_order_job",
                        lambda *a, **kw: seen.update(kw) or None)
    c = _client()
    rv = c.post("/orders", json={"payload": ORDER, "dry_run": False, "full_order": True,
                                 "user_key": "u1", "live_view": True}, headers=AUTH)
    assert rv.status_code == 202
    job_id = rv.get_json()["job_id"]
    time.sleep(0.05)
    assert api_server.JOBS[job_id]["live_view"] is True
    assert seen.get("live_view") is True


def test_live_view_defaults_off_and_the_body_is_otherwise_unchanged(monkeypatch):
    _reset()
    seen = {}
    monkeypatch.setattr(api_server, "_run_order_job",
                        lambda *a, **kw: seen.update(kw) or None)
    c = _client()
    rv = c.post("/orders", json={"payload": ORDER, "dry_run": False, "full_order": True,
                                 "user_key": "u1"}, headers=AUTH)
    job_id = rv.get_json()["job_id"]
    time.sleep(0.05)
    assert api_server.JOBS[job_id].get("live_view") is False
    assert seen.get("live_view") is False


def _cleanup_job_log(job_id):
    log_path = os.path.join(api_server._logs_dir(), f"{job_id}.log")
    if os.path.exists(log_path):
        os.remove(log_path)


def test_stages_reach_live_view_on_a_live_run(monkeypatch):
    """Regression test for the _set_stage shadowing fix.

    _run_order_job_inner's own `live_view` PARAMETER shadows the module-level
    `import live_view` for every closure in its body, _set_stage included — so
    a bare `live_view.publish_stage(...)` there resolves the name to a bool,
    not the module, and raises AttributeError. _set_stage's own try/except
    then swallows that and prints a one-line warning: the feature goes
    silently dark with zero test failure unless a test actually drives the
    REAL runner (not a mock of it) through to a real live_view.publish_stage
    call, which is what this test — and its `live_view=False` control below —
    do. Neither test above this one reaches _set_stage at all: both
    monkeypatch _run_order_job itself, one call short of it.
    """
    _reset()
    job_id = "job-live-view-regression"
    # _set_stage reads JOBS[job_id] and returns early if it is absent — it has
    # to be pre-registered, the same as create_order registers it before the
    # run starts.
    with api_server.JOBS_LOCK:
        api_server.JOBS[job_id] = {
            "status": "queued",
            "params": {"dry_run": False, "kind": "order_entry", "user_key": "u1"},
            "live_view": True,
        }

    seen_live_view_job_id = {}

    async def fake_enter_full_order(payload, user_key=None, dry_run=False, submit=True,
                                    do_pay=False, on_stage=None, live_view_job_id=None):
        seen_live_view_job_id["value"] = live_view_job_id
        if on_stage:
            on_stage("creating_customer", "x")
        return {"status": "success", "order_id": "1"}

    # _run_bounded does `from oe_feasibility import enter_full_order` INSIDE
    # the coroutine, so patching the module attribute (rather than anything
    # api_server itself holds a reference to) is what the real call site sees.
    monkeypatch.setattr(oe_feasibility, "enter_full_order", fake_enter_full_order)

    published = []
    monkeypatch.setattr(live_view, "publish_stage",
                        lambda jid, entry: published.append((jid, entry)))

    try:
        api_server._run_order_job_inner(job_id, ORDER, False, "u1",
                                        full_order=True, live_view=True)
    finally:
        _cleanup_job_log(job_id)

    assert seen_live_view_job_id.get("value") == job_id
    assert published, "live_view.publish_stage was never called — the shadow bug is back"
    published_job_id, entry = published[-1]
    assert published_job_id == job_id
    assert entry["name"] == "creating_customer"


def test_live_view_off_passes_no_job_id_to_enter_full_order(monkeypatch):
    """Control for the test above: with live_view=False, enter_full_order gets
    live_view_job_id=None. Without this, the previous test alone would not
    distinguish "the flag actually gates this" from "the job id is always
    forwarded regardless"."""
    _reset()
    job_id = "job-live-view-off"
    with api_server.JOBS_LOCK:
        api_server.JOBS[job_id] = {
            "status": "queued",
            "params": {"dry_run": False, "kind": "order_entry", "user_key": "u1"},
            "live_view": False,
        }

    seen_live_view_job_id = {}

    async def fake_enter_full_order(payload, user_key=None, dry_run=False, submit=True,
                                    do_pay=False, on_stage=None, live_view_job_id=None):
        seen_live_view_job_id["value"] = live_view_job_id
        return {"status": "success", "order_id": "1"}

    monkeypatch.setattr(oe_feasibility, "enter_full_order", fake_enter_full_order)

    try:
        api_server._run_order_job_inner(job_id, ORDER, False, "u1",
                                        full_order=True, live_view=False)
    finally:
        _cleanup_job_log(job_id)

    assert seen_live_view_job_id.get("value") is None

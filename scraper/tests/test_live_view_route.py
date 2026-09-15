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

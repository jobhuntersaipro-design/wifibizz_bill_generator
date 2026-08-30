"""
Per-agent submit concurrency: the two-level capacity gate.

The lock used to be one job for the WHOLE droplet — an agent was refused because
somebody else was submitting, on a different dealer account, for a different
customer. It is now two rules with different jobs:

  per user  — fixed at 1. Two runs for one agent would drive the same
              sessions/dealer_<user>.json and the same portal login. A
              correctness rule, so there is no env var to get it wrong with.
  global    — OE_MAX_CONCURRENT_JOBS, a machine limit.

The load-bearing property pinned here is that **at the default of 1 the
behaviour is exactly what shipped**, so concurrency is raised by moving one
variable and rolled back the same way.

Run:  scraper/venv/bin/python -m pytest tests/test_capacity_gate.py
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


def _reset(capacity=1, browsers=None):
    with api_server.JOBS_LOCK:
        api_server.JOBS.clear()
    api_server.JOB_TASKS.clear()
    api_server.MAX_CONCURRENT_JOBS = capacity
    api_server.MAX_BROWSERS = browsers if browsers is not None else capacity + 4


def _job(user_key, status="running", age_s=5, **params):
    now = datetime.utcnow() - timedelta(seconds=age_s)
    p = {"dry_run": False, "kind": "order_entry", "user_key": user_key}
    p.update(params)
    return {"status": status, "created_at": now.isoformat(),
            "started_at": now.isoformat(), "params": p}


def _submit(user_key="agent-a"):
    real = api_server._run_order_job
    api_server._run_order_job = lambda *a, **k: None
    try:
        return _client().post(
            "/orders",
            json={"payload": {"customer": {}}, "dry_run": True, "user_key": user_key},
            headers=AUTH,
        )
    finally:
        api_server._run_order_job = real


# ── the per-user rule ──────────────────────────────────────────────────────

def test_an_agent_cannot_run_two_submits_at_once():
    """Both would drive the same dealer session file and the same portal login."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["theirs"] = _job("agent-a")
    resp = _submit("agent-a")
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "USER_JOB_IN_PROGRESS"


def test_a_different_agent_is_not_blocked():
    """The whole point: another agent's run is not this agent's problem."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["theirs"] = _job("agent-a")
    assert _submit("agent-b").status_code == 202


def test_the_per_user_rule_is_not_a_capacity_rule():
    """Distinct codes, because they clear on different events: one when YOUR run
    ends, the other when a queue drains. Collapsing them puts the old vague
    message back."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
        api_server.JOBS["b"] = _job("agent-b")
        api_server.JOBS["c"] = _job("agent-c")
        api_server.JOBS["d"] = _job("agent-d")
    # Capacity full, and this agent has nothing running.
    body = _submit("agent-e").get_json()
    assert body["error"] == "SERVER_AT_CAPACITY"
    assert body["active"] == 4 and body["capacity"] == 4


# ── the default is today's behaviour ───────────────────────────────────────

def test_at_capacity_one_any_running_job_blocks_everyone():
    """Ships inert: N=1 must behave exactly as the global lock did."""
    _reset(capacity=1)
    with api_server.JOBS_LOCK:
        api_server.JOBS["theirs"] = _job("agent-a")
    resp = _submit("agent-b")
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "SERVER_AT_CAPACITY"


def test_an_idle_server_accepts_a_submit_at_capacity_one():
    _reset(capacity=1)
    assert _submit("agent-a").status_code == 202


# ── batch slot accounting ──────────────────────────────────────────────────

def test_a_batch_holds_one_slot_not_one_per_member():
    """Members are registered `queued` up front and run sequentially inside the
    parent's slot. Counting them would put a 10-order batch instantly over
    capacity and refuse everybody — including the batch itself."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["parent"] = _job("agent-a", kind="order_batch", total=10)
        for i in range(10):
            api_server.JOBS[f"m{i}"] = _job(
                "agent-a", status="queued", batch_job_id="parent")
    # 11 active job records, but only ONE slot in use.
    with api_server.JOBS_LOCK:
        assert len(api_server._active_slot_jobs_locked()) == 1
    assert _submit("agent-b").status_code == 202


def test_a_batch_still_blocks_its_own_owner():
    """Its members are that agent's, so a lone submit by them must still refuse."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["parent"] = _job("agent-a", kind="order_batch", total=3)
    assert _submit("agent-a").get_json()["error"] == "USER_JOB_IN_PROGRESS"


# ── the shared browser budget ──────────────────────────────────────────────

def test_pending_logins_draw_from_the_same_budget(monkeypatch):
    """A login launches its own Chromium. Left in a separate pool it is an
    invisible second budget and the RAM sizing is fiction: at N=4 the worst case
    would be 4 + 4 = 8 browsers."""
    _reset(capacity=4, browsers=4)
    monkeypatch.setattr(api_server, "_pending_login_count", lambda: 3)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    # 1 order slot + 3 logins = 4 browsers = at the limit.
    assert _submit("agent-b").get_json()["error"] == "SERVER_AT_CAPACITY"


def test_a_broken_login_service_cannot_refuse_every_submit(monkeypatch):
    """Fails OPEN, counting zero.

    The login count is read by importing another module and taking its lock. If
    that can raise, an unrelated problem there becomes "no agent may submit" —
    a far bigger outage than the one it came from.
    """
    class Exploding:
        @property
        def _PENDING_LOCK(self):
            raise RuntimeError("login service exploded")

    monkeypatch.setitem(sys.modules, "dealer_login_service", Exploding())
    assert api_server._pending_login_count() == 0

    # And a submit still goes through rather than being refused on capacity.
    _reset(capacity=2)
    assert _submit("agent-a").status_code == 202


# ── the memory valve ───────────────────────────────────────────────────────

def test_low_memory_refuses_a_new_job(monkeypatch):
    """The only check grounded in the machine rather than in an env file."""
    _reset(capacity=4)
    monkeypatch.setattr(api_server, "_available_memory_mb", lambda: 100)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    resp = _submit("agent-b")
    assert resp.status_code == 503
    assert resp.get_json()["error"] == "SERVER_LOW_MEMORY"


def test_low_memory_never_refuses_on_an_idle_box(monkeypatch):
    """With nothing running, the honest answer to low memory is to try. Refusing
    would wedge the box permanently with no way back."""
    _reset(capacity=4)
    monkeypatch.setattr(api_server, "_available_memory_mb", lambda: 10)
    assert _submit("agent-a").status_code == 202


def test_unreadable_memory_is_never_treated_as_low(monkeypatch):
    """None means "do not judge" — refusing because a stat file would not parse
    is a self-inflicted outage."""
    _reset(capacity=4)
    monkeypatch.setattr(api_server, "_available_memory_mb", lambda: None)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    assert _submit("agent-b").status_code == 202


# ── health reports capacity ────────────────────────────────────────────────

def test_health_reports_slots_and_capacity():
    """So the UI can say "3 of 4" instead of an unbounded "please wait"."""
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
        api_server.JOBS["b"] = _job("agent-b")
    body = _client().get("/health").get_json()
    assert body["slots_in_use"] == 2
    assert body["capacity"] == 4
    # active_jobs keeps its old meaning — deploy.sh reads it.
    assert body["active_jobs"] == 2


def test_jobs_listing_names_which_agent_holds_a_slot():
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    row = next(r for r in _client().get("/jobs", headers=AUTH).get_json()["jobs"]
               if r["job_id"] == "a")
    assert row["user_key"] == "agent-a"


# ── the login guard ────────────────────────────────────────────────────────

def test_connecting_is_refused_before_the_login_service_is_even_reached(monkeypatch):
    """The guard must short-circuit, not merely undo a login that already ran."""
    class Boom:
        _PENDING_LOCK = __import__("threading").Lock()
        _PENDING = {}

        @staticmethod
        def request_otp(*a, **k):
            raise AssertionError("the login service must not be reached")

    monkeypatch.setitem(sys.modules, "dealer_login_service", Boom())
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    resp = _client().post("/dealer/login/request-otp", headers=AUTH,
                          json={"staff_code": "X", "password": "y", "user_key": "agent-a"})
    assert resp.status_code == 409


def test_connecting_is_refused_while_that_agent_has_a_run_in_flight(monkeypatch):
    """A fresh portal login mid-run may invalidate the session the run is
    driving, and the portal mints the order number early — so losing a run
    mid-flight strands a real order."""
    monkeypatch.setitem(sys.modules, "dealer_login_service", object())
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    resp = _client().post("/dealer/login/request-otp", headers=AUTH,
                          json={"staff_code": "X", "password": "y", "user_key": "agent-a"})
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "ORDER_JOB_IN_PROGRESS"


def test_another_agent_may_still_connect(monkeypatch):
    """The guard is per agent, so agent-b connecting during agent-a's run is fine.

    The login service is STUBBED: calling the real one drives a browser against
    the live Unifi portal, which a unit suite must never do.
    """
    class Stub:
        _PENDING_LOCK = __import__("threading").Lock()
        _PENDING = {}

        @staticmethod
        def request_otp(*a, **k):
            return {"pending_id": "stub", "expires_in": 300, "auto_otp": False}

    monkeypatch.setitem(sys.modules, "dealer_login_service", Stub())
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    resp = _client().post("/dealer/login/request-otp", headers=AUTH,
                          json={"staff_code": "X", "password": "y", "user_key": "agent-b"})
    assert resp.status_code == 200
    assert resp.get_json()["pending_id"] == "stub"


def test_disconnecting_is_refused_while_a_run_is_in_flight():
    _reset(capacity=4)
    with api_server.JOBS_LOCK:
        api_server.JOBS["a"] = _job("agent-a")
    resp = _client().post("/dealer/login/logout", headers=AUTH,
                          json={"user_key": "agent-a"})
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "ORDER_JOB_IN_PROGRESS"


def test_disconnecting_is_allowed_when_nothing_is_running():
    _reset(capacity=4)
    resp = _client().post("/dealer/login/logout", headers=AUTH,
                          json={"user_key": "agent-a"})
    assert resp.status_code == 200


def test_a_stale_job_does_not_block_a_login_forever():
    """The reaper runs inside the guard, so a wedged job cannot lock an agent
    out of reconnecting — which would be worse than the bug it came from."""
    _reset(capacity=4)
    old = datetime.utcnow() - timedelta(hours=6)
    with api_server.JOBS_LOCK:
        api_server.JOBS["stuck"] = {
            "status": "running", "created_at": old.isoformat(),
            "started_at": old.isoformat(),
            "params": {"kind": "order_entry", "user_key": "agent-a"},
        }
    resp = _client().post("/dealer/login/logout", headers=AUTH,
                          json={"user_key": "agent-a"})
    assert resp.status_code == 200
    assert api_server.JOBS["stuck"]["status"] == "error"

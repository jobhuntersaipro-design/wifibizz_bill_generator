"""The name `job_log` in api_server must be job_logging's context manager.

The live 2026-09-02 failure: api_server imported `job_log` (the per-job log
context manager) at the top, but its own route `GET /jobs/<id>/log` was ALSO
named `job_log` — a later `def` silently rebinds the module-level name. Every
order run then called the ROUTE with a log-file path, whose `jsonify` off-request
raised RuntimeError('Working outside of application context.') before the job
log even opened, and every submit died as "The run stopped without reporting".

These tests fail on the shadowed code and pin both halves: the name identity,
and that using it the way the runner does actually yields a working log file.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api_server
import job_logging


def test_job_log_is_the_context_manager_not_the_route():
    assert api_server.job_log is job_logging.job_log, (
        "api_server.job_log has been rebound — a def (likely a Flask route) "
        "shadows the imported context manager, which kills every order run"
    )


def test_job_log_opens_a_log_file_off_any_flask_context():
    # Exactly what _run_order_job_inner does, on a plain thread's stack:
    # no request context, no app context. Must not raise, must write the file.
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "somejob.log")
        with api_server.job_log(path):
            print("order job started")
        with open(path) as f:
            assert "order job started" in f.read()


def test_log_route_still_registered():
    # The rename must not cost the route itself.
    rules = {r.rule for r in api_server.app.url_map.iter_rules()}
    assert "/jobs/<job_id>/log" in rules

"""
The batch loop and the completion webhook.

Both rules tested here were learned expensively. The batch used to run in the
browser tab, so a closed tab left the remaining drafts unsubmitted with nobody
told; and a webhook that raised on a failed delivery would have made a finished
batch look like a failed one.

No portal, no Flask, no network — `run_batch` takes the worker as a callable and
`post_webhook` takes the sender as one, which is the whole reason these can be
exercised without minting a real, chargeable order.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from batch_runner import (  # noqa: E402
    BatchRequestError,
    normalize_batch_jobs,
    post_webhook,
    run_batch,
)


# ── normalize_batch_jobs ────────────────────────────────────────────────────
def test_preserves_the_order_it_was_given():
    # BizzFlow sorts by order creation time before sending. The droplet's only
    # job is to preserve that — two sorters would eventually disagree and the
    # agent would have no way to predict which one won.
    raw = [
        {"jobId": "j3", "order": {"id": "c"}},
        {"jobId": "j1", "order": {"id": "a"}},
        {"jobId": "j2", "order": {"id": "b"}},
    ]
    assert [j for j, _ in normalize_batch_jobs(raw)] == ["j3", "j1", "j2"]


def test_accepts_snake_case_job_id():
    assert normalize_batch_jobs([{"job_id": "j1", "order": {}}])[0][0] == "j1"


@pytest.mark.parametrize(
    "raw",
    [
        [],
        None,
        "jobs",
        [{"order": {}}],                      # no job id
        [{"jobId": "j1"}],                    # no order
        [{"jobId": "", "order": {}}],         # blank job id
        [{"jobId": "j1", "order": "nope"}],   # order is not an object
        ["not-an-object"],
    ],
)
def test_rejects_an_unusable_body(raw):
    with pytest.raises(BatchRequestError):
        normalize_batch_jobs(raw)


def test_rejects_a_repeated_job_id():
    # Two orders sharing one JOBS entry means the second overwrites the first's
    # result, and one order reports the other's outcome.
    with pytest.raises(BatchRequestError):
        normalize_batch_jobs([
            {"jobId": "same", "order": {"id": "a"}},
            {"jobId": "same", "order": {"id": "b"}},
        ])


# ── run_batch ───────────────────────────────────────────────────────────────
def _jobs(n):
    return [(f"j{i}", {"id": f"ord_{i}"}) for i in range(n)]


def test_runs_every_job_in_order():
    seen = []
    results = run_batch(_jobs(3), lambda job_id, order: seen.append(job_id))
    assert seen == ["j0", "j1", "j2"]
    assert [r["job_id"] for r in results] == ["j0", "j1", "j2"]
    assert all(r["error"] is None for r in results)


def test_a_failing_order_never_stops_the_batch():
    # The requirement in one line: "if the 1st order failed, move on to the 2nd".
    seen = []

    def run_one(job_id, order):
        seen.append(job_id)
        if job_id == "j0":
            raise RuntimeError("portal said no")

    results = run_batch(_jobs(3), run_one)
    assert seen == ["j0", "j1", "j2"]
    assert "portal said no" in results[0]["error"]
    assert results[1]["error"] is None and results[2]["error"] is None


def test_carries_the_bizzflow_order_id_into_the_result():
    # The receiver matches a result back to a row by THIS, not by the job id: a
    # finished poll has already cleared the job id off the order.
    results = run_batch(_jobs(2), lambda *_: None)
    assert [r["order_id"] for r in results] == ["ord_0", "ord_1"]


def test_reports_progress_before_each_job_starts():
    progress = []
    run_batch(_jobs(3), lambda *_: None, on_progress=lambda i, j: progress.append((i, j)))
    assert progress == [(0, "j0"), (1, "j1"), (2, "j2")]


def test_an_empty_batch_is_not_an_error():
    assert run_batch([], lambda *_: None) == []


# ── post_webhook ────────────────────────────────────────────────────────────
def _recorder(statuses):
    """A sender returning each status in turn, recording what it was asked."""
    calls = []

    def send(url, headers, body):
        calls.append((url, headers, body))
        value = statuses[min(len(calls) - 1, len(statuses) - 1)]
        if isinstance(value, Exception):
            raise value
        return value

    return send, calls


def test_sends_once_when_the_first_attempt_succeeds():
    send, calls = _recorder([200])
    assert post_webhook("http://app/hook", "s3cr3t", {"event": "batch_finished"}, send) is True
    assert len(calls) == 1
    assert calls[0][1]["Authorization"] == "Bearer s3cr3t"


def test_retries_a_server_error_and_succeeds():
    send, calls = _recorder([500, 500, 202])
    assert post_webhook("http://app/hook", "s", {"event": "x"}, send, sleep=lambda _: None) is True
    assert len(calls) == 3


def test_gives_up_cleanly_after_three_attempts():
    # Losing the event costs the email, not the results — BizzFlow's own polling
    # still reconciles every member. Raising here would turn a finished batch
    # into a crash in the thread that just finished it.
    send, calls = _recorder([500])
    assert post_webhook("http://app/hook", "s", {"event": "x"}, send, sleep=lambda _: None) is False
    assert len(calls) == 3


def test_retries_a_thrown_network_error_too():
    send, calls = _recorder([ConnectionError("dns"), 200])
    assert post_webhook("http://app/hook", "s", {"event": "x"}, send, sleep=lambda _: None) is True
    assert len(calls) == 2


def test_a_401_is_retried_but_never_succeeds():
    send, calls = _recorder([401])
    assert post_webhook("http://app/hook", "s", {"event": "x"}, send, sleep=lambda _: None) is False
    assert len(calls) == 3


def test_backs_off_between_attempts_rather_than_hammering():
    slept = []
    send, _ = _recorder([500])
    post_webhook("http://app/hook", "s", {"event": "x"}, send, sleep=slept.append)
    # Two waits for three attempts — never one after the last, which would just
    # delay the thread for nothing.
    assert slept == [2, 6]


def test_does_nothing_without_a_url_or_a_secret():
    # An unconfigured environment must not post an unauthenticated event.
    send, calls = _recorder([200])
    assert post_webhook(None, "s", {"event": "x"}, send) is False
    assert post_webhook("http://app/hook", None, {"event": "x"}, send) is False
    assert post_webhook("", "", {"event": "x"}, send) is False
    assert calls == []

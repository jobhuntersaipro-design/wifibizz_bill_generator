"""
Running a batch of order submits, and telling BizzFlow when a run finishes.

Everything here is deliberately free of Flask, Playwright and the portal: the
batch loop takes a `run_one` callable, and the webhook sender takes a `send`
callable. That is what lets the two rules that actually matter be tested without
minting a real, chargeable order:

  * a failing order NEVER stops the batch, and
  * the orders run in the order they were given, oldest-created first.

Both were learned the expensive way. The old loop lived in the browser tab, so a
closed tab left the remaining drafts unsubmitted with nobody told.
"""

import time


class BatchRequestError(ValueError):
    """The batch request body was unusable. Carries a message for the caller."""


def normalize_batch_jobs(raw):
    """Validate the `jobs` list from a POST /orders/batch body.

    Returns [(job_id, order_dict), ...] IN THE ORDER GIVEN. BizzFlow sorts by
    order creation time before sending; the droplet's only job is to preserve
    that order, never to re-sort — two sorters would eventually disagree and the
    agent would have no way to predict which won.

    Every job id is allocated by BizzFlow, not here, so `Order.jobId` is already
    written before the batch starts and every existing per-order poll works on a
    batch member unchanged.
    """
    if not isinstance(raw, list) or not raw:
        raise BatchRequestError("`jobs` must be a non-empty list.")

    jobs = []
    seen = set()
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise BatchRequestError(f"jobs[{i}] must be an object.")
        job_id = entry.get("jobId") or entry.get("job_id")
        order = entry.get("order")
        if not isinstance(job_id, str) or not job_id:
            raise BatchRequestError(f"jobs[{i}] is missing a `jobId`.")
        if not isinstance(order, dict):
            raise BatchRequestError(f"jobs[{i}] is missing an `order` object.")
        # A duplicate id would make two orders share one JOBS entry, so the
        # second would overwrite the first's result and one order would report
        # the other's outcome.
        if job_id in seen:
            raise BatchRequestError(f"jobs[{i}] repeats job id {job_id}.")
        seen.add(job_id)
        jobs.append((job_id, order))
    return jobs


def run_batch(jobs, run_one, on_progress=None):
    """Run each job in turn and return one result row per job.

    `run_one(job_id, order)` does the real work (in the service, that is the
    existing single-order machinery, so a batch member behaves exactly like a
    lone submit). Anything it raises is recorded against THAT job and the loop
    moves on — nothing short-circuits the batch.

    A dead dealer session is the case worth naming: every remaining order will
    fail identically. They are still each attempted, because "we stopped early
    because we assumed" is a worse thing to explain than a few wasted minutes,
    and because a session can come back. Revisit only if live use shows it costs
    real time.
    """
    results = []
    for index, (job_id, order) in enumerate(jobs):
        if on_progress:
            on_progress(index, job_id)
        started = time.time()
        try:
            run_one(job_id, order)
            error = None
        except Exception as e:  # noqa: BLE001 — one order's failure is data, not a crash
            error = repr(e)
        results.append({
            "index": index,
            "job_id": job_id,
            # BizzFlow's own order id, so the webhook receiver can match a result
            # back to a row without depending on the job id, which a finished
            # poll has already cleared off the order.
            "order_id": order.get("id"),
            "error": error,
            "duration_ms": int((time.time() - started) * 1000),
        })
    return results


def post_webhook(url, secret, body, send, attempts=3, sleep=time.sleep):
    """Deliver one completion event to BizzFlow, retrying a few times.

    `send(url, headers, body)` returns an HTTP status code or raises. Anything
    other than a 2xx is retried with a widening backoff, and after the last
    attempt this gives up and returns False rather than raising: the run itself
    already finished, and a failed notification must never be able to look like
    a failed order.

    Losing the event costs the email, not the results — BizzFlow's own polling
    still reconciles every member, and a batch left with `notified_at IS NULL`
    is how a lost delivery stays visible.
    """
    if not url or not secret:
        return False
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {secret}",
    }
    for attempt in range(attempts):
        try:
            status = send(url, headers, body)
            if isinstance(status, int) and 200 <= status < 300:
                return True
            reason = f"HTTP {status}"
        except Exception as e:  # noqa: BLE001
            reason = repr(e)
        print(f"[webhook] {body.get('event')} delivery {attempt + 1}/{attempts} failed: {reason}")
        if attempt < attempts - 1:
            # 2s, 6s — long enough for a Vercel cold start, short enough that a
            # finished batch is reported while the agent is still watching.
            sleep(2 * (3 ** attempt))
    return False

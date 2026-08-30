"""
The R2 attachment download cannot hang a submit any more.

WHY THIS EXISTS. `enter_full_order` downloads the order's documents from R2
before it emits its first stage, and that call was blocking boto3 made directly
inside the coroutine. On 2026-08-29 one such download stalled: with the event
loop blocked, the run's own `asyncio.wait_for(..., timeout=600)` could never
fire, so the job stayed `running` with no stage, no error and no traceback —
holding the droplet's single-browser lock for 6h40m.

Two independent guarantees are pinned here:
  1. the client is built with real timeouts and a retry cap, so one call is
     bounded, and download_many is bounded as a whole however many keys it gets;
  2. a blocking download is awaited off the loop, so the loop keeps running and
     an outer wait_for can still fire. That second one is the load-bearing part:
     it is what turns a hang into a reported timeout instead of an immortal job.

Run:  scraper/venv/bin/python -m pytest tests/test_r2_download_bounded.py
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import r2_download  # noqa: E402


def test_client_config_is_bounded():
    """An unbounded client is what made the stall possible in the first place."""
    os.environ.setdefault("R2_ACCOUNT_ID", "test-account")
    os.environ.setdefault("R2_ACCESS_KEY_ID", "test-key")
    os.environ.setdefault("R2_SECRET_ACCESS_KEY", "test-secret")
    r2_download._client = None
    cfg = r2_download._r2().meta.config
    assert cfg.connect_timeout == r2_download.R2_CONNECT_TIMEOUT
    assert cfg.read_timeout == r2_download.R2_READ_TIMEOUT
    # botocore normalises max_attempts=N into total_max_attempts=N+1 (N is
    # RETRIES, not tries). Asserted in its resolved form so the real ceiling is
    # visible: 4 tries x R2_READ_TIMEOUT is the worst case for ONE key, which is
    # why download_many also carries a budget for the whole list.
    assert cfg.retries["total_max_attempts"] == r2_download.R2_MAX_ATTEMPTS + 1
    assert cfg.retries["total_max_attempts"] <= 5
    # Every value must actually be finite — a None here reads as "configured"
    # while behaving exactly like the version that hung.
    assert cfg.connect_timeout and cfg.read_timeout
    r2_download._client = None


def test_download_many_stops_at_its_budget(monkeypatch):
    """The per-request timeouts bound ONE call; N keys multiply them."""
    attempted = []

    def slow(key, dest_dir=None):
        attempted.append(key)
        time.sleep(0.05)
        raise RuntimeError("nope")

    monkeypatch.setattr(r2_download, "download_r2_object", slow)
    r2_download.download_many(["a", "b", "c", "d", "e"], dest_dir="/tmp", budget_s=0.12)
    # It gave up partway rather than working through the whole list.
    assert 0 < len(attempted) < 5


def test_download_many_skips_a_bad_key_and_keeps_the_rest(monkeypatch):
    """A missing document is recoverable; losing the whole submit is not."""
    def one_bad(key, dest_dir=None):
        if key == "bad":
            raise RuntimeError("missing")
        return f"/tmp/{key}"

    monkeypatch.setattr(r2_download, "download_r2_object", one_bad)
    paths = r2_download.download_many(["good1", "bad", "good2"], dest_dir="/tmp")
    assert paths == ["/tmp/good1", "/tmp/good2"]


def test_a_blocking_download_no_longer_defeats_the_outer_timeout():
    """The exact 2026-08-29 shape, both ways round.

    A synchronous sleep called INLINE pins the loop and the wait_for never
    fires; awaited through to_thread the loop keeps turning and the cap applies.
    That difference is the whole bug.
    """
    def blocking_download():
        time.sleep(1.5)
        return ["/tmp/doc.pdf"]

    # How it used to be: the timer cannot run, so the cap is not enforced.
    async def inline():
        async def body():
            return blocking_download()
        return await asyncio.wait_for(body(), timeout=0.2)

    started = time.monotonic()
    try:
        asyncio.run(inline())
        pinned_raised = False
    except asyncio.TimeoutError:
        pinned_raised = True
    pinned_elapsed = time.monotonic() - started
    # It ran the sleep to completion despite a 0.2s cap — the cap was a fiction.
    assert pinned_elapsed >= 1.4
    assert not pinned_raised

    # How it is now: awaiting a thread yields, so the cap is real.
    #
    # Timed INSIDE the coroutine on purpose: asyncio.run() drains the default
    # executor on shutdown, so it does not return until the orphaned sleep ends.
    # Measuring around it would show 1.5s and hide the very thing under test —
    # that the timeout fired on schedule.
    async def threaded():
        async def body():
            return await asyncio.to_thread(blocking_download)
        began = time.monotonic()
        try:
            await asyncio.wait_for(body(), timeout=0.2)
            return None
        except asyncio.TimeoutError:
            return time.monotonic() - began

    elapsed = asyncio.run(threaded())
    assert elapsed is not None, "the cap did not fire"
    assert elapsed < 1.0


def test_enter_full_order_awaits_the_download_off_the_loop():
    """Pins the call site itself: a direct call here reintroduces the hang."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "oe_feasibility.py")).read()
    assert "await asyncio.to_thread(r2_download.download_many" in src
    # No bare call may remain — one is enough to pin the loop again.
    assert "= r2_download.download_many(" not in src

"""Two concurrent runs must not be able to break the process's stdout.

Live 2026-08-31: a submit came back as

    The run stopped without reporting: ValueError('I/O operation on closed file.')

`_run_order_job_inner` wrapped each run in `redirect_stdout(log_file)`, which
swaps the PROCESS-GLOBAL `sys.stdout`. With `OE_MAX_CONCURRENT_JOBS` raised to 4
two runs overlap, and their save/restore interleaves: the first to exit restores
the real stream and closes its file, the second then restores the FIRST's closed
file — and from that moment every print in the process raises.

Both halves left evidence on the droplet: sixteen job logs holding nothing but
their own "Order job … started" line (the rest went to the container log after
the other run reset stdout), clustered in the same minutes as the failing order.

`test_the_old_way_corrupts_stdout` reproduces it. The rest pin the replacement.

Run from scraper/:
    pytest tests/test_job_logging.py
"""

import io
import os
import sys
import threading
import time
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from job_logging import ThreadRoutedStream, install, job_log  # noqa: E402


# ── The bug, reproduced ──────────────────────────────────────────────────────

def test_the_old_way_corrupts_stdout(tmp_path):
    """The shape api_server had. Two overlapping 'jobs', nothing exotic."""
    saved = sys.stdout
    errors = []
    try:
        def old_style_job(name, enter_delay, work):
            time.sleep(enter_delay)
            try:
                with open(tmp_path / f"{name}.log", "w", buffering=1) as lf, \
                        redirect_stdout(lf):
                    print(f"{name}: started")
                    time.sleep(work)
                    print(f"{name}: done")
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))

        threads = [threading.Thread(target=old_style_job, args=a)
                   for a in (("A", 0.00, 0.20), ("B", 0.05, 0.20), ("C", 0.10, 0.20))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # The two symptoms seen in production, in order of how they present.
        assert getattr(sys.stdout, "closed", False) is True, (
            "sys.stdout should have been left pointing at a CLOSED file")
        raised = None
        try:
            print("the next line any thread prints")
        except ValueError as e:
            raised = e
        assert raised is not None
        assert "closed file" in str(raised)
    finally:
        sys.stdout = saved


# ── The replacement ──────────────────────────────────────────────────────────

def test_overlapping_jobs_keep_their_own_logs(tmp_path):
    """The same interleaving, through job_log: no error, and — the half that is
    easy to forget — each run's lines land in ITS OWN file rather than leaking
    into the container log the moment another run finishes."""
    saved_out, saved_err = sys.stdout, sys.stderr
    errors = []
    try:
        def job(name, enter_delay, work):
            time.sleep(enter_delay)
            try:
                with job_log(str(tmp_path / f"{name}.log")):
                    print(f"{name}: started")
                    time.sleep(work)
                    print(f"{name}: done")
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))

        threads = [threading.Thread(target=job, args=a)
                   for a in (("A", 0.00, 0.20), ("B", 0.05, 0.20), ("C", 0.10, 0.20))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == []
        for name in ("A", "B", "C"):
            body = (tmp_path / f"{name}.log").read_text()
            assert f"{name}: started" in body
            assert f"{name}: done" in body, (
                f"{name} lost its output when another run finished")
            for other in set("ABC") - {name}:
                assert f"{other}:" not in body, "one run's output reached another's log"
        print("this must not raise")
    finally:
        sys.stdout, sys.stderr = saved_out, saved_err


def test_stdout_survives_and_stays_usable(tmp_path):
    """After every run, the process can still print. This is the thing that was
    sticky: one bad interleave used to poison every LATER job too."""
    saved_out, saved_err = sys.stdout, sys.stderr
    try:
        with job_log(str(tmp_path / "one.log")):
            print("inside")
        out = io.StringIO()
        with job_log(str(tmp_path / "two.log")):
            print("inside again")
        assert not getattr(sys.stdout, "closed", False)
        # And unbound output goes to the fallback, not into some job's file.
        install()
        sys.stdout._fallback = out
        print("unbound line")
        assert "unbound line" in out.getvalue()
    finally:
        sys.stdout, sys.stderr = saved_out, saved_err


def test_a_late_writer_never_raises(tmp_path):
    """A task that outlives its run — a callback after the browser is torn down,
    a webhook retry — prints into a file that is already closed. That must fall
    back, not raise: re-introducing the failure one level down would be no fix
    at all."""
    fallback = io.StringIO()
    stream = ThreadRoutedStream(fallback)
    f = open(tmp_path / "late.log", "w", buffering=1)
    stream.push(f)
    stream.write("while open\n")
    f.close()
    stream.write("after close\n")   # must not raise
    stream.flush()
    assert "after close" in fallback.getvalue()
    assert "while open" not in fallback.getvalue()


def test_a_batch_nests_its_members(tmp_path):
    """A batch runs each member inline on the batch's OWN thread, so the
    bindings nest. Within one thread that is strictly LIFO and safe — the member
    writes to its own log, and the batch keeps writing to its own afterwards."""
    saved_out, saved_err = sys.stdout, sys.stderr
    try:
        with job_log(str(tmp_path / "batch.log")):
            print("batch: start")
            with job_log(str(tmp_path / "member.log")):
                print("member: run")
            print("batch: end")
        batch = (tmp_path / "batch.log").read_text()
        member = (tmp_path / "member.log").read_text()
        assert "batch: start" in batch and "batch: end" in batch
        assert "member: run" in member
        assert "member: run" not in batch
        assert "batch:" not in member
    finally:
        sys.stdout, sys.stderr = saved_out, saved_err


def test_an_unbound_thread_writes_to_the_fallback(tmp_path):
    """The reaper, the dealer-login loop and Flask's request threads print with
    no job bound. They used to land in whichever job held the global redirect;
    now they reach the real stream."""
    fallback = io.StringIO()
    stream = ThreadRoutedStream(fallback)
    seen = []

    def other_thread():
        stream.write("from an unbound thread\n")

    f = open(tmp_path / "job.log", "w", buffering=1)
    stream.push(f)
    t = threading.Thread(target=other_thread)
    t.start()
    t.join()
    stream.write("from the job thread\n")
    stream.pop()
    f.close()
    seen.append((tmp_path / "job.log").read_text())

    assert "from an unbound thread" in fallback.getvalue()
    assert "from an unbound thread" not in seen[0]
    assert "from the job thread" in seen[0]


# ── Prevention ───────────────────────────────────────────────────────────────

def test_api_server_never_swaps_the_global_stdout_again():
    """The bug came back-doored through one innocuous-looking line, and it looks
    correct in isolation — `redirect_stdout(my_log)` is the obvious way to send a
    job's output to its own file. It is only wrong because another thread may be
    doing the same thing at the same moment, which is invisible at the call site.

    So pin it in the source: api_server must route through `job_log`, and must
    not reach for the global swap. Reading the file is the point — a behavioural
    test cannot catch a reintroduction that only fails under a race.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    src = open(os.path.join(os.path.dirname(here), "api_server.py")).read()

    # Comments explaining WHY it must not be used are fine; code using it is not.
    code = "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#"))
    assert "redirect_stdout(" not in code, (
        "api_server is swapping the process-global stdout again — see job_logging")
    assert "redirect_stderr(" not in code
    assert "with job_log(" in code, "the job runner must route its output per thread"

"""Per-thread job logging that cannot corrupt the process's stdout.

`contextlib.redirect_stdout` swaps the PROCESS-GLOBAL `sys.stdout`. That is
exactly right for one job at a time, and silently wrong for two — which is the
state the droplet has been in since `OE_MAX_CONCURRENT_JOBS` was raised above 1.

With two overlapping runs the save/restore interleaves:

    A enters   sys.stdout = A.log      (saved: the real stdout)
    B enters   sys.stdout = B.log      (saved: A.log)
    A exits    sys.stdout = real       A.log CLOSED
               → B's remaining output now goes to the container log, and B's own
                 log file ends after the one line it wrote before A exited
    B exits    sys.stdout = A.log      ← already closed
               → every print in the WHOLE PROCESS from here on raises
                 ValueError('I/O operation on closed file.')

Both halves were visible in production. Sixteen job logs on the droplet contain
nothing but their own "Order job … started" line — the rest of each run went to
the container log — and the next job to print died before it could do anything,
reported as "The run stopped without reporting: ValueError('I/O operation on
closed file.')". The corruption is sticky: once `sys.stdout` is a closed file
every later run dies the same way until the container restarts.

The fix keeps every `print()` call site in the scraper exactly as it is — there
are hundreds, and routing them through a logger is not the change to make while
the submit flow is the thing under test. Instead `sys.stdout` is replaced ONCE,
at import, with a stream that asks *which thread is writing* and hands the line
to that thread's log file. Nothing is swapped per job, so nothing can be
restored out of order.
"""
import io
import sys
import threading
from contextlib import contextmanager


class ThreadRoutedStream(io.TextIOBase):
    """A stdout/stderr stand-in that writes to the CALLING thread's log file.

    A thread with no file bound — the Flask request threads, the dealer-login
    loop, the reaper — writes to the fallback, which is the real stream the
    process started with. Before this, those threads wrote into whichever job
    happened to hold the global redirect at that moment.
    """

    def __init__(self, fallback):
        self._fallback = fallback
        self._local = threading.local()

    # ── binding ──────────────────────────────────────────────────────────
    def _stack(self) -> list:
        stack = getattr(self._local, "stack", None)
        if stack is None:
            stack = []
            self._local.stack = stack
        return stack

    def push(self, file) -> None:
        self._stack().append(file)

    def pop(self):
        stack = self._stack()
        return stack.pop() if stack else None

    # ── stream ───────────────────────────────────────────────────────────
    def _target(self):
        """This thread's file, or the fallback.

        A CLOSED file falls back rather than raising. A late writer — a task
        that outlives its run, a callback firing after the browser is torn down
        — must not be able to kill the run it belongs to, let alone the process:
        that is the whole failure being fixed here, and re-introducing it one
        level down would be a poor joke.
        """
        stack = self._stack()
        if stack:
            f = stack[-1]
            try:
                if f is not None and not f.closed:
                    return f
            except Exception:  # noqa: BLE001 — a broken file is a fallback case
                pass
        return self._fallback

    def write(self, s) -> int:
        try:
            return self._target().write(s)
        except Exception:  # noqa: BLE001
            # Never raise out of a print. A log line is not worth a run.
            try:
                return self._fallback.write(s)
            except Exception:  # noqa: BLE001
                return 0

    def flush(self) -> None:
        try:
            self._target().flush()
        except Exception:  # noqa: BLE001
            pass

    def writable(self) -> bool:
        return True

    def isatty(self) -> bool:
        return False

    @property
    def encoding(self):
        return getattr(self._fallback, "encoding", "utf-8")


_OUT: ThreadRoutedStream | None = None
_ERR: ThreadRoutedStream | None = None
_INSTALL_LOCK = threading.Lock()


def install() -> None:
    """Route `sys.stdout`/`sys.stderr` per thread. Idempotent, and re-asserting.

    Called once at api_server import, and again by every `job_log`. The router
    is built once — so the fallback stays the stream the process started with,
    and unbound output keeps reaching `docker logs` — but the assignment is
    re-made whenever something else has taken `sys.stdout` since. An orphaned
    router looks exactly like a working one right up until a job's output
    silently goes somewhere else, which is the failure this module exists to
    end.
    """
    global _OUT, _ERR
    with _INSTALL_LOCK:
        if _OUT is None:
            _OUT = ThreadRoutedStream(sys.stdout)
        if _ERR is None:
            _ERR = ThreadRoutedStream(sys.stderr)
        if sys.stdout is not _OUT:
            sys.stdout = _OUT
        if sys.stderr is not _ERR:
            sys.stderr = _ERR


@contextmanager
def job_log(path: str):
    """Send this thread's output to `path` for the duration of the block.

    A stack, not a single slot, because a batch runs its members inline on the
    batch's own thread — that nesting is LIFO within one thread and so is always
    safe, unlike the cross-thread version this replaces.

    Yields the open file so a caller that wants to write to it directly can.
    """
    install()
    f = open(path, "w", buffering=1)
    _OUT.push(f)
    _ERR.push(f)
    try:
        yield f
    finally:
        _ERR.pop()
        _OUT.pop()
        try:
            f.close()
        except Exception:  # noqa: BLE001
            pass

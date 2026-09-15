"""
live_view.py — a watch-only screen stream of one order run, for admin.

Three parts, none of which touch Flask or the JOBS registry:

  * viewer tokens — the gate on GET /jobs/<id>/live. That route is reachable
    without X-Internal-Token (EventSource cannot set headers), so the token is
    an HMAC under a key DERIVED from ORDER_ENTRY_API_TOKEN, bound to one job id,
    30 minutes long. Mirrored in src/lib/live-view-token.ts.
  * FrameStore — per job: the latest JPEG, and bounded queues for viewers.
  * attach()/detach() — start and stop Chromium's screencast on the run's page.

Everything here is best-effort: the live view must never cost an order.
"""
import base64
import hashlib
import hmac
import threading
import time
from collections import deque

LIVE_VIEW_MAX_VIEWERS = 3
LIVE_VIEW_LINGER_S = 120
MIN_FRAME_INTERVAL_S = 0.25
QUEUE_LIMIT = 64
TOKEN_TTL_S = 30 * 60


# ── tokens ─────────────────────────────────────────────────────────────────
def _key(secret: str) -> bytes:
    return hashlib.sha256(("bizzflow-live-view:" + secret).encode()).digest()


def _sign(job_id: str, exp: int, secret: str) -> str:
    return hmac.new(_key(secret), f"{job_id}.{exp}".encode(), hashlib.sha256).hexdigest()


def mint_viewer_token(job_id: str, secret: str, exp: int) -> str:
    """Only for tests and the dev demo — production tokens are minted by Vercel."""
    return f"{job_id}.{exp}.{_sign(job_id, exp, secret)}"


def verify_viewer_token(token, job_id: str, secret: str, now: float | None = None) -> bool:
    if not secret or not isinstance(token, str) or not job_id:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    tok_job, exp_s, sig = parts
    if tok_job != job_id or not exp_s.isdigit():
        return False
    exp = int(exp_s)
    if (now if now is not None else time.time()) >= exp:
        return False
    return hmac.compare_digest(sig, _sign(job_id, exp, secret))


# ── per-job store ───────────────────────────────────────────────────────────
class Subscriber:
    """One viewer's queue. Frames are droppable; stages and log lines are not."""

    def __init__(self):
        self._q: deque = deque()
        self._cv = threading.Condition()
        self.closed = False

    def put(self, kind: str, data: dict) -> None:
        with self._cv:
            if self.closed:
                return
            if len(self._q) >= QUEUE_LIMIT:
                # Drop the OLDEST frame to make room. If there is none, a stage
                # or log item is appended anyway — those are never dropped.
                for i, (k, _) in enumerate(self._q):
                    if k == "frame":
                        del self._q[i]
                        break
            self._q.append((kind, data))
            self._cv.notify()

    def get(self, timeout: float):
        with self._cv:
            if not self._q:
                self._cv.wait(timeout)
            return self._q.popleft() if self._q else None

    def close(self) -> None:
        with self._cv:
            self.closed = True
            self._cv.notify_all()


class FrameStore:
    def __init__(self):
        self.latest: dict | None = None
        self.stages: list[dict] = []
        self.detached_at: float | None = None
        self._subs: list[Subscriber] = []
        self._last_sent_at = 0.0
        self._lock = threading.Lock()

    def subscribe(self) -> Subscriber:
        sub = Subscriber()
        with self._lock:
            self._subs.append(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)
        sub.close()

    def _fanout(self, kind: str, data: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            s.put(kind, data)

    def publish_frame(self, jpeg_b64: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
        self.latest = {"jpeg": jpeg_b64, "at": at}
        if now - self._last_sent_at < MIN_FRAME_INTERVAL_S:
            return
        self._last_sent_at = now
        self._fanout("frame", dict(self.latest))

    def publish_stage(self, stage: dict) -> None:
        self.stages.append(stage)
        self._fanout("stage", stage)

    def publish_log(self, line: str) -> None:
        self._fanout("log", {"line": line})

    def close_subscribers(self) -> None:
        with self._lock:
            subs = list(self._subs)
            self._subs.clear()
        for s in subs:
            s.close()


_STORES: dict[str, FrameStore] = {}
_STORES_LOCK = threading.Lock()
_VIEWERS = [0]
_VIEWERS_LOCK = threading.Lock()


def get_store(job_id: str, create: bool = False, now: float | None = None):
    now = time.time() if now is None else now
    with _STORES_LOCK:
        s = _STORES.get(job_id)
        if s is not None and s.detached_at is not None and now - s.detached_at > LIVE_VIEW_LINGER_S:
            del _STORES[job_id]
            s = None
        if s is None and create:
            s = FrameStore()
            _STORES[job_id] = s
        return s


def detach_store(job_id: str, now: float | None = None) -> None:
    """Stop feeding viewers; keep `latest` for the linger so a late viewer sees the final screen."""
    s = get_store(job_id)
    if s is None:
        return
    s.detached_at = time.time() if now is None else now
    s.close_subscribers()


def remove_store(job_id: str) -> None:
    with _STORES_LOCK:
        _STORES.pop(job_id, None)


def publish_stage(job_id: str, stage: dict) -> None:
    s = get_store(job_id)
    if s is not None:
        s.publish_stage(stage)


def acquire_viewer_slot() -> bool:
    with _VIEWERS_LOCK:
        if _VIEWERS[0] >= LIVE_VIEW_MAX_VIEWERS:
            return False
        _VIEWERS[0] += 1
        return True


def release_viewer_slot() -> None:
    with _VIEWERS_LOCK:
        _VIEWERS[0] = max(0, _VIEWERS[0] - 1)


def viewer_count() -> int:
    with _VIEWERS_LOCK:
        return _VIEWERS[0]


# ── screencast ──────────────────────────────────────────────────────────────
async def attach(page, job_id: str):
    """Start Chromium's screencast on `page`, feeding the job's FrameStore.

    Best-effort: returns the CDP session, or None if anything failed. The
    caller carries on either way — a diagnostic must never break the run.
    """
    try:
        store = get_store(job_id, create=True)
        session = await page.context.new_cdp_session(page)

        async def on_frame(params):
            try:
                store.publish_frame(params.get("data", ""))
            finally:
                # The ack is what lets Chromium send the next frame — sent
                # whether or not this frame was forwarded to anyone.
                try:
                    await session.send("Page.screencastFrameAck",
                                       {"sessionId": params["sessionId"]})
                except Exception:  # noqa: BLE001 — session gone; the run's own teardown handles it
                    pass

        session.on("Page.screencastFrame", on_frame)
        await session.send("Page.startScreencast", {
            "format": "jpeg", "quality": 50,
            "maxWidth": 1280, "maxHeight": 800, "everyNthFrame": 1,
        })
        print(f"  live view: screencast attached for job {job_id}", flush=True)
        return session
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ live view: attach failed ({type(e).__name__}: {e}) — run continues", flush=True)
        return None


async def detach(job_id: str, session) -> None:
    try:
        if session is not None:
            try:
                await session.send("Page.stopScreencast")
            except Exception:  # noqa: BLE001 — page already closed
                pass
    finally:
        try:
            detach_store(job_id)
        except Exception:  # noqa: BLE001
            pass

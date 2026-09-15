# Admin Live Submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can submit an order under a chosen agent's dealer session and watch the droplet's browser drive the Unifi portal live, step by step, in a new tab.

**Architecture:** The droplet (Flask + Playwright, `scraper/`) attaches a Chrome DevTools screencast to the run's page only when the job is created with `live_view: true`, keeps the latest JPEG frame per job in memory, and streams frames + stage milestones + the job log tail over one Server-Sent Events route. Vercel (`src/`) mints a 30-minute HMAC viewer token bound to the job id, starts the run through the existing `startSubmitRun`, and renders a live page whose browser connects straight to the droplet. Nothing is recorded.

**Tech Stack:** Python 3.12 / Flask 2.3 / Playwright 1.55 (CDP `Page.startScreencast`) on the droplet; Next.js App Router, Server Actions, `EventSource`, vitest on Vercel. Scraper tests run in the Python 3.12 venv OUTSIDE the repo (see memory `scraper-tests-need-python-312-venv`).

**Spec:** `context/features/admin-live-submit.md`

## Global Constraints

- No migration. `Order.autoRetryDisabled`, `Order.jobId`, `Order.lastSubmitUserId` already exist.
- Agent-started runs must be byte-identical to today: every new parameter defaults off, and a test pins the existing `POST /orders` body.
- The live view must never cost an order: every attach/publish/detach is wrapped so an exception is printed to the run log and swallowed.
- Token: `sha256("bizzflow-live-view:" + ORDER_ENTRY_API_TOKEN)` as HMAC key; token = `<jobId>.<expUnixSeconds>.<hex hmac-sha256(key, jobId + "." + exp)>`; TTL 30 minutes; constant-time compare.
- Shared test vector (secret `test-token`, job `job123`, exp `1900000000`):
  `job123.1900000000.d8641c3f0304468c252c6e01993ba5060b8659a626391acbb7b40f6020e2845b`
- Screencast: JPEG, quality 50, maxWidth 1280, maxHeight 800; forwarded at most one frame per 0.25 s; subscriber queue 64 items, oldest FRAME dropped when full, `stage`/`log` never dropped; `LIVE_VIEW_MAX_VIEWERS = 3`; `LIVE_VIEW_LINGER_S = 120`.
- SSE events: `hello`, `frame`, `stage`, `log`, `status`, `ping` (every 15 s idle). Refusals: 401 `unauthorized`, 404 `unknown_job`, 404 `no_live_view`, 429 `too_many_viewers`.
- CORS header `Access-Control-Allow-Origin: <LIVE_VIEW_ORIGIN>` on the live route ONLY.
- New env: Vercel `NEXT_PUBLIC_SCRAPER_API_URL`; droplet `LIVE_VIEW_ORIGIN`. Dockerfile `--threads 16`.
- Repo rules: branch `feature/admin-live-submit`; never commit without the user's permission (the commit steps below are the points at which to ASK); conventional commit messages; no "Generated with Claude" in messages; Tailwind v4 (no config file); no `any`.
- Copy, verbatim from the spec: Stop-before-Pay helper *"The run stops on the Pay screen. The portal will already hold an unpaid order number for this customer, which must be paid or voided by hand."*; retry line *"Automatic retry is switched off for this order from now on."*; no-live-view sentence *"Live view was not enabled for this run."*; viewer cap *"Three viewers are already watching runs on the order service — close one and reload."*; dead session *"That account's dealer session has expired — reconnect it from Order Entry first."*; in-flight *"A run is already in flight"*.

---

## File structure

**Scraper (droplet)**
- Create `scraper/live_view.py` — token verify, `FrameStore`, `Subscriber`, `attach`/`detach`, viewer-slot counter. No Flask, no JOBS access: pure state + Playwright.
- Modify `scraper/api_server.py` — `live_view` on `POST /orders`, `_set_stage` publishes, new `GET /jobs/<id>/live` route.
- Modify `scraper/oe_feasibility.py:1611-1616,1660-1663,1734-1735` — `live_view_job_id` kwarg, attach after the page opens, detach in `finally`.
- Modify `scraper/Dockerfile:20` — threads 16.
- Create `scraper/tests/test_live_view_token.py`, `test_live_view_store.py`, `test_live_view_screencast.py`, `test_live_view_route.py`.
- Create `scraper/devtools/live_view_demo.py` — dev-only; dockerignored already.

**Vercel**
- Create `src/lib/live-view-token.ts` — mint/verify.
- Create `src/lib/admin-gate.ts` — `requireAdmin()` moved out of `admin-orders.ts` so a second action file can share it.
- Modify `src/lib/order-start.ts:133-136,283-291` and the "Submit started." event — `doPay`, `liveView`, `startedBy` opts.
- Modify `src/lib/audit.ts:16-29` — `order_admin_submitted`.
- Modify `src/lib/admin-nav.ts` — `/admin/orders/<id>/live` → "Live run".
- Create `src/actions/admin-submit.ts` — `adminSubmitTargets`, `adminSubmitOrder`, `adminLiveViewToken`, `adminStopJob`.
- Create `src/components/admin/submit-as-admin-button.tsx`, `src/components/admin/live-run-viewer.tsx`.
- Create `src/app/admin/(dashboard)/orders/[id]/live/page.tsx`.
- Modify `src/components/admin/order-detail.tsx`, `src/app/admin/(dashboard)/orders/[id]/page.tsx` — button + Watch live link + `jobId` in the view.
- Modify `.env.example` — two new variables.
- Tests: `src/lib/__tests__/live-view-token.test.ts`, `admin-submit.test.ts`, additions to `order-start-busy.test.ts` (new file `order-start-opts.test.ts`) and `admin-nav.test.ts`.

Deploy order: droplet first, then Vercel.

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b feature/admin-live-submit` from a clean `main`. `git status` must be clean apart from the two spec files already written (`context/features/admin-live-submit.md`, `context/current-feature.md`). Do NOT commit yet — commits in this plan are points to ask the user.

---

### Task 1: Viewer token — Python side

**Files:**
- Create: `scraper/live_view.py`
- Test: `scraper/tests/test_live_view_token.py`

**Interfaces:**
- Produces: `verify_viewer_token(token: str, job_id: str, secret: str, now: float | None = None) -> bool`, `mint_viewer_token(job_id: str, secret: str, exp: int) -> str` (mint exists only so the demo script and tests can make tokens; production tokens come from Vercel).

- [ ] **Step 1: Write the failing test**

```python
# scraper/tests/test_live_view_token.py
"""The viewer token that lets an admin's browser open a job's live stream.

The route it protects is reachable WITHOUT the internal token (EventSource
cannot send headers), so this is the whole gate: unforgeable, short-lived and
bound to one job id. The shared vector pins the Python rule to the TypeScript
one in src/lib/live-view-token.ts — if either drifts, the admin sees 401.

Run from the scraper/ dir:  pytest tests/test_live_view_token.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from live_view import mint_viewer_token, verify_viewer_token  # noqa: E402

SECRET = "test-token"
VECTOR = "job123.1900000000.d8641c3f0304468c252c6e01993ba5060b8659a626391acbb7b40f6020e2845b"


def test_shared_vector_verifies():
    assert verify_viewer_token(VECTOR, "job123", SECRET, now=1899999000) is True


def test_mint_matches_shared_vector():
    assert mint_viewer_token("job123", SECRET, 1900000000) == VECTOR


def test_expired_token_refused():
    assert verify_viewer_token(VECTOR, "job123", SECRET, now=1900000001) is False


def test_wrong_job_refused():
    assert verify_viewer_token(VECTOR, "job999", SECRET, now=1899999000) is False


def test_tampered_signature_refused():
    bad = VECTOR[:-1] + ("0" if VECTOR[-1] != "0" else "1")
    assert verify_viewer_token(bad, "job123", SECRET, now=1899999000) is False


def test_malformed_tokens_refused():
    for t in ["", "job123", "job123.abc.def", "job123.1900000000", None]:
        assert verify_viewer_token(t, "job123", SECRET, now=1899999000) is False


def test_empty_secret_refuses_everything():
    assert verify_viewer_token(VECTOR, "job123", "", now=1899999000) is False
```

- [ ] **Step 2: Run to verify it fails**

Run (from `scraper/`): `<venv312>/bin/python -m pytest tests/test_live_view_token.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'live_view'`.

- [ ] **Step 3: Write the token half of `live_view.py`**

```python
# scraper/live_view.py
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_token.py -v`
Expected: 7 passed.

- [ ] **Step 5: Ask the user, then commit**

```bash
git add scraper/live_view.py scraper/tests/test_live_view_token.py
git commit -m "feat(live-view): viewer token verification on the droplet"
```

---

### Task 2: FrameStore, subscribers, throttle, linger — pure

**Files:**
- Modify: `scraper/live_view.py` (append)
- Test: `scraper/tests/test_live_view_store.py`

**Interfaces:**
- Produces:
  - `class Subscriber` with `put(kind: str, data: dict) -> None`, `get(timeout: float) -> tuple[str, dict] | None`, `close() -> None`, `closed: bool`.
  - `class FrameStore` with `latest: dict | None` (`{"jpeg": <base64 str>, "at": <iso str>}`), `stages: list[dict]` (mirror of what was published), `subscribe() -> Subscriber`, `unsubscribe(sub)`, `publish_frame(jpeg_b64: str, now: float | None = None)`, `publish_stage(stage: dict)`, `publish_log(line: str)`, `detached_at: float | None`.
  - Module functions: `get_store(job_id, create=False, now=None) -> FrameStore | None` (evicts a store detached longer than `LIVE_VIEW_LINGER_S`), `remove_store(job_id)`, `publish_stage(job_id, stage)`, `acquire_viewer_slot() -> bool`, `release_viewer_slot()`, `viewer_count() -> int`.

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_live_view_store.py
"""What a viewer is sent, and what a slow viewer loses.

A frame burst must cost a viewer at most 4 frames a second, and a viewer that
cannot keep up loses FRAMES — never a stage or a log line, because those are
the story and a frame is only its illustration.

Run from the scraper/ dir:  pytest tests/test_live_view_store.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_view  # noqa: E402
from live_view import FrameStore, QUEUE_LIMIT  # noqa: E402


def setup_function(_):
    live_view._STORES.clear()
    live_view._VIEWERS[0] = 0


def test_latest_always_updates_but_forwarding_is_throttled():
    s = FrameStore()
    sub = s.subscribe()
    s.publish_frame("A", now=100.0)
    s.publish_frame("B", now=100.1)   # 0.1s later: latest moves, not forwarded
    s.publish_frame("C", now=100.4)   # 0.4s after A: forwarded
    assert s.latest["jpeg"] == "C"
    got = [sub.get(0.01) for _ in range(3)]
    assert [g[1]["jpeg"] for g in got if g] == ["A", "C"]


def test_full_queue_drops_oldest_frame_never_a_stage_or_log():
    s = FrameStore()
    sub = s.subscribe()
    s.publish_stage({"name": "creating_customer", "detail": None, "at": "t0"})
    for i in range(QUEUE_LIMIT + 5):
        s.publish_frame(f"f{i}", now=1000.0 + i)   # 1s apart: all forwarded
    s.publish_log("a line")
    items = []
    while True:
        it = sub.get(0.01)
        if it is None:
            break
        items.append(it)
    kinds = [k for k, _ in items]
    assert kinds[0] == "stage"
    assert kinds[-1] == "log"
    assert kinds.count("frame") == QUEUE_LIMIT - 2   # 64 cap minus the stage and log
    frames = [d["jpeg"] for k, d in items if k == "frame"]
    assert frames[0] == "f7" and frames[-1] == f"f{QUEUE_LIMIT + 4}"  # oldest dropped


def test_publish_stage_records_history_for_late_joiners():
    s = FrameStore()
    s.publish_stage({"name": "a", "detail": None, "at": "t0"})
    s.publish_stage({"name": "b", "detail": "x", "at": "t1"})
    assert [st["name"] for st in s.stages] == ["a", "b"]


def test_detach_keeps_latest_for_linger_then_evicts():
    s = live_view.get_store("j1", create=True)
    sub = s.subscribe()
    s.publish_frame("last", now=5.0)
    live_view.detach_store("j1", now=1000.0)
    assert sub.closed is True
    assert live_view.get_store("j1", now=1000.0 + live_view.LIVE_VIEW_LINGER_S - 1).latest["jpeg"] == "last"
    assert live_view.get_store("j1", now=1000.0 + live_view.LIVE_VIEW_LINGER_S + 1) is None


def test_module_publish_stage_is_a_no_op_without_a_store():
    live_view.publish_stage("nope", {"name": "a", "detail": None, "at": "t"})  # must not raise


def test_viewer_slots_are_capped():
    for _ in range(live_view.LIVE_VIEW_MAX_VIEWERS):
        assert live_view.acquire_viewer_slot() is True
    assert live_view.acquire_viewer_slot() is False
    live_view.release_viewer_slot()
    assert live_view.acquire_viewer_slot() is True
    assert live_view.viewer_count() == live_view.LIVE_VIEW_MAX_VIEWERS
```

- [ ] **Step 2: Run to verify it fails**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_store.py -v`
Expected: FAIL, `ImportError: cannot import name 'FrameStore'`.

- [ ] **Step 3: Append the store to `live_view.py`**

```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_store.py tests/test_live_view_token.py -v`
Expected: 13 passed.

- [ ] **Step 5: Ask the user, then commit**

```bash
git add scraper/live_view.py scraper/tests/test_live_view_store.py
git commit -m "feat(live-view): per-job frame store with throttle, bounded queues and linger"
```

---

### Task 3: Screencast attach/detach against real Chromium

**Files:**
- Modify: `scraper/live_view.py` (append)
- Test: `scraper/tests/test_live_view_screencast.py`

**Interfaces:**
- Produces: `async attach(page, job_id: str) -> object | None` (returns the CDP session or None on failure; never raises), `async detach(job_id: str, session) -> None` (stops the screencast, calls `detach_store`; never raises).

- [ ] **Step 1: Write the failing test**

```python
# scraper/tests/test_live_view_screencast.py
"""The screencast produces frames from a real page, and a repaint produces a newer one.

Real Chromium, no portal: a page with a coloured box, then the box changes
colour. If attach() silently produced nothing, the live page would sit on
"Waiting for the browser…" forever — so this is the one test that must use the
real browser.

Run from the scraper/ dir:  pytest tests/test_live_view_screencast.py
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_view  # noqa: E402

HTML = "<html><body style='margin:0'><div id=b style='width:400px;height:300px;background:%s'></div></body></html>"


def _run(coro):
    return asyncio.run(coro)


async def _wait_for(pred, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        await asyncio.sleep(0.05)
    return False


def test_attach_produces_frames_and_a_repaint_produces_a_newer_one():
    async def go():
        from playwright.async_api import async_playwright
        live_view._STORES.clear()
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 640, "height": 480})
            await page.set_content(HTML % "red")
            session = await live_view.attach(page, "jobA")
            assert session is not None
            store = live_view.get_store("jobA")
            assert await _wait_for(lambda: store.latest is not None)
            first = store.latest["jpeg"]
            assert len(first) > 1000  # a real base64 JPEG, not an empty string
            await page.evaluate("document.getElementById('b').style.background='blue'")
            assert await _wait_for(lambda: store.latest["jpeg"] != first)
            await live_view.detach("jobA", session)
            assert store.detached_at is not None
            await browser.close()
    _run(go())


def test_attach_never_raises_on_a_broken_page():
    class Broken:
        @property
        def context(self):
            raise RuntimeError("no context")
    assert _run(live_view.attach(Broken(), "jobB")) is None
    _run(live_view.detach("jobB", None))  # must not raise either
```

- [ ] **Step 2: Run to verify it fails**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_screencast.py -v`
Expected: FAIL, `AttributeError: module 'live_view' has no attribute 'attach'`.

- [ ] **Step 3: Append attach/detach**

```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_screencast.py -v`
Expected: 2 passed (the first takes a few seconds — it launches Chromium).

- [ ] **Step 5: Ask the user, then commit**

```bash
git add scraper/live_view.py scraper/tests/test_live_view_screencast.py
git commit -m "feat(live-view): attach a CDP screencast to a run's page"
```

---

### Task 4: Wire `live_view` through the job (`POST /orders` → runner → `enter_full_order`)

**Files:**
- Modify: `scraper/api_server.py` (`create_order`, `_run_order_job`, `_run_order_job_inner`, `_set_stage`)
- Modify: `scraper/oe_feasibility.py:1611-1616` (signature), after `open_context_from_session` (~1663), `finally` (~1734)
- Test: `scraper/tests/test_live_view_route.py` (the first two tests; the route itself is Task 5)

**Interfaces:**
- Consumes: `live_view.get_store`, `live_view.publish_stage`, `live_view.attach`, `live_view.detach`.
- Produces: `POST /orders` body field `live_view: bool` (default false) recorded as `JOBS[job_id]["live_view"]`; `_run_order_job(..., live_view: bool = False)`; `enter_full_order(..., live_view_job_id: str | None = None)`.

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_live_view_route.py
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_route.py -v`
Expected: both FAIL (`KeyError: 'live_view'` / `assert None is False`).

- [ ] **Step 3: `create_order` — read the flag, record it, pass it**

In `scraper/api_server.py` `create_order()`, after `do_pay = bool(data.get("do_pay", False))`:

```python
    # Admin's watch-only live view. Only a job created with this flag ever
    # attaches a screencast; an agent's run sends nothing and is unchanged.
    live_view_on = bool(data.get("live_view", False))
```

In the `JOBS[job_id] = {...}` dict add `"live_view": live_view_on,`.

Change the `Thread(... args=(...))` to pass it by keyword:

```python
        Thread(
            target=_run_order_job,
            args=(job_id, payload, dry_run, user_key, stop_after_customer_fill,
                  stop_after_customer_create, full_order, do_pay, notify_order_id),
            kwargs={"live_view": live_view_on},
            daemon=True,
        ).start()
```

- [ ] **Step 4: `_run_order_job` and `_run_order_job_inner` — thread the flag through**

Add `live_view: bool = False` as the last parameter of BOTH functions; `_run_order_job` passes `live_view=live_view` to `_run_order_job_inner`. In `_run_bounded`, the `full_order` call becomes:

```python
            return await asyncio.wait_for(
                enter_full_order(payload, user_key=user_key, dry_run=dry_run,
                                 submit=True, do_pay=do_pay, on_stage=_set_stage,
                                 live_view_job_id=job_id if live_view else None),
                timeout=OVERALL_ORDER_TIMEOUT,
            )
```

The `enter_order` (non-full) call is untouched — the live view exists only for the full flow BizzFlow submits.

- [ ] **Step 5: `_set_stage` publishes**

At the top of `api_server.py`, after `from job_logging import ...`: `import live_view`. In `_set_stage`, after `stages.append({...})`, build the entry once and publish it:

```python
            if len(stages) < 200:
                entry = {"name": name, "detail": detail,
                         "at": datetime.utcnow().isoformat() + "Z"}
                stages.append(entry)
                # Feeds a live viewer, if any. No-op for every other job.
                live_view.publish_stage(job_id, entry)
```

(Keep the existing comment about UTC above `entry`.)

- [ ] **Step 6: `enter_full_order` — attach and detach**

Signature (`oe_feasibility.py:1611`):

```python
async def enter_full_order(payload: dict, user_key: str = None, dry_run: bool = False,
                           submit: bool = True, do_pay: bool = False,
                           on_stage=None, live_view_job_id: str | None = None) -> dict:
```

Just before `pw = browser = context = page = None` add `live_session = None`. Right after `ensure_on_order_entry(page)` succeeds is too late for a login bounce to be seen; attach immediately after `open_context_from_session` returns:

```python
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        if live_view_job_id:
            import live_view
            live_session = await live_view.attach(page, live_view_job_id)
        await ensure_on_order_entry(page)
```

In the `finally` at ~1734:

```python
    finally:
        if live_view_job_id:
            import live_view
            await live_view.detach(live_view_job_id, live_session)
        await dealer_web_login.safe_teardown(pw, browser, context)
```

- [ ] **Step 7: Run to verify it passes, and the neighbours still do**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_route.py tests/test_capacity_gate.py tests/test_job_cancel.py tests/test_stale_jobs.py tests/test_batch_runner.py -v`
Expected: all pass (the two new ones plus the existing files — `test_batch_runner` proves the batch call, which passes no `live_view`, is unchanged).

- [ ] **Step 8: Ask the user, then commit**

```bash
git add scraper/api_server.py scraper/oe_feasibility.py scraper/tests/test_live_view_route.py
git commit -m "feat(live-view): live_view flag on POST /orders attaches the screencast to the run"
```

---

### Task 5: `GET /jobs/<id>/live` — the SSE route

**Files:**
- Modify: `scraper/api_server.py` (new route after `get_job_log`)
- Modify: `scraper/Dockerfile:20` (`--threads 16`)
- Test: `scraper/tests/test_live_view_route.py` (append)

**Interfaces:**
- Consumes: `live_view.verify_viewer_token`, `get_store`, `acquire_viewer_slot`, `release_viewer_slot`.
- Produces: `GET /jobs/<job_id>/live?token=…` streaming SSE; `GET /jobs/<job_id>/live?token=…&probe=1` answering `200 {"ok": true}` with the same refusals and headers but no stream (the browser cannot read an EventSource's status code, so the page probes first).

- [ ] **Step 1: Write the failing tests (append to `test_live_view_route.py`)**

```python
def _mint(job_id, exp=None):
    return live_view.mint_viewer_token(job_id, os.environ["ORDER_ENTRY_API_TOKEN"],
                                       exp or int(time.time()) + 600)


def _job(job_id, status="running", live=True, log_path=None, stages=None):
    with api_server.JOBS_LOCK:
        api_server.JOBS[job_id] = {"status": status, "live_view": live,
                                   "created_at": "2026-09-16T00:00:00",
                                   "params": {"kind": "order_entry", "user_key": "u1"},
                                   "log_path": log_path, "stages": stages or []}


def _events(rv):
    """Parse an SSE body into [(event, data_dict)]."""
    raw = b"".join(rv.response).decode()
    out = []
    for block in raw.strip().split("\n\n"):
        ev, data = None, None
        for line in block.split("\n"):
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if ev:
            out.append((ev, data))
    return out


def test_bad_token_is_401_and_missing_job_is_404():
    _reset()
    c = _client()
    assert c.get("/jobs/j1/live?token=nope").status_code == 401
    _job("j1")
    assert c.get("/jobs/j1/live?token=" + _mint("j1", exp=1)).status_code == 401
    assert c.get("/jobs/other/live?token=" + _mint("other")).status_code == 404
    assert c.get("/jobs/other/live?token=" + _mint("other")).get_json()["error"] == "unknown_job"


def test_job_without_live_view_is_404_no_live_view():
    _reset()
    _job("j2", live=False)
    rv = _client().get("/jobs/j2/live?token=" + _mint("j2"))
    assert rv.status_code == 404 and rv.get_json()["error"] == "no_live_view"


def test_probe_answers_ok_with_cors_and_no_stream():
    _reset()
    _job("j3")
    rv = _client().get("/jobs/j3/live?probe=1&token=" + _mint("j3"))
    assert rv.status_code == 200 and rv.get_json() == {"ok": True}
    assert rv.headers["Access-Control-Allow-Origin"] == "https://bizzflow.example"
    assert "event-stream" not in rv.headers.get("Content-Type", "")


def test_viewer_cap_is_429():
    _reset()
    _job("j4")
    for _ in range(live_view.LIVE_VIEW_MAX_VIEWERS):
        assert live_view.acquire_viewer_slot()
    rv = _client().get("/jobs/j4/live?probe=1&token=" + _mint("j4"))
    assert rv.status_code == 429 and rv.get_json()["error"] == "too_many_viewers"


def test_terminal_job_streams_hello_frame_stages_log_status_then_ends(tmp_path):
    _reset()
    log = tmp_path / "j5.log"
    log.write_text("line one\nline two\n")
    _job("j5", status="done", log_path=str(log),
         stages=[{"name": "creating_customer", "detail": None, "at": "t0"}])
    store = live_view.get_store("j5", create=True)
    store.publish_frame("QUJD", now=1.0)  # base64 of "ABC"
    rv = _client().get("/jobs/j5/live?token=" + _mint("j5"))
    assert rv.status_code == 200
    assert rv.headers["Content-Type"].startswith("text/event-stream")
    assert rv.headers["Access-Control-Allow-Origin"] == "https://bizzflow.example"
    evs = _events(rv)
    kinds = [e for e, _ in evs]
    assert kinds[:4] == ["hello", "frame", "stage", "log"]
    assert kinds[-1] == "status"
    assert evs[0][1]["job_id"] == "j5" and evs[0][1]["live_view"] is True
    assert evs[1][1]["jpeg"] == "QUJD"
    assert evs[2][1]["name"] == "creating_customer"
    assert "line two" in evs[3][1]["line"]
    assert evs[-1][1]["status"] == "done"
    assert live_view.viewer_count() == 0  # slot released after the stream


def test_running_job_forwards_a_new_frame_then_closes_on_finish(tmp_path):
    _reset()
    log = tmp_path / "j6.log"
    log.write_text("")
    _job("j6", log_path=str(log))
    store = live_view.get_store("j6", create=True)

    def later():
        time.sleep(0.3)
        store.publish_frame("Zg==", now=time.time())
        with open(log, "a") as f:
            f.write("appended\n")
        time.sleep(0.4)
        with api_server.JOBS_LOCK:
            api_server.JOBS["j6"]["status"] = "error"
            api_server.JOBS["j6"]["error"] = "boom"
            api_server.JOBS["j6"]["error_kind"] = "unexpected"
    threading.Thread(target=later, daemon=True).start()

    rv = _client().get("/jobs/j6/live?token=" + _mint("j6"))
    evs = _events(rv)
    kinds = [e for e, _ in evs]
    assert kinds[0] == "hello"
    assert "frame" in kinds and "log" in kinds
    assert evs[-1] == ("status", {"status": "error", "error": "boom",
                                  "error_kind": "unexpected", "order_id": None})
```

- [ ] **Step 2: Run to verify they fail**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_route.py -v`
Expected: the 6 new tests FAIL with 404 (no such route).

- [ ] **Step 3: Write the route (after `get_job_log` in `api_server.py`)**

```python
# ───────────────────────────────────────────────────────────────────────────
# Live view — admin watches a run's browser. NOT gated by X-Internal-Token:
# EventSource cannot send headers, so the gate is the viewer token Vercel
# mints (HMAC under a key derived from ORDER_ENTRY_API_TOKEN, 30 min, one job).
# CORS is granted to ONE origin on THIS route only.
# ───────────────────────────────────────────────────────────────────────────
LIVE_VIEW_PING_S = 15
LIVE_VIEW_LOG_TAIL_BYTES = 4096


def _live_headers():
    origin = os.environ.get("LIVE_VIEW_ORIGIN", "")
    return {"Access-Control-Allow-Origin": origin} if origin else {}


def _sse(event: str, data) -> str:
    import json
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.route("/jobs/<job_id>/live", methods=["GET"])
def job_live(job_id):
    token = request.args.get("token", "")
    if not live_view.verify_viewer_token(token, job_id, os.environ.get("ORDER_ENTRY_API_TOKEN", "")):
        return jsonify({"error": "unauthorized"}), 401, _live_headers()
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "unknown_job"}), 404, _live_headers()
    if not job.get("live_view"):
        return jsonify({"error": "no_live_view"}), 404, _live_headers()
    if not live_view.acquire_viewer_slot():
        return jsonify({"error": "too_many_viewers"}), 429, _live_headers()
    if request.args.get("probe") == "1":
        live_view.release_viewer_slot()
        return jsonify({"ok": True}), 200, _live_headers()

    store = live_view.get_store(job_id, create=True)
    sub = store.subscribe()

    def _terminal():
        with JOBS_LOCK:
            j = JOBS.get(job_id) or {}
        if j.get("status") in ("done", "error"):
            res = j.get("result") or {}
            return {"status": j["status"], "error": j.get("error"),
                    "error_kind": j.get("error_kind"),
                    "order_id": res.get("order_id") if isinstance(res, dict) else None}
        return None

    def gen():
        last_sent = time.time()
        log_pos = 0
        try:
            yield _sse("hello", {"job_id": job_id, "status": job.get("status"),
                                 "stage": job.get("stage"), "started_at": job.get("started_at"),
                                 "live_view": True})
            if store.latest:
                yield _sse("frame", store.latest)
            for st in list(job.get("stages") or []):
                yield _sse("stage", st)
            # Log tail on connect, then follow.
            log_path = job.get("log_path")
            if log_path and os.path.exists(log_path):
                with open(log_path, "rb") as f:
                    f.seek(0, os.SEEK_END)
                    size = f.tell()
                    f.seek(max(0, size - LIVE_VIEW_LOG_TAIL_BYTES))
                    tail = f.read().decode("utf-8", "replace")
                    log_pos = size
                if tail:
                    yield _sse("log", {"line": tail})
            while True:
                term = _terminal()
                item = sub.get(0.25)
                sent = False
                while item is not None:
                    kind, data = item
                    yield _sse(kind, data)
                    sent = True
                    item = sub.get(0)
                # Follow the log file.
                if log_path and os.path.exists(log_path):
                    with open(log_path, "rb") as f:
                        f.seek(log_pos)
                        chunk = f.read()
                    if chunk:
                        log_pos += len(chunk)
                        yield _sse("log", {"line": chunk.decode("utf-8", "replace")})
                        sent = True
                if term is not None:
                    yield _sse("status", term)
                    return
                if sent:
                    last_sent = time.time()
                elif time.time() - last_sent >= LIVE_VIEW_PING_S:
                    yield _sse("ping", {})
                    last_sent = time.time()
        finally:
            store.unsubscribe(sub)
            live_view.release_viewer_slot()

    headers = {"Cache-Control": "no-store", "X-Accel-Buffering": "no", **_live_headers()}
    return app.response_class(gen(), mimetype="text/event-stream", headers=headers)
```

`api_server.py` does not import `time` today: add `import time` beside `import os` at the top.

Note the ordering the test pins: `_terminal()` is read BEFORE draining the queue, so a frame or log line published just before the job flipped terminal is still emitted before `status`.

- [ ] **Step 4: Dockerfile threads**

`scraper/Dockerfile:20`: `"--threads", "8"` → `"--threads", "16"`, and extend the comment above it: `# 16 threads: each open live-view stream holds one for the length of a run (capped at 3 by live_view.LIVE_VIEW_MAX_VIEWERS).`

- [ ] **Step 5: Run to verify it passes**

Run: `<venv312>/bin/python -m pytest tests/test_live_view_route.py -v`
Expected: 8 passed.

Then the whole scraper suite: `<venv312>/bin/python -m pytest -q` — expected: everything that passed before still passes (430 + the new ones).

- [ ] **Step 6: Ask the user, then commit**

```bash
git add scraper/api_server.py scraper/Dockerfile scraper/tests/test_live_view_route.py
git commit -m "feat(live-view): SSE route streaming frames, stages and the log tail to admin"
```

---

### Task 6: Viewer token — TypeScript side

**Files:**
- Create: `src/lib/live-view-token.ts`
- Test: `src/lib/__tests__/live-view-token.test.ts`

**Interfaces:**
- Produces: `LIVE_VIEW_TOKEN_TTL_MS = 30 * 60 * 1000`; `mintLiveViewToken(jobId: string, secret: string, now = Date.now()): { token: string; expiresAt: number }` (`expiresAt` in ms); `verifyLiveViewToken(token: string, jobId: string, secret: string, now = Date.now()): boolean`; `liveViewUrl(scraperUrl: string, jobId: string, token: string, probe = false): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/live-view-token.test.ts
import { describe, expect, it } from "vitest";
import {
  LIVE_VIEW_TOKEN_TTL_MS,
  liveViewUrl,
  mintLiveViewToken,
  verifyLiveViewToken,
} from "@/lib/live-view-token";

/**
 * The same rule lives in scraper/live_view.py. The vector below is asserted
 * on BOTH sides, so a drift shows up as a failing test, not as a 401 that an
 * admin meets on a live run.
 */
const SECRET = "test-token";
const VECTOR = "job123.1900000000.d8641c3f0304468c252c6e01993ba5060b8659a626391acbb7b40f6020e2845b";

describe("live view token", () => {
  it("mints the shared vector", () => {
    const { token, expiresAt } = mintLiveViewToken("job123", SECRET, 1900000000 * 1000 - LIVE_VIEW_TOKEN_TTL_MS);
    expect(token).toBe(VECTOR);
    expect(expiresAt).toBe(1900000000 * 1000);
  });

  it("verifies its own tokens and the vector", () => {
    expect(verifyLiveViewToken(VECTOR, "job123", SECRET, 1899999000 * 1000)).toBe(true);
    const { token } = mintLiveViewToken("jobX", SECRET);
    expect(verifyLiveViewToken(token, "jobX", SECRET)).toBe(true);
  });

  it("refuses expired, wrong-job, tampered and malformed tokens", () => {
    expect(verifyLiveViewToken(VECTOR, "job123", SECRET, 1900000001 * 1000)).toBe(false);
    expect(verifyLiveViewToken(VECTOR, "job999", SECRET, 1899999000 * 1000)).toBe(false);
    expect(verifyLiveViewToken(VECTOR.slice(0, -1) + "0", "job123", SECRET, 1899999000 * 1000)).toBe(false);
    expect(verifyLiveViewToken("job123.abc.def", "job123", SECRET)).toBe(false);
    expect(verifyLiveViewToken("", "job123", SECRET)).toBe(false);
    expect(verifyLiveViewToken(VECTOR, "job123", "", 1899999000 * 1000)).toBe(false);
  });

  it("builds the droplet URL with the token encoded", () => {
    expect(liveViewUrl("https://scraper.example", "j1", "a.b.c")).toBe("https://scraper.example/jobs/j1/live?token=a.b.c");
    expect(liveViewUrl("https://scraper.example/", "j 1", "x", true)).toBe("https://scraper.example/jobs/j%201/live?token=x&probe=1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/live-view-token.test.ts`
Expected: FAIL, cannot resolve `@/lib/live-view-token`.

- [ ] **Step 3: Implement**

```ts
// src/lib/live-view-token.ts
import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * The token an admin's browser presents to the droplet's live-view route.
 *
 * That route cannot check X-Internal-Token (EventSource sends no headers), so
 * this is the whole gate: an HMAC under a key DERIVED from the internal token
 * — no second secret to configure on either side — bound to ONE job id and
 * 30 minutes long. Mirrored byte-for-byte in scraper/live_view.py; the shared
 * vector in both test files is what keeps them in step.
 */
export const LIVE_VIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

function key(secret: string): Buffer {
  return createHash("sha256").update("bizzflow-live-view:" + secret).digest();
}

function sign(jobId: string, expSeconds: number, secret: string): string {
  return createHmac("sha256", key(secret)).update(`${jobId}.${expSeconds}`).digest("hex");
}

export function mintLiveViewToken(
  jobId: string,
  secret: string,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  const expSeconds = Math.floor((now + LIVE_VIEW_TOKEN_TTL_MS) / 1000);
  return {
    token: `${jobId}.${expSeconds}.${sign(jobId, expSeconds, secret)}`,
    expiresAt: expSeconds * 1000,
  };
}

export function verifyLiveViewToken(
  token: string,
  jobId: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!secret || !token || !jobId) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokJob, expS, sig] = parts;
  if (tokJob !== jobId || !/^\d+$/.test(expS)) return false;
  const exp = Number(expS);
  if (Math.floor(now / 1000) >= exp) return false;
  const expected = sign(jobId, exp, secret);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
}

/** The droplet URL the browser opens. `probe` asks for a JSON verdict instead of the stream. */
export function liveViewUrl(scraperUrl: string, jobId: string, token: string, probe = false): string {
  const base = scraperUrl.replace(/\/+$/, "");
  const q = `token=${encodeURIComponent(token)}${probe ? "&probe=1" : ""}`;
  return `${base}/jobs/${encodeURIComponent(jobId)}/live?${q}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/live-view-token.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Ask the user, then commit**

```bash
git add src/lib/live-view-token.ts src/lib/__tests__/live-view-token.test.ts
git commit -m "feat(live-view): viewer token mint/verify matching the droplet"
```

---

### Task 7: `startSubmitRun` opts — `doPay`, `liveView`, `startedBy`

**Files:**
- Modify: `src/lib/order-start.ts:133-136` (signature), the `recordEvent` "Submit started." block, and the fetch body at `:283-291`
- Test: `src/lib/__tests__/order-start-opts.test.ts`

**Interfaces:**
- Produces: `startSubmitRun(order, { userKey; auto?; batchOf?; doPay?: boolean; liveView?: boolean; startedBy?: "admin" })`. Body sends `do_pay: opts.doPay ?? (process.env.ORDER_ENTRY_DO_PAY === "true")` and `live_view: opts.liveView === true` (always present, false by default — the droplet ignores it when false, and always sending it keeps the shape one thing).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/order-start-opts.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three opts the admin live submit adds to startSubmitRun. The first test
 * is the load-bearing one: with none of them passed, the request body is what
 * every agent-side caller has always sent.
 */
const orderUpdate = vi.fn();
const dealerFindUnique = vi.fn();
const recordEvent = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { update: (...a: unknown[]) => orderUpdate(...a) },
    dealerAccount: { findUnique: (...a: unknown[]) => dealerFindUnique(...a) },
  },
}));
vi.mock("@/lib/order-history", () => ({ recordEvent: (...a: unknown[]) => recordEvent(...a) }));
vi.mock("@/actions/plans", () => ({
  mandatoryGroupsFor: vi.fn().mockResolvedValue({ all: [], devices: [] }),
}));

vi.stubGlobal("fetch", fetchMock);
process.env.ORDER_ENTRY_API_TOKEN = "test-token";
process.env.ORDER_ENTRY_DO_PAY = "true";

const { startSubmitRun } = await import("@/lib/order-start");

const ORDER = {
  id: "ord_1", userId: "user_1", attempt: 0, autoRetries: 0,
  appointmentLeadHours: null, offerName: "Some Plan", documents: [],
} as never;

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3600_000), staffCode: "TMRS00517" });
  fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ job_id: "job_1" }) });
});

describe("startSubmitRun opts", () => {
  it("sends the existing body when no new opt is passed", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1" });
    expect(sentBody()).toMatchObject({ user_key: "user_1", full_order: true, dry_run: false, do_pay: true, live_view: false });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started.");
  });

  it("doPay: false overrides the env var; live_view rides along", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1", doPay: false, liveView: true });
    expect(sentBody()).toMatchObject({ do_pay: false, live_view: true });
  });

  it("startedBy admin changes only the history message", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1", startedBy: "admin" });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started by admin under TMRS00517.");
    expect(sentBody()).toMatchObject({ do_pay: true, live_view: false });
  });

  it("startedBy admin with no staff code on the account still names admin", async () => {
    dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3600_000), staffCode: null });
    await startSubmitRun(ORDER, { userKey: "user_1", startedBy: "admin" });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started by admin.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/order-start-opts.test.ts`
Expected: tests 1 (`live_view` missing), 2, 3, 4 FAIL.

- [ ] **Step 3: Implement**

Signature (`order-start.ts:135`):

```ts
  opts: {
    userKey: string;
    auto?: boolean;
    batchOf?: number;
    /** Overrides ORDER_ENTRY_DO_PAY for this run only (admin's Stop before Pay). */
    doPay?: boolean;
    /** Ask the droplet to attach a screencast so admin can watch the run. */
    liveView?: boolean;
    /** Names admin in the history event; changes nothing else. */
    startedBy?: "admin";
  },
```

The `submitter` lookup already selects `staffCode`. Change the "Submit started." event message:

```ts
    message: opts.batchOf
      ? `Submit started (batch of ${opts.batchOf}).`
      : opts.auto
        ? "Automatic retry started."
        : opts.startedBy === "admin"
          ? submitter?.staffCode?.trim()
            ? `Submit started by admin under ${submitter.staffCode.trim()}.`
            : "Submit started by admin."
          : "Submit started.",
```

Note: the `submitter` lookup currently sits above the `prisma.order.update` that precedes the event — confirm it is declared before the `recordEvent` call (it is, at the "The staff code this run submits under" block). Body:

```ts
        // do_pay clicks the REAL, billable Pay button. Per-run override first
        // (admin's Stop before Pay), else the environment decides as before.
        do_pay: opts.doPay ?? process.env.ORDER_ENTRY_DO_PAY === "true",
        // Only an admin live submit sets this; the droplet attaches a screencast.
        live_view: opts.liveView === true,
```

- [ ] **Step 4: Run to verify it passes, plus the neighbours**

Run: `npx vitest run src/lib/__tests__/order-start-opts.test.ts src/lib/__tests__/order-start-busy.test.ts src/lib/__tests__/retry-pending-write.test.ts`
Expected: all pass.

- [ ] **Step 5: Ask the user, then commit**

```bash
git add src/lib/order-start.ts src/lib/__tests__/order-start-opts.test.ts
git commit -m "feat(order-start): per-run doPay, liveView and startedBy opts"
```

---

### Task 8: Admin actions — targets, submit, token, stop

**Files:**
- Create: `src/lib/admin-gate.ts`
- Modify: `src/actions/admin-orders.ts:38-42` (delete the local `requireAdmin`, import it)
- Modify: `src/lib/audit.ts:16-29` (`"order_admin_submitted"`)
- Create: `src/actions/admin-submit.ts`
- Test: `src/lib/__tests__/admin-submit.test.ts`

**Interfaces:**
- Consumes: `startSubmitRun` (Task 7), `mintLiveViewToken` (Task 6), `dealerSessionLive` from `@/lib/order-start`, `isRetryPending` from `@/lib/retry-policy`, `describeConnection` from `@/lib/agent-connection`, `recordAudit`/`ADMIN_ACTOR` from `@/lib/audit`.
- Produces (all `"use server"`, all admin-gated):
  - `adminSubmitTargets(): Promise<{ success: true; data: SubmitTarget[] } | { success: false; error: string; data: [] }>` where `SubmitTarget = { id; email; name; isSuperAdmin; staffCode: string | null; connection: ConnectionView }`.
  - `adminSubmitOrder(orderId: string, targetUserId: string, opts: { stopBeforePay: boolean }): Promise<{ success: true; jobId: string; viewerToken: string; expiresAt: number } | { success: false; error: string }>`.
  - `adminLiveViewToken(orderId: string): Promise<{ success: true; jobId: string; viewerToken: string; expiresAt: number } | { success: false; error: string }>`.
  - `adminStopJob(orderId: string): Promise<{ success: true; message: string } | { success: false; error: string }>`.

- [ ] **Step 1: Move `requireAdmin`**

```ts
// src/lib/admin-gate.ts
import { verifyAdminSession } from "@/lib/admin-auth";

/**
 * The gate every admin Server Action starts with. Admin is the shared JWT
 * (`verifyAdminSession`), NOT a NextAuth session — `/admin` is a separate
 * identity from a signed-in agent. Not a "use server" file, so exporting it
 * does not make it a POST-able action.
 */
export async function requireAdmin(): Promise<{ success: false; error: string } | null> {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) return { success: false, error: "Unauthorized" };
  return null;
}
```

In `src/actions/admin-orders.ts`: delete the local `requireAdmin` function (lines 38-42) and add `import { requireAdmin } from "@/lib/admin-gate";`. Delete the now-unused `import { verifyAdminSession } from "@/lib/admin-auth";` on line 4 — the moved gate was its only user.

In `src/lib/audit.ts` add `| "order_admin_submitted"` to `AuditAction` (after `"order_cloned"`).

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/admin-submit.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * adminSubmitOrder: every refusal leaves the order untouched; a good call sets
 * autoRetryDisabled, maps Stop before Pay to doPay:false, asks for the live
 * view, audits, and returns a token bound to the job.
 */
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const userFindUnique = vi.fn();
const dealerFindMany = vi.fn();
const startSubmitRun = vi.fn();
const dealerSessionLive = vi.fn();
const recordAudit = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: (...a: unknown[]) => orderFindFirst(...a), update: (...a: unknown[]) => orderUpdate(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a), findMany: (...a: unknown[]) => dealerFindMany(...a) },
  },
}));
vi.mock("@/lib/admin-gate", () => ({ requireAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-start", () => ({
  startSubmitRun: (...a: unknown[]) => startSubmitRun(...a),
  dealerSessionLive: (...a: unknown[]) => dealerSessionLive(...a),
  SCRAPER_API_URL: "http://droplet",
  ORDER_TOKEN: "test-token",
}));
vi.mock("@/lib/audit", () => ({ ADMIN_ACTOR: "admin", recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.stubGlobal("fetch", fetchMock);
process.env.ORDER_ENTRY_API_TOKEN = "test-token";

const { adminSubmitOrder, adminLiveViewToken, adminStopJob, adminSubmitTargets } = await import("@/actions/admin-submit");
const { verifyLiveViewToken } = await import("@/lib/live-view-token");

const base = { id: "ord_1", reference: "ORD-0001", status: "failed", autoRetries: 0, autoRetryAt: null, jobId: null, deletedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({ id: "u2", email: "b@x", orderEntryEnabled: true, dealerAccount: { staffCode: "TMRS00517" } });
  dealerSessionLive.mockResolvedValue(true);
  startSubmitRun.mockResolvedValue({ ok: true, jobId: "job_9" });
});

describe("adminSubmitOrder refusals leave the order untouched", () => {
  it.each([
    ["submitting", "A run is already in flight"],
    ["submitted", "already been submitted"],
    ["cancelled", "cancelled"],
  ])("status %s", async (status, words) => {
    orderFindFirst.mockResolvedValue({ ...base, status });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toContain(words);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("a pending automatic retry", async () => {
    orderFindFirst.mockResolvedValue({ ...base, autoRetryAt: new Date(), autoRetries: 1 });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("a deleted or unknown order", async () => {
    orderFindFirst.mockResolvedValue(null);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "Order not found." });
  });

  it("a target without Order Entry access", async () => {
    orderFindFirst.mockResolvedValue(base);
    userFindUnique.mockResolvedValue({ id: "u2", email: "b@x", orderEntryEnabled: false, dealerAccount: null });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("a dead dealer session, before any write", async () => {
    orderFindFirst.mockResolvedValue(base);
    dealerSessionLive.mockResolvedValue(false);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "That account's dealer session has expired — reconnect it from Order Entry first." });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(startSubmitRun).not.toHaveBeenCalled();
  });
});

describe("adminSubmitOrder happy path", () => {
  it("disables auto retry, starts under the target with live view, audits, returns a token", async () => {
    orderFindFirst.mockResolvedValue(base);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: "ord_1" }, data: { autoRetryDisabled: true } });
    expect(startSubmitRun).toHaveBeenCalledWith(base, { userKey: "u2", doPay: true, liveView: true, startedBy: "admin" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: "admin", action: "order_admin_submitted", targetOrder: "ord_1",
      detail: "Submitted ORD-0001 as b@x (TMRS00517) — job job_9.",
    }));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.jobId).toBe("job_9");
      expect(verifyLiveViewToken(res.viewerToken, "job_9", "test-token")).toBe(true);
      expect(res.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("Stop before Pay sends doPay:false and says so in the audit", async () => {
    orderFindFirst.mockResolvedValue(base);
    await adminSubmitOrder("ord_1", "u2", { stopBeforePay: true });
    expect(startSubmitRun).toHaveBeenCalledWith(base, { userKey: "u2", doPay: false, liveView: true, startedBy: "admin" });
    expect(recordAudit.mock.calls[0][0].detail).toBe("Submitted ORD-0001 as b@x (TMRS00517), stopping before Pay — job job_9.");
  });

  it("a refused start is reported and not audited as submitted", async () => {
    orderFindFirst.mockResolvedValue(base);
    startSubmitRun.mockResolvedValue({ ok: false, busy: true, error: "All 4 submit slots are busy." });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "All 4 submit slots are busy." });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("adminLiveViewToken", () => {
  it("mints for the order's current job and refuses when there is none", async () => {
    orderFindFirst.mockResolvedValue({ ...base, jobId: "job_5" });
    const ok = await adminLiveViewToken("ord_1");
    expect(ok.success).toBe(true);
    if (ok.success) expect(verifyLiveViewToken(ok.viewerToken, "job_5", "test-token")).toBe(true);
    orderFindFirst.mockResolvedValue({ ...base, jobId: null });
    expect(await adminLiveViewToken("ord_1")).toEqual({ success: false, error: "This order has no run in flight." });
  });
});

describe("adminStopJob", () => {
  it("asks the droplet to cancel the order's job and audits it", async () => {
    orderFindFirst.mockResolvedValue({ ...base, status: "submitting", jobId: "job_5" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const res = await adminStopJob("ord_1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://droplet/jobs/job_5/cancel");
    expect(res.success).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "job_released", targetOrder: "ord_1" }));
  });

  it("reports the droplet's refusal", async () => {
    orderFindFirst.mockResolvedValue({ ...base, status: "submitting", jobId: "job_5" });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "not_cancellable", message: "The run cannot be cancelled." }) });
    expect(await adminStopJob("ord_1")).toEqual({ success: false, error: "The run cannot be cancelled." });
  });
});

describe("adminSubmitTargets", () => {
  it("returns order-entry users with their connection state, superadmins first", async () => {
    dealerFindMany.mockResolvedValue([
      { id: "u1", email: "a@x", name: null, isSuperAdmin: false, dealerAccount: { staffCode: "T1", sessionExpiresAt: new Date(Date.now() + 3600_000) } },
      { id: "u2", email: "b@x", name: null, isSuperAdmin: true, dealerAccount: null },
    ]);
    const res = await adminSubmitTargets();
    expect(res.success).toBe(true);
    expect(res.data.map((t) => [t.id, t.staffCode, t.connection.state])).toEqual([["u1", "T1", "connected"], ["u2", null, "never"]]);
    expect(dealerFindMany.mock.calls[0][0].where).toEqual({ orderEntryEnabled: true });
    expect(dealerFindMany.mock.calls[0][0].orderBy).toEqual([{ isSuperAdmin: "desc" }, { email: "asc" }]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/admin-submit.test.ts`
Expected: FAIL, cannot resolve `@/actions/admin-submit`.

- [ ] **Step 4: Implement `src/actions/admin-submit.ts`**

```ts
"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { describeConnection, type ConnectionView } from "@/lib/agent-connection";
import { isRetryPending } from "@/lib/retry-policy";
import { mintLiveViewToken } from "@/lib/live-view-token";
import { dealerSessionLive, ORDER_TOKEN, SCRAPER_API_URL, startSubmitRun } from "@/lib/order-start";
import { ACTIVE_ORDER } from "@/lib/order-scope";

/**
 * Admin submits an order under a chosen agent's dealer session and watches
 * the droplet's browser drive it. Spec: context/features/admin-live-submit.md
 *
 * Every refusal here happens BEFORE any write: `startSubmitRun` files a
 * refused start as failed, which is right for an agent's Submit but wrong
 * for a dialog that has not yet committed to anything.
 */

export interface SubmitTarget {
  id: string;
  email: string | null;
  name: string | null;
  isSuperAdmin: boolean;
  staffCode: string | null;
  connection: ConnectionView;
}

const DEAD_SESSION = "That account's dealer session has expired — reconnect it from Order Entry first.";

export async function adminSubmitTargets() {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: [] as SubmitTarget[] };
  const users = await prisma.user.findMany({
    where: { orderEntryEnabled: true },
    select: {
      id: true, email: true, name: true, isSuperAdmin: true,
      dealerAccount: { select: { staffCode: true, sessionExpiresAt: true } },
    },
    orderBy: [{ isSuperAdmin: "desc" }, { email: "asc" }],
  });
  const data: SubmitTarget[] = users.map((u) => ({
    id: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin,
    staffCode: u.dealerAccount?.staffCode?.trim() || null,
    connection: describeConnection(u.dealerAccount),
  }));
  return { success: true as const, data };
}

function refusalFor(order: { status: string; autoRetries: number; autoRetryAt: Date | null }): string | null {
  if (order.status === "submitting") return "A run is already in flight for this order.";
  if (order.status === "submitted") return "This order has already been submitted.";
  if (order.status === "cancelled") return "This order was cancelled.";
  if (isRetryPending(order)) return "An automatic retry is already scheduled for this order.";
  if (!["draft", "failed", "warning"].includes(order.status)) return `An order in status "${order.status}" cannot be submitted.`;
  return null;
}

function tokenFor(jobId: string) {
  const { token, expiresAt } = mintLiveViewToken(jobId, ORDER_TOKEN);
  return { jobId, viewerToken: token, expiresAt };
}

export async function adminSubmitOrder(
  orderId: string,
  targetUserId: string,
  opts: { stopBeforePay: boolean },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const order = await prisma.order.findFirst({ where: { id: orderId, ...ACTIVE_ORDER } });
  if (!order) return { success: false as const, error: "Order not found." };
  const refusal = refusalFor(order);
  if (refusal) return { success: false as const, error: refusal };

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, orderEntryEnabled: true, dealerAccount: { select: { staffCode: true } } },
  });
  if (!target?.orderEntryEnabled) return { success: false as const, error: "That account does not have Order Entry access." };
  if (!(await dealerSessionLive(targetUserId))) return { success: false as const, error: DEAD_SESSION };

  // Precedent: clones. An admin watching a run must not be surprised by three
  // silent retries after it, and a Stop-before-Pay run retried automatically
  // would mint more unpaid orders.
  await prisma.order.update({ where: { id: orderId }, data: { autoRetryDisabled: true } });

  const started = await startSubmitRun(order, {
    userKey: targetUserId, doPay: !opts.stopBeforePay, liveView: true, startedBy: "admin",
  });
  if (!started.ok) return { success: false as const, error: started.error };

  const who = `${target.email ?? target.id}${target.dealerAccount?.staffCode ? ` (${target.dealerAccount.staffCode})` : ""}`;
  await recordAudit({
    actor: ADMIN_ACTOR, action: "order_admin_submitted", targetOrder: orderId,
    detail: `Submitted ${order.reference ?? order.id} as ${who}${opts.stopBeforePay ? ", stopping before Pay" : ""} — job ${started.jobId}.`,
  });
  return { success: true as const, ...tokenFor(started.jobId) };
}

export async function adminLiveViewToken(orderId: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const order = await prisma.order.findFirst({ where: { id: orderId }, select: { jobId: true } });
  if (!order) return { success: false as const, error: "Order not found." };
  if (!order.jobId) return { success: false as const, error: "This order has no run in flight." };
  return { success: true as const, ...tokenFor(order.jobId) };
}

/**
 * Stop the run from the live page. Only the droplet is told; the order row is
 * filed by the existing finalization (webhook / reconcile), exactly as an
 * agent's Stop is — so a stop cannot be recorded as anything but a stop.
 */
export async function adminStopJob(orderId: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const order = await prisma.order.findFirst({ where: { id: orderId }, select: { jobId: true, reference: true } });
  if (!order?.jobId) return { success: false as const, error: "This order has no run in flight." };
  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs/${encodeURIComponent(order.jobId)}/cancel`, {
      method: "POST", headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) return { success: false as const, error: body.message || body.error || "Could not stop the run." };
    await recordAudit({
      actor: ADMIN_ACTOR, action: "job_released", targetOrder: orderId,
      detail: `Stopped job ${order.jobId} from the live view of ${order.reference ?? orderId}.`,
    });
    return { success: true as const, message: "Stop requested — the browser is being torn down. The order's history will record how it ended." };
  } catch (e) {
    console.error("[adminStopJob]", e);
    return { success: false as const, error: "Could not reach the order service." };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/admin-submit.test.ts src/lib/__tests__/audit.test.ts`
Expected: all pass (the audit test walks the hook sources; if it enumerates the action union, add the new action there).

- [ ] **Step 6: Ask the user, then commit**

```bash
git add src/lib/admin-gate.ts src/actions/admin-orders.ts src/lib/audit.ts src/actions/admin-submit.ts src/lib/__tests__/admin-submit.test.ts
git commit -m "feat(admin): submit an order as admin under a chosen agent, with live view token"
```

---

### Task 9: Admin nav mapping + env

**Files:**
- Modify: `src/lib/admin-nav.ts`
- Modify: `src/lib/__tests__/admin-nav.test.ts` (append)
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test (append to `admin-nav.test.ts`)**

```ts
describe("the live run page", () => {
  it("is named Live run and goes back to its order", () => {
    expect(adminNavContext("/admin/orders/abc123/live")).toEqual({ title: "Live run", back: "/admin/orders/abc123" });
    expect(adminNavContext("/admin/orders/abc123/live/")).toEqual({ title: "Live run", back: "/admin/orders/abc123" });
  });
  it("does not change the order page itself", () => {
    expect(adminNavContext("/admin/orders/abc123")).toEqual({ title: "Order", back: "/admin/orders" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/__tests__/admin-nav.test.ts`. Expected: the first new test FAILS (title "Order").

- [ ] **Step 3: Implement** — in `adminNavContext`, BEFORE the `path.startsWith("/admin/orders/")` line:

```ts
  // The live view of a run belongs to its order, not to the orders list.
  const live = path.match(/^(\/admin\/orders\/[^/]+)\/live$/);
  if (live) return { title: "Live run", back: live[1] };
```

- [ ] **Step 4: `.env.example`** — under `SCRAPER_API_URL=http://localhost:5000` add:

```
# Public droplet URL the ADMIN'S BROWSER connects to for the live view stream
# (server-side calls use SCRAPER_API_URL). https://scraper.bizzflow.top in production.
NEXT_PUBLIC_SCRAPER_API_URL=http://localhost:5000
# Origin allowed to open the live view stream (droplet side, CORS on that one route).
LIVE_VIEW_ORIGIN=http://localhost:3000
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run src/lib/__tests__/admin-nav.test.ts`. Expected: all pass.

- [ ] **Step 6: Ask the user, then commit**

```bash
git add src/lib/admin-nav.ts src/lib/__tests__/admin-nav.test.ts .env.example
git commit -m "feat(admin): live run page in the topbar map; live view env vars"
```

---

### Task 10: The live page and `LiveRunViewer`

**Files:**
- Create: `src/components/admin/live-run-viewer.tsx`
- Create: `src/app/admin/(dashboard)/orders/[id]/live/page.tsx`

**Interfaces:**
- Consumes: `adminLiveViewToken`, `adminStopJob` (Task 8), `liveViewUrl` (Task 6), `SUBMIT_STEPS`, `progressReading` from `@/lib/order-types`, `adminGetOrderDetail` from `@/actions/admin-orders`.
- Produces: `LiveRunViewer` props `{ orderId: string; label: string; jobId: string; token: string; expiresAt: number; scraperUrl: string }`.

No unit test: the vitest environment is node (no DOM), the precedent set by every other hook/component here. Verified in the browser in Task 12.

- [ ] **Step 1: The page**

```tsx
// src/app/admin/(dashboard)/orders/[id]/live/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrderDetail } from "@/actions/admin-orders";
import { adminLiveViewToken } from "@/actions/admin-submit";
import { LiveRunViewer } from "@/components/admin/live-run-viewer";

/**
 * Watch one run's browser. The stream comes from the droplet directly (Vercel
 * cannot hold a connection for the 10-15 minutes a submit takes), so this page
 * only mints the viewer token and hands the browser the droplet's public URL.
 */
export default async function AdminLiveRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const { job } = await searchParams;
  const res = await adminGetOrderDetail(id);
  if (!res.success || !res.data) notFound();
  const order = res.data.order;
  const label = `${order.reference ?? order.fullName} · ${order.fullName}`;

  const scraperUrl = process.env.NEXT_PUBLIC_SCRAPER_API_URL ?? "http://localhost:5000";
  const jobId = job || order.jobId;
  const minted = jobId ? await adminLiveViewToken(id) : null;

  return (
    <div className="space-y-4">
      <Link href={`/admin/orders/${id}`} className="text-sm text-[#635BFF] hover:underline">← Back to the order</Link>
      {!jobId || !minted?.success ? (
        <p className="rounded-xl border border-[#E3E8EF] bg-white p-5 text-sm text-[#425466]">
          {order.status === "submitting" ? "This order's run has no job id yet — reload in a moment." : "This order has no run in flight."}
        </p>
      ) : (
        <LiveRunViewer orderId={id} label={label} jobId={minted.jobId} token={minted.viewerToken}
          expiresAt={minted.expiresAt} scraperUrl={scraperUrl} />
      )}
    </div>
  );
}
```

Note `adminLiveViewToken` mints for `order.jobId`; when `?job=` names an older job than the order's current one, the token will not match — the page passes `minted.jobId` (the current one) to the viewer so the two agree. If `?job=` differs from `order.jobId`, show the current run; the query is a hint, not an authority.

- [ ] **Step 2: The viewer**

```tsx
// src/components/admin/live-run-viewer.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { adminLiveViewToken, adminStopJob } from "@/actions/admin-submit";
import { liveViewUrl } from "@/lib/live-view-token";
import { SUBMIT_STEPS, progressReading } from "@/lib/order-types";

type Conn = "connecting" | "live" | "reconnecting" | "finished" | "unreachable" | "no_live_view" | "too_many_viewers";
interface StageRow { name: string; detail: string | null; at: string }
interface Outcome { status: string; error?: string | null; error_kind?: string | null; order_id?: string | null }

const MAX_LOG_LINES = 500;
const REFRESH_BEFORE_MS = 2 * 60 * 1000;

const CONN_LABEL: Record<Conn, string> = {
  connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", finished: "Finished",
  unreachable: "Could not reach the order service.",
  no_live_view: "Live view was not enabled for this run.",
  too_many_viewers: "Three viewers are already watching runs on the order service — close one and reload.",
};

/**
 * The droplet's screen on the left, what is happening on the right.
 *
 * Frames arrive as base64 JPEG over SSE and are painted as data URLs — no
 * blob bookkeeping, and the last frame stays up when the stream ends, which
 * is the frame that matters most.
 */
export function LiveRunViewer({ orderId, label, jobId, token: initialToken, expiresAt: initialExpiry, scraperUrl }: {
  orderId: string; label: string; jobId: string; token: string; expiresAt: number; scraperUrl: string;
}) {
  const [frame, setFrame] = useState<{ src: string; at: number } | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const cred = useRef({ token: initialToken, expiresAt: initialExpiry });
  const failures = useRef(0);
  const logBox = useRef<HTMLPreElement>(null);
  const hover = useRef(false);

  // A clock for "frame N s ago".
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const refreshToken = useCallback(async () => {
    const res = await adminLiveViewToken(orderId);
    if (!res.success) return false;
    cred.current = { token: res.viewerToken, expiresAt: res.expiresAt };
    return true;
  }, [orderId]);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const open = async () => {
      if (stopped) return;
      if (cred.current.expiresAt - Date.now() < REFRESH_BEFORE_MS) await refreshToken();
      // Probe first: EventSource cannot read a status code, and 401/404/429
      // each deserve their own sentence rather than an endless "Reconnecting…".
      try {
        const p = await fetch(liveViewUrl(scraperUrl, jobId, cred.current.token, true), { cache: "no-store" });
        if (p.status === 401) {
          if (failures.current++ === 0 && (await refreshToken())) return open();
          setConn("unreachable"); return;
        }
        if (p.status === 404) { const b = await p.json().catch(() => ({})); setConn(b.error === "no_live_view" ? "no_live_view" : "unreachable"); return; }
        if (p.status === 429) { setConn("too_many_viewers"); return; }
        if (!p.ok) { setConn("unreachable"); return; }
      } catch { setConn("unreachable"); return; }

      es = new EventSource(liveViewUrl(scraperUrl, jobId, cred.current.token));
      es.onopen = () => { failures.current = 0; setConn("live"); };
      es.addEventListener("hello", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { status: string };
        if (d.status === "done" || d.status === "error") setConn("finished");
      });
      es.addEventListener("frame", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { jpeg: string };
        setFrame({ src: `data:image/jpeg;base64,${d.jpeg}`, at: Date.now() });
      });
      es.addEventListener("stage", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as StageRow;
        setStages((s) => [...s, d]);
      });
      es.addEventListener("log", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { line: string };
        setLog((l) => [...l, ...d.line.split("\n").filter(Boolean)].slice(-MAX_LOG_LINES));
      });
      es.addEventListener("status", (e) => {
        setOutcome(JSON.parse((e as MessageEvent).data) as Outcome);
        setConn("finished");
        es?.close();
      });
      es.onerror = () => {
        if (stopped) return;
        es?.close();
        setConn((c) => (c === "finished" ? c : "reconnecting"));
        setTimeout(open, 2000);
      };
    };
    void open();
    return () => { stopped = true; es?.close(); };
  }, [jobId, scraperUrl, refreshToken]);

  // Autoscroll the log unless the pointer is over it.
  useEffect(() => {
    if (!hover.current && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [log]);

  const lastStage = stages[stages.length - 1]?.name ?? null;
  const status = outcome ? (outcome.status === "done" ? "submitted" : "failed") : "submitting";
  const reading = progressReading(lastStage, status, stages.map((s) => s.name));
  const frameAge = frame ? Math.max(0, Math.round((now - frame.at) / 1000)) : null;

  async function stop() {
    setStopping(true);
    const res = await adminStopJob(orderId);
    setStopping(false);
    setConfirmStop(false);
    if (res.success) toast.success(res.message); else toast.error(res.error);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#0A2540]">{label}</h1>
          <p className="text-xs text-[#697386]">Job <span className="font-mono">{jobId}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs ${conn === "live" ? "bg-[#ECFDF3] text-[#027A48]" : conn === "finished" ? "bg-[#F1F3F6] text-[#425466]" : "bg-[#FFFAEB] text-[#B54708]"}`}>
            {CONN_LABEL[conn]}
          </span>
          {conn !== "finished" && (
            <button type="button" onClick={() => setConfirmStop(true)} disabled={stopping}
              className="min-h-9 rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-sm font-medium text-[#B42318] hover:bg-[#FEF3F2] disabled:opacity-50">
              Stop this run
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <section className="rounded-xl border border-[#E3E8EF] bg-white p-3">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL that changes several times a second
            <img src={frame.src} alt="The droplet's browser" className="w-full rounded-md border border-[#E3E8EF]" />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-md bg-[#F6F9FC] text-sm text-[#697386]">Waiting for the browser…</div>
          )}
          <p className={`mt-2 text-xs ${frameAge !== null && frameAge > 10 ? "text-[#B54708]" : "text-[#697386]"}`}>
            {frameAge === null ? "No frame yet" : `Frame ${frameAge} s ago`}
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">{reading.heading}</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#F1F3F6]"><div className="h-1.5 rounded-full bg-[#635BFF]" style={{ width: `${reading.pct}%` }} /></div>
            <ol className="mt-3 space-y-1 text-xs">
              {SUBMIT_STEPS.map((s, i) => (
                <li key={s.key} className={i < reading.done ? "text-[#027A48]" : i === reading.current ? "font-medium text-[#0A2540]" : "text-[#98A2B3]"}>
                  {i < reading.done ? "✓ " : i === reading.current ? "▸ " : "· "}{s.label}
                </li>
              ))}
            </ol>
            {outcome && (
              <p className={`mt-3 rounded-md px-3 py-2 text-xs ${outcome.status === "done" ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                {outcome.status === "done" ? "The run finished." : `The run ended with an error${outcome.error_kind ? ` (${outcome.error_kind})` : ""}: ${outcome.error ?? ""}`}
                {outcome.order_id ? ` Portal order ${outcome.order_id}.` : ""}{" "}
                <a href={`/admin/orders/${orderId}`} className="underline">Open the order</a>
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">Stages</p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[#425466]">
              {stages.length === 0 && <li className="text-[#98A2B3]">Nothing reported yet.</li>}
              {stages.map((s, i) => (
                <li key={`${s.at}-${i}`}><span className="font-mono text-[#98A2B3]">{s.at.slice(11, 19)}</span> {s.name}{s.detail ? ` — ${s.detail}` : ""}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">Run log</p>
            <pre ref={logBox} onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}
              className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#0A2540] p-3 font-mono text-[11px] leading-4 text-[#E3E8EF]">
              {log.length === 0 ? "Waiting for the log…" : log.join("\n")}
            </pre>
          </section>
        </aside>
      </div>

      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4" role="dialog" aria-modal="true" aria-labelledby="stop-run-title">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="stop-run-title" className="text-base font-semibold text-[#0A2540]">Stop this run?</h3>
            <p className="mt-2 text-sm text-[#425466]">
              The browser is torn down where it stands. The portal mints the Customer Order Number early, so a run stopped mid-flight can leave a real order at Unifi — check the portal before submitting again.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmStop(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Keep running</button>
              <button type="button" onClick={stop} disabled={stopping} className="rounded-md bg-[#B42318] px-3 py-2 text-sm text-white disabled:opacity-50">{stopping ? "Stopping…" : "Stop the run"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

`progressReading` takes `(stage, status, observedStages)` — pass the stage NAMES; `stepsCompleted` expects names. Check `ProgressReading` has `pct`, `heading`, `done`, `current` (it does, `order-types.ts:1216-1235`).

- [ ] **Step 3: Type-check and lint** — `npx tsc --noEmit -p . 2>&1 | grep -v "pre-existing"` shows no NEW errors (3 pre-existing are known); `npx eslint src/components/admin/live-run-viewer.tsx "src/app/admin/(dashboard)/orders/[id]/live/page.tsx"` is clean. If `react-hooks/set-state-in-effect` flags the autoscroll effect, it sets a DOM property, not state, so it should not; if it flags anything, defer with `requestAnimationFrame` as the repo does elsewhere.

- [ ] **Step 4: Ask the user, then commit**

```bash
git add src/components/admin/live-run-viewer.tsx "src/app/admin/(dashboard)/orders/[id]/live/page.tsx"
git commit -m "feat(admin): live run page streaming the droplet's browser"
```

---

### Task 11: Submit-as-admin dialog and the Watch live link

**Files:**
- Create: `src/components/admin/submit-as-admin-button.tsx`
- Modify: `src/components/admin/order-detail.tsx` (`AdminOrderView` gains `jobId: string | null`; header renders the button and the link)
- Modify: `src/app/admin/(dashboard)/orders/[id]/page.tsx` (pass `jobId: order.jobId`)

**Interfaces:**
- Consumes: `adminSubmitOrder`, `adminSubmitTargets`, `SubmitTarget` (Task 8).

- [ ] **Step 1: The button + dialog**

```tsx
// src/components/admin/submit-as-admin-button.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { adminSubmitOrder, adminSubmitTargets, type SubmitTarget } from "@/actions/admin-submit";

const ELIGIBLE = new Set(["draft", "failed", "warning"]);
const STOP_BEFORE_PAY_HELP = "The run stops on the Pay screen. The portal will already hold an unpaid order number for this customer, which must be paid or voided by hand.";

/**
 * Submit this order under a chosen agent's dealer session and watch it run.
 *
 * The live tab is opened SYNCHRONOUSLY in the click handler and navigated
 * once the run has started — a tab opened after an await is what popup
 * blockers eat. If the start fails, the tab is closed again.
 */
export function SubmitAsAdminButton({ orderId, label, status, portalOrderNo }: {
  orderId: string; label: string; status: string; portalOrderNo: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<SubmitTarget[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [stopBeforePay, setStopBeforePay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  if (status === "submitted" || status === "cancelled") return null;

  async function openDialog() {
    setOpen(true); setError(null); setFallbackUrl(null);
    if (targets) return;
    const res = await adminSubmitTargets();
    if (!res.success) { toast.error(res.error ?? "Could not load accounts."); return; }
    setTargets(res.data);
    setTargetId(res.data.find((t) => t.connection.state === "connected" || t.connection.state === "expiring")?.id ?? "");
  }

  async function confirm() {
    setBusy(true); setError(null);
    const tab = window.open("", "_blank");
    const res = await adminSubmitOrder(orderId, targetId, { stopBeforePay });
    setBusy(false);
    if (!res.success) { tab?.close(); setError(res.error); return; }
    const url = `/admin/orders/${orderId}/live?job=${encodeURIComponent(res.jobId)}`;
    if (tab) { tab.location.href = url; setOpen(false); toast.success("Run started — watching it in the new tab."); }
    else setFallbackUrl(url);
  }

  const notEligible = !ELIGIBLE.has(status);
  const chosen = targets?.find((t) => t.id === targetId);
  const canConfirm = !busy && !!chosen && (chosen.connection.state === "connected" || chosen.connection.state === "expiring") && !notEligible;

  return (
    <>
      <button type="button" onClick={openDialog}
        className="min-h-9 rounded-md bg-[#635BFF] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#5851E0] focus-visible:outline-2 focus-visible:outline-[#635BFF]">
        Submit as…
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4"
          role="dialog" aria-modal="true" aria-labelledby="submit-admin-title"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="submit-admin-title" className="text-base font-semibold text-[#0A2540]">Submit {label} as an agent</h3>

            {notEligible ? (
              <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-sm text-[#B54708]">
                {status === "submitting" ? "A run is already in flight for this order." : `An order in status "${status}" cannot be submitted.`}
              </p>
            ) : fallbackUrl ? (
              <p className="mt-2 text-sm text-[#425466]">
                The run has started, but the browser blocked the new tab.{" "}
                <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-[#635BFF] underline">Open the live view</a>
              </p>
            ) : (
              <>
                <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                  This mints a <strong>real Unifi order</strong> under the chosen account&apos;s staff code.
                  {status === "warning" && portalOrderNo && (
                    <> The portal already holds order <span className="font-mono">{portalOrderNo}</span> for this customer — a second run creates a <strong>second</strong> order that will need voiding.</>
                  )}
                </p>
                <label className="mt-4 block text-xs text-[#697386]">
                  Submit under
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!targets}
                    className="mt-1 w-full rounded-md border border-[#E3E8EF] bg-white px-3 py-2 text-sm text-[#0A2540]">
                    {!targets && <option>Loading accounts…</option>}
                    {targets?.length === 0 && <option value="">No Order Entry accounts</option>}
                    {targets?.map((t) => (
                      <option key={t.id} value={t.id} disabled={t.connection.state === "expired" || t.connection.state === "never"}>
                        {t.email ?? t.name ?? t.id}{t.staffCode ? ` · ${t.staffCode}` : ""} — {t.connection.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm text-[#0A2540]">
                  <input type="checkbox" checked={stopBeforePay} onChange={(e) => setStopBeforePay(e.target.checked)} className="mt-1" />
                  <span>Stop before Pay<span className="block text-xs text-[#697386]">{STOP_BEFORE_PAY_HELP}</span></span>
                </label>
                <p className="mt-3 text-xs text-[#697386]">Automatic retry is switched off for this order from now on.</p>
                {error && <p className="mt-3 rounded-md bg-[#FEF3F2] px-3 py-2 text-sm text-[#B42318]">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Cancel</button>
                  <button type="button" onClick={confirm} disabled={!canConfirm}
                    className="rounded-md bg-[#635BFF] px-3 py-2 text-sm text-white disabled:opacity-50">
                    {busy ? "Starting…" : "Start and watch"}
                  </button>
                </div>
              </>
            )}
            {(notEligible || fallbackUrl) && (
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire it into the detail view**

In `AdminOrderView` add `jobId: string | null;`. In `AdminOrderDetail`'s header `<div className="flex flex-col items-end gap-1">`, beneath the status pill and before `CloneOrderButton`:

```tsx
            {order.status === "submitting" && order.jobId && (
              <a href={`/admin/orders/${order.id}/live`} target="_blank" rel="noreferrer"
                className="text-xs font-medium text-[#635BFF] hover:underline">Watch live ↗</a>
            )}
            {!order.deletedAt && (
              <SubmitAsAdminButton orderId={order.id} label={order.reference ?? order.fullName}
                status={order.status} portalOrderNo={order.orderId} />
            )}
```

Import `SubmitAsAdminButton`. In the page, add `jobId: order.jobId,` to the object passed as `order`.

- [ ] **Step 3: Build, lint, tests**

Run: `npm run build` (clean), `npx eslint src/components/admin "src/app/admin/(dashboard)/orders"` (clean), `npx vitest run` (all passing, the 4 Playwright e2e files vitest collects are the pre-existing failures).

- [ ] **Step 4: Ask the user, then commit**

```bash
git add src/components/admin/submit-as-admin-button.tsx src/components/admin/order-detail.tsx "src/app/admin/(dashboard)/orders/[id]/page.tsx"
git commit -m "feat(admin): Submit as… dialog opens the live view; Watch live link on in-flight orders"
```

---

### Task 12: Dev demo, browser verification, docs

**Files:**
- Create: `scraper/devtools/live_view_demo.py`
- Modify: `context/current-feature.md` (status + verified section)

- [ ] **Step 1: The demo script**

```python
# scraper/devtools/live_view_demo.py
"""Exercise the live view end to end WITHOUT a dealer session.

Registers a fake live_view job in a running local api_server (same process is
impossible — this talks to it over HTTP), then screencasts a public page into
that job's store... which lives in the OTHER process. So instead this script
IS the server: it imports api_server, registers the job in-process, attaches
the screencast, and serves Flask on :5000 for the Next.js dev server to reach.

Usage (from scraper/, in the 3.12 venv, with ORDER_ENTRY_API_TOKEN in .env):
    python devtools/live_view_demo.py
Then in Next.js dev, set any order's job_id to the printed job id (a one-line
prisma update) and open /admin/orders/<id>/live.
"""
import asyncio
import os
import sys
import threading
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("LIVE_VIEW_ORIGIN", "http://localhost:3000")

import api_server  # noqa: E402
import live_view  # noqa: E402

JOB_ID = "demo0000000000000000000000000000"


def _serve():
    api_server.app.run(host="0.0.0.0", port=5000, threaded=True, use_reloader=False)


async def _drive():
    from playwright.async_api import async_playwright
    log_path = os.path.join(api_server._logs_dir(), f"{JOB_ID}.log")
    with api_server.JOBS_LOCK:
        api_server.JOBS[JOB_ID] = {"status": "running", "live_view": True, "log_path": log_path,
                                   "created_at": datetime.utcnow().isoformat(),
                                   "started_at": datetime.utcnow().isoformat(),
                                   "params": {"kind": "order_entry", "user_key": "demo"}, "stages": []}
    print(f"demo job registered: {JOB_ID}")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto("https://example.com")
        session = await live_view.attach(page, JOB_ID)
        stages = ["validating_draft", "checking_session", "creating_customer", "checking_address",
                  "checking_plan", "placing_order", "attaching_customer", "capturing_order_no"]
        with open(log_path, "a") as lf:
            for i, st in enumerate(stages):
                entry = {"name": st, "detail": None if i % 2 else f"detail {i}",
                         "at": datetime.utcnow().isoformat() + "Z"}
                with api_server.JOBS_LOCK:
                    api_server.JOBS[JOB_ID]["stage"] = st
                    api_server.JOBS[JOB_ID]["stages"].append(entry)
                live_view.publish_stage(JOB_ID, entry)
                lf.write(f"[{datetime.utcnow().isoformat()}] stage {st}\n"); lf.flush()
                await page.evaluate(f"document.body.style.background='hsl({i * 40},60%,85%)'; document.title='{st}'")
                await page.evaluate(f"document.querySelector('h1').textContent='Step {i + 1}: {st}'")
                await asyncio.sleep(6)
        await live_view.detach(JOB_ID, session)
        with api_server.JOBS_LOCK:
            api_server.JOBS[JOB_ID].update(status="done", finished_at=datetime.utcnow().isoformat(),
                                           result={"status": "success", "order_id": "2609000000000000"})
        await browser.close()
    print("demo run finished; server still up — Ctrl-C to quit")


if __name__ == "__main__":
    threading.Thread(target=_serve, daemon=True).start()
    asyncio.run(_drive())
    threading.Event().wait()
```

- [ ] **Step 2: Verify in the browser**

1. `.env`: `NEXT_PUBLIC_SCRAPER_API_URL=http://localhost:5000`, `LIVE_VIEW_ORIGIN=http://localhost:3000`. Start `npm run dev`. Start the demo script (it serves on :5000, so the real local `api_server` must not be running).
2. Point a dev order at the demo job: `npx prisma db execute --stdin <<< "UPDATE orders SET job_id='demo0000000000000000000000000000', status='submitting' WHERE id='<a dev order id>';"` (record the previous values to restore).
3. Mint an admin session the standing way (a token from `createAdminSession`'s secret; no password in the transcript). Open `/admin/orders/<id>`: **Watch live ↗** renders. Open `/admin/orders/<id>/live`: chip goes Connecting → Live; frames appear and change colour every ~6 s; the step list advances to Step 8; stages list fills with times; the log box shows the `stage …` lines and autoscrolls; after the last stage the chip reads Finished with "The run finished. Portal order 2609000000000000" and the last frame stays. Zero console errors.
4. Refusals: open the live page with the demo stopped → "Could not reach the order service."; edit the token in the URL → the page refreshes it and connects (one 401 then live); set `JOBS[JOB_ID]["live_view"] = False` in the demo → "Live view was not enabled for this run."; open 4 tabs → the fourth reads the viewer-cap sentence.
5. Dialog: on a `failed` dev order, **Submit as…** lists accounts with their connection labels, disables the dead ones, shows the Stop-before-Pay help text and the retry line; on a `submitted` order the button is absent; on a `submitting` one the in-flight sentence shows. Do NOT press Start and watch against the real droplet unless the user asks — it mints an order.
6. 375 px: the live page stacks to one column with no horizontal overflow.
7. Restore the dev order's `job_id` and `status`.

- [ ] **Step 3: Docs** — in `context/current-feature.md`, change the status to `CODE COMPLETE, VERIFIED IN BROWSER AGAINST THE DEMO (branch feature/admin-live-submit, not committed)`, add a `## Verified` section listing exactly what step 2 showed, and a `## NOT verified` section: a real admin submit against the portal; the screencast on the real portal page (the demo uses example.com); the Stop button against a real run (it calls the same cancel route `adminReleaseJob` already uses); production. Update the spec's Status line the same way.

- [ ] **Step 4: Full suites** — `npm run build`, `npx vitest run`, `npx eslint .` count identical to baseline apart from the new files being clean, and the scraper suite `<venv312>/bin/python -m pytest -q` all green. Report the counts.

- [ ] **Step 5: Ask the user, then commit**

```bash
git add scraper/devtools/live_view_demo.py context/current-feature.md context/features/admin-live-submit.md
git commit -m "docs(live-view): demo script and verification notes"
```

Then stop: merge, droplet deploy (`scraper-v2026.09.16-1`, container recreated, `LIVE_VIEW_ORIGIN` in the droplet `.env`), and Vercel env (`NEXT_PUBLIC_SCRAPER_API_URL`) are the user's calls — droplet first, then Vercel.

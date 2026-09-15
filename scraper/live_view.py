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

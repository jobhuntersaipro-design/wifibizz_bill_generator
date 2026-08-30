"""
r2_download.py - Fetch order documents from Cloudflare R2 for upload into the
dealer portal.

Order documents (ID copies, utility bills) are stored by BizzFlow in R2 under
per-user keys (orders/<userId>/<filename>). The portal's attachment field needs
the actual file, so the backend downloads it here (R2 is S3-compatible) into a
temp file and hands the path to Playwright's set_input_files.

Uses the same R2 credentials the Next.js app uses, loaded from the project .env.
"""

import os
import tempfile

import boto3
from botocore.config import Config

# Every R2 call this module makes is bounded by these. Overridable so a slow
# link can be given room without a code change, but never unbounded.
R2_CONNECT_TIMEOUT = float(os.environ.get("R2_CONNECT_TIMEOUT", "10"))
R2_READ_TIMEOUT = float(os.environ.get("R2_READ_TIMEOUT", "30"))
R2_MAX_ATTEMPTS = int(os.environ.get("R2_MAX_ATTEMPTS", "3"))
# Wall-clock cap on one download_many() call, however many keys it is given.
R2_TOTAL_BUDGET = float(os.environ.get("R2_TOTAL_BUDGET", "120"))

_client = None


def _r2():
    global _client
    if _client is None:
        account = os.environ["R2_ACCOUNT_ID"]
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(
                signature_version="s3v4",
                # Bounded on purpose. Without these botocore waits on its
                # defaults and `download_file` blocks on an s3transfer future
                # that has no timeout at all — which on 2026-08-29 held the
                # droplet's global single-browser lock for 6h40m, because this
                # call runs inside the submit coroutine and a blocked event loop
                # cannot fire the run's own 600s asyncio.wait_for.
                connect_timeout=R2_CONNECT_TIMEOUT,
                read_timeout=R2_READ_TIMEOUT,
                retries={"max_attempts": R2_MAX_ATTEMPTS, "mode": "standard"},
            ),
        )
    return _client


def download_r2_object(key: str, dest_dir: str | None = None) -> str:
    """Download an R2 object by key to a temp file and return its local path.

    The basename of the key is preserved so the portal shows the real filename.
    Raises on missing key / credentials (caller decides whether that's fatal).
    """
    bucket = os.environ["R2_BUCKET_NAME"]
    dest_dir = dest_dir or tempfile.mkdtemp(prefix="oe_docs_")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(key))
    _r2().download_file(bucket, key, dest)
    return dest


def download_many(keys: list[str], dest_dir: str | None = None,
                  budget_s: float | None = None) -> list[str]:
    """Download several R2 objects; returns the local paths (skips failures).

    `budget_s` caps the WHOLE list, not each key. The per-request timeouts above
    bound one call, but an order carrying several documents multiplies them, and
    the caller (a submit run) has its own deadline to respect. Keys not reached
    inside the budget are skipped and named — a submit missing an attachment is
    recoverable; one that never starts is not.
    """
    import time

    budget_s = R2_TOTAL_BUDGET if budget_s is None else budget_s
    deadline = time.monotonic() + budget_s
    dest_dir = dest_dir or tempfile.mkdtemp(prefix="oe_docs_")
    paths = []
    for i, k in enumerate(keys):
        if time.monotonic() >= deadline:
            print(f"  ⚠ R2 download budget of {budget_s:.0f}s spent — "
                  f"skipping {len(keys) - i} remaining document(s)")
            break
        try:
            paths.append(download_r2_object(k, dest_dir))
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ R2 download failed for {k}: {e}")
    return paths

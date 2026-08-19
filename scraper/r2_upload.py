"""
r2_upload.py - Push artefacts captured during an order run into Cloudflare R2.

The mirror of r2_download.py: that pulls customer documents down so Playwright
can attach them to the portal, this pushes what the portal showed back up so
BizzFlow can display it.

The artefacts are the detail screens of a submit — one frame per slot: the
New Connection page 1, each sub-product tab, the Customer Order Information
page, the appointment, the delivery terms and the Pay screen. Together they are
the evidence for what was actually ordered; page 1 alone proves the order
exists, not which device or appointment slot it carries.

Keys live under their own top-level prefix:

    order-screenshots/<userId>/<orderId>/submit-<attempt>-<slot>.jpg

separate from `orders/<userId>/...` (customer ID copies, utility bills) on
purpose: R2 lifecycle rules filter by prefix only, so screenshots need their own
prefix to expire on a 90-day schedule without touching the documents, which
must not expire.

Uses the same R2 credentials as r2_download.py, loaded from the project .env.
"""

import os
import re

import boto3
from botocore.config import Config

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
            config=Config(signature_version="s3v4"),
        )
    return _client


def slot_slug(slot: str) -> str:
    """A filesystem/URL-safe slot name.

    Sub-product slots are derived from the tab text the PORTAL reports, which we
    do not control — it can carry spaces, brackets, slashes or non-ASCII. Those
    would land in an R2 key and in a URL query string, so anything outside
    [a-z0-9_] collapses to a single underscore and the result is bounded. An
    empty result falls back to `screen` rather than producing `submit-1-.jpg`.
    """
    s = re.sub(r"[^a-z0-9]+", "_", (slot or "").strip().lower()).strip("_")
    return (s[:32].rstrip("_") or "screen")


def screenshot_key(user_id: str, order_id: str, attempt: int = 1,
                   slot: str = "page1") -> str:
    """The R2 key for one screen captured during one submit attempt.

    Per attempt AND per slot: a retried order has its own set of frames, and
    within an attempt each detail screen is filed under the slot it documents so
    the panel can put every picture next to the step it belongs to.

    JPEG, not PNG: the portal UI is flat colour and nine PNGs per attempt run to
    ~4.5MB against ~1.4MB as JPEG, with no loss that matters on screen text.
    """
    return (f"order-screenshots/{user_id}/{order_id}/"
            f"submit-{int(attempt)}-{slot_slug(slot)}.jpg")


def erf_key(user_id: str, order_id: str, order_no: str) -> str:
    """The R2 key for the e-RF (electronic Registration Form) PDF of one order.

    Named after the PORTAL's order number rather than the attempt, because that
    is the number printed on the document and the number a dispute will quote.
    `submit-3-erf.pdf` is unidentifiable the moment it leaves the browser, and
    the download serves this key's own basename as the filename. The portal mints
    a fresh number per attempt, so this stays unique across resubmits with no
    attempt counter.

    Same `order-screenshots/` prefix as the frames, so the 90-day lifecycle rule
    (which filters by prefix) expires the form with the evidence it belongs to —
    it deliberately does NOT live under `orders/`, where nothing expires.

    The order number reaches a key and a URL, so it is stripped to [A-Za-z0-9].
    An empty result falls back to `order`, never to a bare `_erf.pdf`.
    """
    safe = re.sub(r"[^A-Za-z0-9]+", "", order_no or "")[:32] or "order"
    return f"order-screenshots/{user_id}/{order_id}/{safe}_erf.pdf"


def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    """Put an object into R2 and return its key.

    Returns the key, not a public URL — the bucket is private and reads go
    through BizzFlow's auth-gated route, which scopes them to the owning user.
    Raises on missing key / credentials; the caller decides whether that matters
    (for screenshots it never does — see capture_screen).
    """
    _r2().put_object(
        Bucket=os.environ["R2_BUCKET_NAME"],
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key

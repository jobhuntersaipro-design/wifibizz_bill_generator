"""
r2_upload.py - Push artefacts captured during an order run into Cloudflare R2.

The mirror of r2_download.py: that pulls customer documents down so Playwright
can attach them to the portal, this pushes what the portal showed back up so
BizzFlow can display it.

Currently one artefact: the page-1 screenshot of the New Connection page, taken
once Winback Tagging resolves. It is the audit frame for a submit — Customer
Order Number, installation address, installation contact, main offer, account
and winback tagging, in one image, as the portal rendered them.

Keys live under their own top-level prefix:

    order-screenshots/<userId>/<orderId>/submit-<attempt>-page1.png

separate from `orders/<userId>/...` (customer ID copies, utility bills) on
purpose: R2 lifecycle rules filter by prefix only, so screenshots need their own
prefix to expire on a 90-day schedule without touching the documents, which
must not expire.

Uses the same R2 credentials as r2_download.py, loaded from the project .env.
"""

import os

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


def screenshot_key(user_id: str, order_id: str, attempt: int = 1) -> str:
    """The R2 key for one submit attempt's page-1 screenshot.

    Per attempt, not per order: a retried order has one frame per attempt and
    the detail panel shows each one against its own timeline.
    """
    return f"order-screenshots/{user_id}/{order_id}/submit-{int(attempt)}-page1.png"


def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    """Put an object into R2 and return its key.

    Returns the key, not a public URL — the bucket is private and reads go
    through BizzFlow's auth-gated route, which scopes them to the owning user.
    Raises on missing key / credentials; the caller decides whether that matters
    (for screenshots it never does — see capture_page1_screenshot).
    """
    _r2().put_object(
        Bucket=os.environ["R2_BUCKET_NAME"],
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key

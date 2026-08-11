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


def download_many(keys: list[str], dest_dir: str | None = None) -> list[str]:
    """Download several R2 objects; returns the local paths (skips failures)."""
    dest_dir = dest_dir or tempfile.mkdtemp(prefix="oe_docs_")
    paths = []
    for k in keys:
        try:
            paths.append(download_r2_object(k, dest_dir))
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ R2 download failed for {k}: {e}")
    return paths

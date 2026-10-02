"""
doc_urls.py - Fetch a SmartPortal order document from a pre-signed link.

SmartPortal's documents live in its own R2 bucket, and the droplet holds no key
to it on purpose: an R2 key cannot be narrowed to a folder or made write-only,
and that bucket holds ~158,000 customer IC scans. Instead each document arrives
as a short-lived pre-signed HTTPS GET:

    {"type": "mykad", "url": "https://…", "file_name": "ic-front.jpg"}

This service fetches a URL it was handed, so every download is fenced:

  * HTTPS only, to a host listed in SMARTPORTAL_DOCUMENT_HOSTS (exact match),
    on the default port, with no credentials in the URL. That is what stops
    the service being pointed at an internal address.
  * No redirects. 30 seconds wall-clock. 10 MB cap, enforced while reading.
  * Content-Type must be image/jpeg, image/png, image/webp or application/pdf.
  * The full URL is never logged: its query string IS the credential. Only the
    host and path are printed, and a library exception's own text (which can
    quote the URL) is never printed either — only its type.
"""

import os
import re
import tempfile
import time
from urllib.parse import urlsplit

DOC_HOSTS_ENV = "SMARTPORTAL_DOCUMENT_HOSTS"
DOWNLOAD_TIMEOUT_S = 30.0
MAX_BYTES = 10 * 1024 * 1024
# Wall-clock cap on one download_many() call, matching r2_download's budget.
TOTAL_BUDGET_S = float(os.environ.get("DOC_URL_TOTAL_BUDGET", "120"))

ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


class DocUrlError(ValueError):
    """A link or a download was refused. The message never contains the URL."""


def allowed_hosts() -> set[str]:
    raw = os.environ.get(DOC_HOSTS_ENV, "")
    return {h.strip().lower().rstrip(".") for h in raw.split(",") if h.strip()}


def safe_display(url) -> str:
    """`https://host/path` — never the query string or anything after it."""
    try:
        parts = urlsplit(str(url))
        host = parts.hostname or "?"
        return f"{parts.scheme}://{host}{parts.path}"
    except Exception:  # noqa: BLE001
        return "(unparseable link)"


def check_url(url) -> None:
    """Raise DocUrlError unless the link may be fetched."""
    if not isinstance(url, str) or not url:
        raise DocUrlError("missing `url`")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise DocUrlError("`url` is not a valid link") from None
    if parts.scheme != "https":
        raise DocUrlError("`url` must be https")
    if parts.username is not None or parts.password is not None:
        raise DocUrlError("`url` must not carry credentials")
    if port not in (None, 443):
        raise DocUrlError("`url` must use the default https port")
    host = (parts.hostname or "").lower().rstrip(".")
    hosts = allowed_hosts()
    if not hosts:
        raise DocUrlError(f"document links are disabled ({DOC_HOSTS_ENV} is not set)")
    if host not in hosts:
        raise DocUrlError(f"host {host or '?'} is not an allowed document host")


def safe_file_name(file_name, content_type: str) -> str:
    """A filesystem- and portal-safe name, with the extension the type implies.

    The portal shows this name on the attachment, so the caller's name is kept
    as far as it is safe; anything else is dropped rather than guessed at.
    """
    base = os.path.basename(str(file_name or "").replace("\\", "/"))
    base = re.sub(r"[^A-Za-z0-9 ._()-]+", "", base).strip(" .")[:100]
    ext = ALLOWED_TYPES[content_type]
    stem, cur = os.path.splitext(base)
    if not stem:
        stem = "document"
    # A JPEG named .png would be refused or mis-shown by the portal; the bytes
    # decide the extension, not the name.
    if cur.lower() not in ((ext, ".jpeg") if ext == ".jpg" else (ext,)):
        cur = ext
    return f"{stem}{cur}"


def _get(url):
    """The HTTP call, split out so tests can swap it. Returns a streaming response."""
    import requests

    return requests.get(url, allow_redirects=False, stream=True,
                        timeout=(10, DOWNLOAD_TIMEOUT_S),
                        headers={"Accept": ", ".join(ALLOWED_TYPES)})


def download_doc(doc: dict, dest_dir: str | None = None, now=time.monotonic) -> str:
    """Download one `{url, file_name}` document and return its local path."""
    url = (doc or {}).get("url")
    check_url(url)
    shown = safe_display(url)
    deadline = now() + DOWNLOAD_TIMEOUT_S
    try:
        resp = _get(url)
    except Exception as e:  # noqa: BLE001 — its text can quote the URL
        raise DocUrlError(f"{shown}: request failed ({type(e).__name__})") from None
    try:
        if 300 <= resp.status_code < 400:
            raise DocUrlError(f"{shown}: redirect refused ({resp.status_code})")
        if resp.status_code != 200:
            raise DocUrlError(f"{shown}: answered {resp.status_code}")
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype not in ALLOWED_TYPES:
            raise DocUrlError(f"{shown}: content type {ctype or 'missing'} not accepted")
        length = resp.headers.get("Content-Length")
        if length and length.isdigit() and int(length) > MAX_BYTES:
            raise DocUrlError(f"{shown}: larger than {MAX_BYTES // (1024 * 1024)} MB")

        chunks, total = [], 0
        try:
            for chunk in resp.iter_content(64 * 1024):
                if now() > deadline:
                    raise DocUrlError(f"{shown}: took longer than {DOWNLOAD_TIMEOUT_S:.0f}s")
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_BYTES:
                    raise DocUrlError(f"{shown}: larger than {MAX_BYTES // (1024 * 1024)} MB")
                chunks.append(chunk)
        except DocUrlError:
            raise
        except Exception as e:  # noqa: BLE001
            raise DocUrlError(f"{shown}: read failed ({type(e).__name__})") from None
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass

    dest_dir = dest_dir or tempfile.mkdtemp(prefix="oe_docs_")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, safe_file_name(doc.get("file_name"), ctype))
    with open(dest, "wb") as f:
        f.write(b"".join(chunks))
    return dest


def download_many(docs: list, dest_dir: str | None = None,
                  budget_s: float | None = None) -> list[str]:
    """Download several documents; returns the local paths (skips failures).

    Same contract as r2_download.download_many, so the submit flow treats a
    link exactly like a bucket key: a failure is named in the run log and the
    rest still go.
    """
    budget_s = TOTAL_BUDGET_S if budget_s is None else budget_s
    deadline = time.monotonic() + budget_s
    dest_dir = dest_dir or tempfile.mkdtemp(prefix="oe_docs_")
    paths = []
    for i, doc in enumerate(docs or []):
        if time.monotonic() >= deadline:
            print(f"  ⚠ document link budget of {budget_s:.0f}s spent — "
                  f"skipping {len(docs) - i} remaining document(s)")
            break
        try:
            # One folder per document, so two files with one name cannot
            # overwrite each other.
            paths.append(download_doc(doc, os.path.join(dest_dir, str(i))))
        except DocUrlError as e:
            print(f"  ⚠ document link refused: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ document link failed for {safe_display((doc or {}).get('url'))}: "
                  f"{type(e).__name__}")
    return paths

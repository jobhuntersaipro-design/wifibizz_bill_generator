"""
capture_store.py - Captures kept ON THE DROPLET, for clients that own their bucket.

BizzFlow's captures (and e-RFs) go to BizzFlow's R2 bucket, as they always have.
A SmartPortal run must not: its frames would land in a bucket SmartPortal cannot
read, and the alternative — giving the droplet a key to SmartPortal's bucket —
would also hand it read access to every IC scan in there (R2 keys cannot be
limited to a folder or made write-only).

So a SmartPortal job's captures are written here instead:

    <CAPTURES_DIR>/<job_id>/.owner          the client that created the job
    <CAPTURES_DIR>/<job_id>/submit-1-page1.jpg
    <CAPTURES_DIR>/<job_id>/2608000123456789_erf.pdf

and served by GET /jobs/<job_id>/captures/<name> to the owning client only.
The stage history carries the bare <name>. Directories are deleted
CAPTURE_RETAIN_DAYS (default 7) after the job started.

The owner is written to disk rather than read from the in-memory job registry
because captures outlive both the registry's 24h retention and a restart.
"""

import os
import re
import shutil
import threading
import time

CAPTURES_DIR = os.environ.get("CAPTURES_DIR") or os.path.join(os.getcwd(), "captures")
RETAIN_DAYS = float(os.environ.get("CAPTURE_RETAIN_DAYS", "7"))
OWNER_FILE = ".owner"

# A job id becomes a directory name and a capture name becomes a file name, and
# both arrive in URLs (a batch member's job id is chosen by the caller), so both
# are held to a fixed alphabet: no separators, no "..", no leading dot.
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_NAME = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$")

CONTENT_TYPES = {".jpg": "image/jpeg", ".pdf": "application/pdf"}

_prune_lock = threading.Lock()
_last_prune = [0.0]
PRUNE_EVERY_S = 3600


def valid_job_id(job_id) -> bool:
    return isinstance(job_id, str) and bool(_JOB_ID.match(job_id))


def valid_name(name) -> bool:
    return (isinstance(name, str) and bool(_NAME.match(name)) and ".." not in name
            and os.path.splitext(name)[1].lower() in CONTENT_TYPES)


def job_dir(job_id: str, root: str | None = None) -> str:
    if not valid_job_id(job_id):
        raise ValueError("invalid job id")
    return os.path.join(root or CAPTURES_DIR, job_id)


def create(job_id: str, client: str, root: str | None = None) -> str:
    """Make the job's capture directory and record who owns it."""
    d = job_dir(job_id, root)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, OWNER_FILE), "w") as f:
        f.write(client)
    return d


def owner(job_id: str, root: str | None = None) -> str | None:
    try:
        with open(os.path.join(job_dir(job_id, root), OWNER_FILE)) as f:
            return f.read().strip() or None
    except (OSError, ValueError):
        return None


def save(directory: str, name: str, data: bytes) -> str:
    """Write one capture and return its name. Atomic: a reader never sees half."""
    if not valid_name(name):
        raise ValueError(f"invalid capture name {name!r}")
    if not os.path.isfile(os.path.join(directory, OWNER_FILE)):
        # Only a directory the API server created for this job may be written.
        raise ValueError("capture directory was not created for this job")
    tmp = os.path.join(directory, f".{name}.tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, os.path.join(directory, name))
    return name


def path_for(job_id: str, name: str, root: str | None = None) -> str | None:
    """The file to serve, or None. Never resolves outside the job's directory."""
    if not valid_job_id(job_id) or not valid_name(name):
        return None
    d = os.path.realpath(job_dir(job_id, root))
    p = os.path.realpath(os.path.join(d, name))
    if os.path.dirname(p) != d or not os.path.isfile(p):
        return None
    return p


def list_captures(job_id: str, root: str | None = None) -> list[dict]:
    try:
        d = job_dir(job_id, root)
        names = sorted(os.listdir(d))
    except (OSError, ValueError):
        return []
    out = []
    for n in names:
        if not valid_name(n):
            continue
        p = os.path.join(d, n)
        if os.path.isfile(p):
            out.append({"name": n, "size": os.path.getsize(p),
                        "content_type": content_type(n)})
    return out


def content_type(name: str) -> str:
    return CONTENT_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")


def prune(root: str | None = None, retain_days: float | None = None, now: float | None = None) -> int:
    """Delete job directories older than the retention. Returns how many went.

    Age is the owner file's mtime — when the job was created. A run is capped
    at well under an hour, so no directory a run is still writing can qualify.
    """
    root = root or CAPTURES_DIR
    retain_s = (RETAIN_DAYS if retain_days is None else retain_days) * 86400
    now = time.time() if now is None else now
    try:
        entries = os.listdir(root)
    except OSError:
        return 0
    removed = 0
    for entry in entries:
        if not valid_job_id(entry):
            continue
        d = os.path.join(root, entry)
        marker = os.path.join(d, OWNER_FILE)
        try:
            age = now - os.path.getmtime(marker if os.path.exists(marker) else d)
        except OSError:
            continue
        if age > retain_s:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed


def prune_if_due() -> int:
    """prune(), at most once an hour. Never raises — housekeeping must not
    fail a request."""
    now = time.time()
    with _prune_lock:
        if now - _last_prune[0] < PRUNE_EVERY_S:
            return 0
        _last_prune[0] = now
    try:
        removed = prune()
        if removed:
            print(f"[captures] pruned {removed} job folder(s) older than {RETAIN_DAYS:g}d")
        return removed
    except Exception as e:  # noqa: BLE001
        print(f"[captures] prune failed: {type(e).__name__}: {e}")
        return 0

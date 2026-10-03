"""
SmartPortal as a second client of the order service.

Two changes, pinned here without a browser, a bucket or the network:

  1. One token per client. BizzFlow keeps ORDER_ENTRY_API_TOKEN and behaves
     exactly as before; SmartPortal has SMARTPORTAL_API_TOKEN. Every job records
     its client, and the other client gets a 404 for it — read, cancel, watch,
     log, captures. Dealer sessions and per-agent slots are keyed by
     (client, user id). Only BizzFlow's jobs fire the webhook.
  2. Files. A SmartPortal job's documents arrive as pre-signed links (never
     bucket keys), fetched under a host allowlist with no redirects, a size cap
     and a type allowlist; its captures stay on the droplet and are served to
     SmartPortal only.

Run from the scraper/ dir:  pytest tests/test_smartportal_client.py
"""

import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("ORDER_ENTRY_API_TOKEN", "test-token")

import api_server  # noqa: E402
import capture_store  # noqa: E402
import clients  # noqa: E402
import doc_urls  # noqa: E402
import live_view  # noqa: E402
from oe_feasibility import capture_erf_pdf, capture_screen  # noqa: E402
from order_to_payload import order_to_payload  # noqa: E402

BF_TOKEN = os.environ["ORDER_ENTRY_API_TOKEN"]
SP_TOKEN = "sp-test-token"
BF = {"X-Internal-Token": BF_TOKEN}
SP = {"X-Internal-Token": SP_TOKEN}
HOST = "acct123.r2.cloudflarestorage.com"
LINK = f"https://{HOST}/bucket/ic-front.jpg?X-Amz-Signature=SECRETSIG&X-Amz-Credential=KEY"


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("SMARTPORTAL_API_TOKEN", SP_TOKEN)
    monkeypatch.setenv("SMARTPORTAL_DOCUMENT_HOSTS", HOST)
    monkeypatch.setattr(capture_store, "CAPTURES_DIR", str(tmp_path / "captures"))
    with api_server.JOBS_LOCK:
        api_server.JOBS.clear()
    api_server.JOB_TASKS.clear()
    api_server._PENDING_OWNER.clear()
    api_server.MAX_CONCURRENT_JOBS = 4
    api_server.MAX_BROWSERS = 8
    yield
    with api_server.JOBS_LOCK:
        api_server.JOBS.clear()
    api_server.MAX_CONCURRENT_JOBS = 1
    api_server.MAX_BROWSERS = 5


def _client():
    api_server.app.config["TESTING"] = True
    return api_server.app.test_client()


def _order(documents=None, oid="ord1"):
    return {"id": oid, "attempt": 1, "fullName": "T", "idType": "MyKad",
            "idNumber": "901106146170", "documents": documents or []}


def _start(headers, monkeypatch, body=None, user_key="u1"):
    """POST /orders with the runner stubbed; returns (response, runner args)."""
    seen = {}

    def fake_run(*args, **kwargs):
        seen["args"], seen["kwargs"] = args, kwargs

    monkeypatch.setattr(api_server, "_run_order_job", fake_run)
    payload = body if body is not None else {"order": _order(), "dry_run": False,
                                              "full_order": True}
    if user_key is not None:
        payload = {**payload, "user_key": user_key}
    rv = _client().post("/orders", json=payload, headers=headers)
    time.sleep(0.05)  # the runner is started on a thread
    return rv, seen


# ── tokens ──────────────────────────────────────────────────────────────────

def test_each_token_names_its_client(monkeypatch):
    assert clients.client_for_token(BF_TOKEN) == clients.BIZZFLOW
    assert clients.client_for_token(SP_TOKEN) == clients.SMARTPORTAL
    assert clients.client_for_token("nope") is None


def test_an_unset_or_empty_token_never_matches(monkeypatch):
    monkeypatch.setenv("SMARTPORTAL_API_TOKEN", "")
    assert clients.client_for_token("") is None
    assert clients.client_for_token(None) is None
    monkeypatch.delenv("SMARTPORTAL_API_TOKEN")
    assert clients.client_for_token("") is None
    # BizzFlow is unaffected by SmartPortal's token being absent.
    assert clients.client_for_token(BF_TOKEN) == clients.BIZZFLOW


def test_a_shared_token_stops_the_service_starting(monkeypatch):
    # The same token for both apps cannot be told apart: SmartPortal's calls
    # would silently run as BizzFlow's. Whitespace does not hide it.
    monkeypatch.setenv("SMARTPORTAL_API_TOKEN", f"  {BF_TOKEN}\n")
    with pytest.raises(clients.TokenConfigError) as e:
        clients.check_tokens()
    assert "SMARTPORTAL_API_TOKEN" in str(e.value)
    assert "ORDER_ENTRY_API_TOKEN" in str(e.value)
    assert BF_TOKEN not in str(e.value)          # the secret is never printed
    # And on its own the lookup authenticates neither client with it.
    assert clients.client_for_token(BF_TOKEN) is None


@pytest.mark.parametrize("sp_token", [SP_TOKEN, "", None])
def test_distinct_or_unset_tokens_start(monkeypatch, sp_token):
    if sp_token is None:
        monkeypatch.delenv("SMARTPORTAL_API_TOKEN")
    else:
        monkeypatch.setenv("SMARTPORTAL_API_TOKEN", sp_token)
    clients.check_tokens()
    assert clients.client_for_token(BF_TOKEN) == clients.BIZZFLOW


def test_the_server_really_refuses_to_import_with_a_shared_token(tmp_path):
    import subprocess

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {**os.environ, "ORDER_ENTRY_API_TOKEN": "same-secret",
           "SMARTPORTAL_API_TOKEN": "same-secret"}
    run = subprocess.run([sys.executable, "-c", "import api_server"], cwd=here,
                         env=env, capture_output=True, text=True, timeout=120)
    assert run.returncode != 0
    assert "TokenConfigError" in run.stderr
    assert "same-secret" not in run.stderr + run.stdout
    # Control: the same import with distinct tokens succeeds.
    env["SMARTPORTAL_API_TOKEN"] = "other-secret"
    ok = subprocess.run([sys.executable, "-c", "import api_server"], cwd=here,
                        env=env, capture_output=True, text=True, timeout=120)
    assert ok.returncode == 0, ok.stderr


def test_a_job_with_no_client_recorded_belongs_to_bizzflow():
    legacy = {"status": "running", "params": {"kind": "order_entry", "user_key": "u"}}
    assert clients.owns(legacy, clients.BIZZFLOW)
    assert not clients.owns(legacy, clients.SMARTPORTAL)


# ── BizzFlow unchanged ──────────────────────────────────────────────────────

def test_bizzflow_submit_is_unchanged(monkeypatch):
    rv, seen = _start(BF, monkeypatch, user_key="cuid1")
    assert rv.status_code == 202
    job = api_server.JOBS[rv.get_json()["job_id"]]
    assert job["params"]["client"] == "bizzflow"
    assert job["params"]["user_key"] == "cuid1"          # not rewritten
    args = seen["args"]
    payload, user_key, notify = args[1], args[3], args[8]
    assert user_key == "cuid1"
    assert notify == "ord1"                                # webhook still fires
    assert payload["order_ref"]["user_id"] == "cuid1"     # R2 prefix as before
    assert "_artifacts" not in payload                     # captures still to R2


def test_bizzflow_cannot_smuggle_a_local_capture_folder(monkeypatch):
    body = {"payload": {"customer": {}, "order_ref": {"order_id": "o", "attempt": 1},
                        "_artifacts": {"store": "local", "dir": "/etc"}},
            "dry_run": True}
    rv, seen = _start(BF, monkeypatch, body=body)
    assert rv.status_code == 202
    assert "_artifacts" not in seen["args"][1]


def test_bizzflow_may_not_use_the_smartportal_key_prefix(monkeypatch):
    rv, _ = _start(BF, monkeypatch, user_key="smartportal-u1")
    assert rv.status_code == 400
    assert rv.get_json()["error"] == "INVALID_USER_KEY"


def test_bizzflow_may_not_send_document_links(monkeypatch):
    body = {"order": _order([{"type": "mykad", "url": LINK, "file_name": "a.jpg"}]),
            "dry_run": False}
    rv, _ = _start(BF, monkeypatch, body=body)
    assert rv.status_code == 400
    assert rv.get_json()["error"] == "DOCUMENT_URL_NOT_ALLOWED"


# ── SmartPortal jobs ────────────────────────────────────────────────────────

def test_smartportal_starts_and_reads_its_own_job(monkeypatch):
    rv, seen = _start(SP, monkeypatch)
    assert rv.status_code == 202
    job_id = rv.get_json()["job_id"]
    job = api_server.JOBS[job_id]
    assert job["params"]["client"] == "smartportal"
    assert job["params"]["user_key"] == "smartportal-u1"
    args = seen["args"]
    payload, user_key, notify = args[1], args[3], args[8]
    assert user_key == "smartportal-u1"   # its own dealer session file
    assert notify is None                 # no BizzFlow webhook
    # No code path can build an R2 key for this run…
    assert payload["order_ref"]["user_id"] is None
    # …and its captures go to a folder this job owns.
    assert payload["_artifacts"]["store"] == "local"
    assert capture_store.owner(job_id) == "smartportal"

    got = _client().get(f"/jobs/{job_id}", headers=SP)
    assert got.status_code == 200
    assert got.get_json()["job_id"] == job_id


def test_smartportal_must_name_a_user(monkeypatch):
    rv, _ = _start(SP, monkeypatch, user_key=None)
    assert rv.status_code == 400
    assert rv.get_json()["error"] == "INVALID_USER_KEY"
    rv, _ = _start(SP, monkeypatch, user_key="a/b")
    assert rv.status_code == 400


def test_neither_client_can_read_cancel_log_or_list_the_others_jobs(monkeypatch):
    sp_job = _start(SP, monkeypatch)[0].get_json()["job_id"]
    bf_job = _start(BF, monkeypatch, user_key="cuid1")[0].get_json()["job_id"]
    c = _client()
    for mine, theirs, hdr in ((sp_job, bf_job, SP), (bf_job, sp_job, BF)):
        assert c.get(f"/jobs/{theirs}", headers=hdr).status_code == 404
        assert c.post(f"/jobs/{theirs}/cancel", headers=hdr).status_code == 404
        assert c.post(f"/jobs/{theirs}/cancel?force=1", headers=hdr).status_code == 404
        assert c.get(f"/jobs/{theirs}/log", headers=hdr).status_code == 404
        # The 404 is the same body an unknown id gets — nothing to probe.
        assert (c.get(f"/jobs/{theirs}", headers=hdr).get_json()
                == c.get("/jobs/does-not-exist", headers=hdr).get_json())
        listed = {r["job_id"] for r in c.get("/jobs", headers=hdr).get_json()["jobs"]}
        assert mine in listed and theirs not in listed
    # The other app's job still holds a real slot, so the machine numbers count it.
    assert c.get("/jobs", headers=BF).get_json()["slots_in_use"] == 2
    # The force-404 really did leave the other client's job alone.
    assert api_server.JOBS[sp_job]["status"] == "queued"


def test_no_token_is_401_before_the_id_is_looked_up(monkeypatch):
    sp_job = _start(SP, monkeypatch)[0].get_json()["job_id"]
    c = _client()
    assert c.get(f"/jobs/{sp_job}").status_code == 401
    assert c.get("/jobs/does-not-exist").status_code == 401


def test_the_same_user_id_in_two_apps_is_two_agents(monkeypatch):
    assert _start(BF, monkeypatch, user_key="u1")[0].status_code == 202
    # Same id, other app: not "your own run is in progress".
    assert _start(SP, monkeypatch, user_key="u1")[0].status_code == 202
    # Same id, same app: refused as before.
    rv = _start(SP, monkeypatch, user_key="u1")[0]
    assert rv.status_code == 409
    assert rv.get_json()["error"] == "USER_JOB_IN_PROGRESS"


def test_only_bizzflow_batches_fire_the_webhook(monkeypatch):
    import batch_runner

    sent = []
    monkeypatch.setattr(api_server, "_notify_bizzflow", lambda body: sent.append(body))
    monkeypatch.setattr(batch_runner, "run_batch", lambda jobs, run_one, on_progress=None: [])
    for client in ("smartportal", "bizzflow"):
        with api_server.JOBS_LOCK:
            api_server.JOBS["b-" + client] = {"status": "queued", "params": {"client": client}}
        api_server._run_batch_job("b-" + client, "batch-" + client, [], True, "u", True, False,
                                  client=client)
    assert [b["batchId"] for b in sent] == ["batch-bizzflow"]


def test_a_smartportal_batch_is_its_own(monkeypatch):
    monkeypatch.setattr(api_server, "_run_batch_job", lambda *a, **k: None)
    c = _client()
    body = {"batch_id": "B1", "user_key": "u9", "dry_run": True,
            "jobs": [{"jobId": "j-sp-1", "order": _order()}]}
    rv = c.post("/orders/batch", json=body, headers=SP)
    assert rv.status_code == 202
    batch_job = rv.get_json()["batch_job_id"]
    assert api_server.JOBS["j-sp-1"]["params"]["client"] == "smartportal"
    assert api_server.JOBS["j-sp-1"]["params"]["user_key"] == "smartportal-u9"
    assert c.get(f"/orders/batch/{batch_job}", headers=SP).status_code == 200
    assert c.get(f"/orders/batch/{batch_job}", headers=BF).status_code == 404
    assert c.get("/jobs/j-sp-1", headers=BF).status_code == 404


def test_a_smartportal_batch_member_id_must_be_folder_safe(monkeypatch):
    monkeypatch.setattr(api_server, "_run_batch_job", lambda *a, **k: None)
    body = {"batch_id": "B1", "user_key": "u9",
            "jobs": [{"jobId": "../../etc", "order": _order()}]}
    rv = _client().post("/orders/batch", json=body, headers=SP)
    assert rv.status_code == 400


# ── live view ───────────────────────────────────────────────────────────────

def test_live_view_answers_only_to_the_jobs_own_client(monkeypatch):
    monkeypatch.setenv("SMARTPORTAL_LIVE_VIEW_ORIGIN", "https://smartportal.example")
    with api_server.JOBS_LOCK:
        api_server.JOBS["sp1"] = {"status": "running", "live_view": True,
                                  "params": {"kind": "order_entry", "client": "smartportal"}}
    exp = int(time.time()) + 600
    c = _client()
    sp_tok = live_view.mint_viewer_token("sp1", SP_TOKEN, exp)
    bf_tok = live_view.mint_viewer_token("sp1", BF_TOKEN, exp)
    ok = c.get(f"/jobs/sp1/live?token={sp_tok}&probe=1")
    assert ok.status_code == 200
    assert ok.headers["Access-Control-Allow-Origin"] == "https://smartportal.example"
    assert c.get(f"/jobs/sp1/live?token={bf_tok}&probe=1").status_code == 404
    assert c.get("/jobs/sp1/live?token=junk&probe=1").status_code == 401


# ── dealer sessions ─────────────────────────────────────────────────────────

def test_dealer_login_is_keyed_by_client_and_user(monkeypatch):
    import dealer_login_service

    calls = []

    def fake_request_otp(staff, pw, channel, user_key, email):
        calls.append(user_key)
        return {"pending_id": f"p-{len(calls)}", "expires_in": 300}

    monkeypatch.setattr(dealer_login_service, "request_otp", fake_request_otp)
    c = _client()
    body = {"staff_code": "S", "password": "x", "user_key": "u1"}
    assert c.post("/dealer/login/request-otp", json=body, headers=SP).status_code == 200
    assert c.post("/dealer/login/request-otp", json=body, headers=BF).status_code == 200
    assert calls == ["smartportal-u1", "u1"]
    assert (dealer_login_service._safe_key("smartportal-u1")
            != dealer_login_service._safe_key("u1"))

    # BizzFlow cannot finish, poll or cancel SmartPortal's pending login.
    seen = []
    monkeypatch.setattr(dealer_login_service, "submit_otp",
                        lambda *a: seen.append(a) or {"ok": True})
    rv = c.post("/dealer/login/submit-otp", json={"pending_id": "p-1", "otp": "1"}, headers=BF)
    assert rv.status_code == 404 and not seen
    rv = c.post("/dealer/login/submit-otp",
                json={"pending_id": "p-1", "otp": "1", "user_key": "u1"}, headers=SP)
    assert rv.status_code == 200 and seen == [("p-1", "1", "smartportal-u1")]
    rv = c.post("/dealer/login/auto-status", json={"pending_id": "p-1"}, headers=BF)
    assert rv.get_json()["status"] == "not_found"


def test_dealer_status_and_logout_use_the_scoped_key(monkeypatch):
    import dealer_login_service

    seen = []
    monkeypatch.setattr(dealer_login_service, "check_status",
                        lambda k: seen.append(("status", k)) or {"connected": False})
    monkeypatch.setattr(dealer_login_service, "logout",
                        lambda k: seen.append(("logout", k)) or {"ok": True})
    c = _client()
    c.post("/dealer/login/status", json={"user_key": "u1"}, headers=SP)
    c.post("/dealer/login/logout", json={"user_key": "u1"}, headers=SP)
    c.post("/dealer/login/status", json={"user_key": "u1"}, headers=BF)
    assert seen == [("status", "smartportal-u1"), ("logout", "smartportal-u1"),
                    ("status", "u1")]


# ── documents in ────────────────────────────────────────────────────────────

def test_order_to_payload_carries_links_separately_from_keys():
    p = order_to_payload(_order([
        {"type": "mykad", "url": LINK, "file_name": "ic.jpg"},
        {"type": "im_conversation", "url": LINK, "file_name": "chat.png"},
        {"type": "other", "url": LINK, "file_name": "bill.pdf"},
        {"type": "mykad", "key": "orders/u/x.jpg"},
    ]))["customer"]
    assert p["id_doc_keys"] == ["orders/u/x.jpg"]
    assert p["id_doc_urls"] == [{"url": LINK, "file_name": "ic.jpg"}]
    assert p["im_doc_urls"][0]["file_name"] == "chat.png"
    assert p["other_doc_urls"][0]["file_name"] == "bill.pdf"


def test_smartportal_documents_must_be_links_not_keys(monkeypatch):
    body = {"order": _order([{"type": "mykad", "key": "orders/cuid/ic.jpg"}]),
            "dry_run": False}
    rv, seen = _start(SP, monkeypatch, body=body)
    assert rv.status_code == 400
    assert rv.get_json()["error"] == "DOCUMENT_KEY_NOT_ALLOWED"
    assert not seen and not api_server.JOBS


def test_smartportal_may_not_point_at_a_local_file(monkeypatch):
    body = {"payload": {"customer": {"id_doc_path": "/app/config/secret.key"}}}
    rv, _ = _start(SP, monkeypatch, body=body)
    assert rv.status_code == 400
    assert rv.get_json()["error"] == "DOCUMENT_PATH_NOT_ALLOWED"


@pytest.mark.parametrize("bad", [
    "http://" + HOST + "/b/k.jpg",
    "https://169.254.169.254/latest/meta-data?x=1",
    "https://localhost/b/k.jpg",
    f"https://{HOST}:8443/b/k.jpg",
    f"https://user:pw@{HOST}/b/k.jpg",
    f"https://{HOST}.evil.example/b/k.jpg",
    "file:///etc/passwd",
    "",
])
def test_a_link_off_the_allowlist_is_refused_before_a_job_exists(monkeypatch, bad):
    body = {"order": _order([{"type": "mykad", "url": bad, "file_name": "a.jpg"}]),
            "dry_run": False}
    rv, seen = _start(SP, monkeypatch, body=body)
    assert rv.status_code == 400, bad
    assert rv.get_json()["error"] in ("INVALID_DOCUMENT_URL",)
    assert not api_server.JOBS


def test_a_refusal_never_echoes_the_link(monkeypatch):
    monkeypatch.setenv("SMARTPORTAL_DOCUMENT_HOSTS", "other.example")
    body = {"order": _order([{"type": "mykad", "url": LINK, "file_name": "a.jpg"}]),
            "dry_run": False}
    rv, _ = _start(SP, monkeypatch, body=body)
    assert rv.status_code == 400
    assert "SECRETSIG" not in rv.get_data(as_text=True)


def test_no_allowlist_means_no_links(monkeypatch):
    monkeypatch.delenv("SMARTPORTAL_DOCUMENT_HOSTS")
    with pytest.raises(doc_urls.DocUrlError):
        doc_urls.check_url(LINK)


def test_a_good_link_is_accepted(monkeypatch):
    body = {"order": _order([{"type": "mykad", "url": LINK, "file_name": "ic-front.jpg"}]),
            "dry_run": False, "full_order": True}
    rv, seen = _start(SP, monkeypatch, body=body)
    assert rv.status_code == 202
    assert seen["args"][1]["customer"]["id_doc_urls"][0]["url"] == LINK


class _Resp:
    def __init__(self, status=200, ctype="image/jpeg", body=b"\xff\xd8data",
                 length=None, chunks=None):
        self.status_code = status
        self.headers = {"Content-Type": ctype}
        if length is not None:
            self.headers["Content-Length"] = str(length)
        self._chunks = chunks if chunks is not None else [body]
        self.closed = False

    def iter_content(self, n):
        yield from self._chunks

    def close(self):
        self.closed = True


def _fetch(monkeypatch, tmp_path, resp, file_name="ic-front.jpg"):
    monkeypatch.setattr(doc_urls, "_get", lambda url: resp)
    return doc_urls.download_doc({"url": LINK, "file_name": file_name}, str(tmp_path))


def test_download_writes_the_file_under_its_own_name(monkeypatch, tmp_path):
    path = _fetch(monkeypatch, tmp_path, _Resp())
    assert os.path.basename(path) == "ic-front.jpg"
    assert open(path, "rb").read() == b"\xff\xd8data"


@pytest.mark.parametrize("resp,why", [
    (_Resp(status=302), "redirect"),
    (_Resp(status=403), "403"),
    (_Resp(ctype="text/html"), "text/html"),
    (_Resp(ctype=""), "missing"),
    (_Resp(length=11 * 1024 * 1024), "MB"),
    (_Resp(chunks=[b"x" * (6 * 1024 * 1024), b"x" * (6 * 1024 * 1024)]), "MB"),
])
def test_download_refusals(monkeypatch, tmp_path, resp, why):
    with pytest.raises(doc_urls.DocUrlError) as e:
        _fetch(monkeypatch, tmp_path, resp)
    assert why in str(e.value)
    assert "SECRETSIG" not in str(e.value) and "X-Amz" not in str(e.value)
    assert resp.closed


def test_download_is_never_redirected(monkeypatch):
    seen = {}

    class _Requests:
        @staticmethod
        def get(url, **kw):
            seen.update(kw)
            return _Resp()

    monkeypatch.setitem(sys.modules, "requests", _Requests)
    doc_urls._get(LINK)
    assert seen["allow_redirects"] is False
    assert seen["timeout"][1] == 30


def test_a_slow_download_is_cut_at_30s(monkeypatch, tmp_path):
    clock = iter([0, 0, 31, 31])
    monkeypatch.setattr(doc_urls, "_get", lambda url: _Resp(chunks=[b"a", b"b"]))
    with pytest.raises(doc_urls.DocUrlError) as e:
        doc_urls.download_doc({"url": LINK, "file_name": "a.jpg"}, str(tmp_path),
                              now=lambda: next(clock))
    assert "30s" in str(e.value)


def test_a_failed_request_is_logged_without_the_link(monkeypatch, tmp_path, capsys):
    def boom(url):
        raise ConnectionError(f"failed to reach {url}")

    monkeypatch.setattr(doc_urls, "_get", boom)
    paths = doc_urls.download_many([{"url": LINK, "file_name": "a.jpg"}], str(tmp_path))
    assert paths == []
    out = capsys.readouterr().out
    assert f"https://{HOST}/bucket/ic-front.jpg" in out
    assert "SECRETSIG" not in out and "X-Amz" not in out


def test_file_names_are_made_safe_and_match_the_bytes():
    assert doc_urls.safe_file_name("../../etc/passwd", "image/png") == "passwd.png"
    assert doc_urls.safe_file_name("ic front.JPEG", "image/jpeg") == "ic front.JPEG"
    # The bytes decide the extension: a PDF named .png is renamed, not trusted.
    assert doc_urls.safe_file_name("scan.png", "application/pdf") == "scan.pdf"
    assert doc_urls.safe_file_name("", "image/webp") == "document.webp"
    assert doc_urls.safe_file_name(".hidden", "image/jpeg") == "hidden.jpg"


# ── captures out ────────────────────────────────────────────────────────────

class _Page:
    async def screenshot(self, **kwargs):
        return b"\xff\xd8jpeg"


def test_a_smartportal_capture_stays_on_the_droplet(monkeypatch):
    import r2_upload

    def no_r2(*a, **k):
        raise AssertionError("a SmartPortal capture must never reach R2")

    monkeypatch.setattr(r2_upload, "upload_bytes", no_r2)
    d = capture_store.create("job1", "smartportal")
    payload = {"order_ref": {"order_id": "o1", "attempt": 2, "user_id": None},
               "_artifacts": {"store": "local", "dir": d}}
    detail = asyncio.run(capture_screen(_Page(), payload, "broadband"))
    assert detail == {"value": "submit-2-broadband.jpg", "outcome": "ok"}
    assert open(os.path.join(d, "submit-2-broadband.jpg"), "rb").read() == b"\xff\xd8jpeg"


def test_a_smartportal_erf_stays_on_the_droplet(monkeypatch):
    import r2_upload

    monkeypatch.setattr(r2_upload, "upload_bytes",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("R2")))
    d = capture_store.create("job2", "smartportal")
    pdf = os.path.join(d, "..", "portal.pdf")
    with open(pdf, "wb") as f:
        f.write(b"%PDF-1.4")

    class _Dl:
        suggested_filename = "eRF.pdf"

        async def path(self):
            return pdf

    class _Expect:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        @property
        def value(self):
            async def v():
                return _Dl()
            return v()

    class _Loc:
        first = None

        async def click(self, **k):
            return None

    _Loc.first = _Loc()

    class _Frame:
        def locator(self, sel):
            return _Loc()

    class _ErfPage:
        def once(self, *a):
            pass

        def expect_download(self, **k):
            return _Expect()

    import oe_feasibility
    monkeypatch.setattr(oe_feasibility, "_frame", lambda page: _Frame())
    stages = []
    payload = {"order_ref": {"order_id": "o1", "attempt": 1, "user_id": None},
               "_artifacts": {"store": "local", "dir": d}}
    detail = asyncio.run(capture_erf_pdf(_ErfPage(), payload, "2608000123", lambda *a: stages.append(a)))
    assert detail["value"] == "2608000123_erf.pdf"
    assert os.path.exists(os.path.join(d, "2608000123_erf.pdf"))


def test_captures_are_served_to_their_own_client_only():
    d = capture_store.create("jobsp", "smartportal")
    capture_store.save(d, "submit-1-page1.jpg", b"\xff\xd8img")
    capture_store.save(d, "26080001_erf.pdf", b"%PDF")
    c = _client()

    listing = c.get("/jobs/jobsp/captures", headers=SP)
    assert listing.status_code == 200
    names = {x["name"]: x for x in listing.get_json()["captures"]}
    assert set(names) == {"submit-1-page1.jpg", "26080001_erf.pdf"}
    assert names["26080001_erf.pdf"]["content_type"] == "application/pdf"

    img = c.get("/jobs/jobsp/captures/submit-1-page1.jpg", headers=SP)
    assert img.status_code == 200
    assert img.data == b"\xff\xd8img"
    assert img.headers["Content-Type"] == "image/jpeg"
    assert img.headers["X-Content-Type-Options"] == "nosniff"

    # The other client, no client, and an unknown job.
    assert c.get("/jobs/jobsp/captures", headers=BF).status_code == 404
    assert c.get("/jobs/jobsp/captures/submit-1-page1.jpg", headers=BF).status_code == 404
    assert c.get("/jobs/jobsp/captures/submit-1-page1.jpg").status_code == 401
    assert c.get("/jobs/nope/captures", headers=SP).status_code == 404
    # The owner marker and anything outside the folder are not captures.
    assert c.get("/jobs/jobsp/captures/.owner", headers=SP).status_code == 404
    assert c.get("/jobs/jobsp/captures/..%2F..%2Fsecret.jpg", headers=SP).status_code == 404


def test_capture_names_and_folders_cannot_escape():
    assert not capture_store.valid_job_id("../x")
    assert not capture_store.valid_job_id("a/b")
    assert not capture_store.valid_name("../a.jpg")
    assert not capture_store.valid_name(".owner")
    assert not capture_store.valid_name("a.html")
    d = capture_store.create("j", "smartportal")
    with pytest.raises(ValueError):
        capture_store.save(d, "../../x.jpg", b"")
    # Only a folder the API server made for a job may be written.
    with pytest.raises(ValueError):
        capture_store.save(os.path.dirname(d), "x.jpg", b"")


def test_capture_folders_go_after_seven_days(tmp_path):
    root = str(tmp_path / "c")
    old = capture_store.create("old", "smartportal", root)
    new = capture_store.create("new", "smartportal", root)
    week_ago = time.time() - 7 * 86400 - 60
    os.utime(os.path.join(old, ".owner"), (week_ago, week_ago))
    assert capture_store.prune(root, retain_days=7) == 1
    assert not os.path.exists(old) and os.path.exists(new)

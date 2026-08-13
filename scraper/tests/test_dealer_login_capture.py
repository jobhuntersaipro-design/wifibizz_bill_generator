"""
test_dealer_login_capture.py - Tests for the dealer-login API capture helpers.

Pure-logic only (no browser, no credentials): URL matching, redaction, and the
_AuthCapture read/drain path driven by a fake Playwright response.

Run from the scraper/ dir:
    pytest tests/test_dealer_login_capture.py
"""

import asyncio

import dealer_web_login as dwl


# ---------------------------------------------------------------- URL matching

def test_matches_auth_endpoints():
    for url in (
        "https://portal.example/api/login",
        "https://portal.example/api/otp/send",
        "https://portal.example/user/signIn?x=1",
        "https://portal.example/api/sms/code",
        "https://portal.example/auth/verify",
    ):
        assert dwl._looks_like_auth_api(url), url


def test_ignores_static_assets():
    # Bundle filenames routinely contain "login" — capturing them would bury
    # the one response we actually care about.
    for url in (
        "https://portal.example/static/js/login.chunk.js",
        "https://portal.example/css/login.css",
        "https://portal.example/img/login-bg.png",
        "https://portal.example/fonts/auth.woff2",
        "https://portal.example/static/js/login.js?v=2",
    ):
        assert not dwl._looks_like_auth_api(url), url


def test_ignores_unrelated_endpoints():
    assert not dwl._looks_like_auth_api("https://portal.example/api/orders/list")


# -------------------------------------------------------------------- redaction

def test_redacts_credentials_but_keeps_the_status_code():
    body = {
        "code": "E0007",
        "message": "Invalid staff code or password",
        "data": {"password": "hunter2", "smsCode": "123456", "access_token": "abc"},
    }
    out = dwl._redact(body)
    # The signal this whole feature depends on must survive redaction.
    assert out["code"] == "E0007"
    assert out["message"] == "Invalid staff code or password"
    assert out["data"]["password"] == "***"
    assert out["data"]["smsCode"] == "***"
    assert out["data"]["access_token"] == "***"


def test_redacts_inside_lists():
    out = dwl._redact({"items": [{"pwd": "secret", "id": 1}]})
    assert out["items"][0] == {"pwd": "***", "id": 1}


# ----------------------------------------------------------------- _AuthCapture

class _FakeResponse:
    def __init__(self, url, status, json_body=None, text_body=None, raises=False):
        self.url = url
        self.status = status
        self.headers = {"content-type": "application/json" if json_body is not None
                        else "text/html"}
        self._json = json_body
        self._text = text_body
        self._raises = raises

    async def json(self):
        if self._raises:
            raise RuntimeError("body unavailable")
        return self._json

    async def text(self):
        if self._raises:
            raise RuntimeError("body unavailable")
        return self._text


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def test_captures_json_response_redacted():
    async def go():
        cap = dwl._AuthCapture()
        cap.on_response(_FakeResponse(
            "https://portal.example/api/login", 200,
            json_body={"code": "E0007", "message": "Invalid password",
                       "password": "hunter2"},
        ))
        await cap.drain()
        return cap.records

    records = _run(go())
    assert len(records) == 1
    assert records[0]["status"] == 200
    assert records[0]["body"]["code"] == "E0007"
    assert records[0]["body"]["password"] == "***"


def test_skips_non_auth_urls():
    async def go():
        cap = dwl._AuthCapture()
        cap.on_response(_FakeResponse("https://portal.example/api/orders", 200,
                                      json_body={"ok": True}))
        await cap.drain()
        return cap.records

    assert _run(go()) == []


def test_unreadable_body_still_records_url_and_status():
    # Bodies get discarded when the page navigates — which is exactly what the
    # portal does right after Sign In. Endpoint + status is still diagnostic.
    async def go():
        cap = dwl._AuthCapture()
        cap.on_response(_FakeResponse("https://portal.example/api/login", 401,
                                      json_body={}, raises=True))
        await cap.drain()
        return cap.records

    records = _run(go())
    assert len(records) == 1
    assert records[0]["status"] == 401
    assert "unreadable" in records[0]["body"]


# ------------------------------------------------------- failure classification

# The exact payload captured live from the portal (rate-limited OTP request).
_LIVE_RATE_LIMIT = {
    "url": "https://dealer.unifi.com.my/portal/api/prod/genCaptcha",
    "status": 417,
    "body": {"code": "46410045", "type": 0, "stack": "",
             "message": "Access to otp code is too frequent, please try again later."},
}


def test_detects_the_live_rate_limit_failure():
    failure = dwl._first_api_failure([_LIVE_RATE_LIMIT])
    assert failure["status"] == 417
    assert "too frequent" in failure["message"]


def test_ignores_successful_responses():
    ok = [{"url": "https://x/api/prod/genCaptcha", "status": 200,
           "body": {"code": "0", "data": {"sent": True}}}]
    assert dwl._first_api_failure(ok) == {}


def test_ignores_success_without_an_exception_envelope():
    # A 2xx carrying a message but no `stack` is not treated as a failure —
    # guessing there is what would break working logins.
    ok = [{"url": "https://x/api/prod/genCaptcha", "status": 200,
           "body": {"code": "0", "message": "OTP sent"}}]
    assert dwl._first_api_failure(ok) == {}


def test_detects_exception_envelope_on_a_2xx():
    recs = [{"url": "https://x/api/prod/genCaptcha", "status": 200,
             "body": {"code": "46410099", "message": "Invalid password", "stack": ""}}]
    assert dwl._first_api_failure(recs)["message"] == "Invalid password"


def test_non_2xx_without_a_readable_body_still_fails():
    recs = [{"url": "https://x/api/prod/genCaptcha", "status": 500,
             "body": "<unreadable: RuntimeError>"}]
    assert dwl._first_api_failure(recs)["message"] == "HTTP 500"


def test_message_points_at_the_password():
    out = dwl._describe_otp_request_failure("Invalid staff code or password.")
    assert "Invalid staff code or password." in out
    assert "staff code and password" in out


def test_message_explains_rate_limiting():
    out = dwl._describe_otp_request_failure(_LIVE_RATE_LIMIT["body"]["message"])
    assert "too frequent" in out
    assert "wait a few minutes" in out.lower()


def test_unknown_message_is_passed_through_verbatim():
    assert dwl._describe_otp_request_failure("Service unavailable.") == "Service unavailable."


# ------------------------------------------------- credentials vs OTP routing

def test_credential_wording_is_recognised():
    for msg in (
        "Invalid staff code or password.",
        "Wrong username or password",
        "Your credentials are incorrect",
        "账号或密码错误",
    ):
        assert dwl._is_credentials_message(msg), msg


def test_otp_wording_is_not_treated_as_credentials():
    for msg in (
        "Invalid OTP.",
        "The verification code has expired.",
        "SMS code is incorrect",
        "Access to otp code is too frequent, please try again later.",
    ):
        assert not dwl._is_credentials_message(msg), msg


def test_otp_wins_when_a_message_names_both():
    # Misrouting a wrong-OTP user back to the credentials form wipes the
    # password they typed correctly — the worse of the two mistakes.
    assert not dwl._is_credentials_message(
        "Invalid OTP for this account, check your password and retry"
    )


def test_unknown_wording_is_not_credentials():
    assert not dwl._is_credentials_message("Service temporarily unavailable.")
    assert not dwl._is_credentials_message("")


def test_credentials_error_is_a_runtime_error():
    # dealer_login_service catches broad Exception; the subclass only has to be
    # distinguishable, never to escape that handler.
    assert issubclass(dwl.CredentialsError, RuntimeError)


def test_html_response_is_truncated_text():
    async def go():
        cap = dwl._AuthCapture()
        cap.on_response(_FakeResponse("https://portal.example/login", 200,
                                      text_body="x " * 500))
        await cap.drain()
        return cap.records

    records = _run(go())
    assert len(records[0]["body"]) <= 400

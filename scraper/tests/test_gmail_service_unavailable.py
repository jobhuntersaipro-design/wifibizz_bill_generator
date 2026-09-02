"""A Gmail credential the reader cannot use must RAISE, never return None.

The case being modelled is real (2026-09-02): the droplet's saved token had
been revoked by Google ("invalid_grant: Token has been expired or revoked")
and config/gmail_credentials.json was not on the box, so
_get_gmail_service() took its missing-credentials branch and returned None.

That None is what hid the failure. get_latest_otp() then called
`self.service.users()` on it every poll, raising AttributeError, which its
generic `except Exception` swallowed — so the dealer login sat through its
whole 300s window and reported a plain timeout while the real reason stayed in
the container log, and the agent watched a countdown with no way out.

No network, no credentials, no real Gmail: the refresh is stubbed to fail the
way Google's did.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gmail_otp_reader  # noqa: E402
from gmail_otp_reader import GmailOTPReader  # noqa: E402

REVOKED = "invalid_grant: Token has been expired or revoked."


class _RevokedCreds:
    """A saved token Google will no longer refresh — the live shape."""

    valid = False
    expired = True
    refresh_token = "1//0g99oDMn-AK"

    def refresh(self, request):
        raise Exception(REVOKED)


def _stub(monkeypatch, *, have_credentials_file, allow_browser=False):
    present = {"config/gmail_token.json": True,
               "config/gmail_credentials.json": have_credentials_file}
    monkeypatch.setattr(gmail_otp_reader.os.path, "exists",
                        lambda p: present.get(p, False))
    monkeypatch.setattr(gmail_otp_reader.Credentials, "from_authorized_user_file",
                        staticmethod(lambda path, scopes: _RevokedCreds()))
    monkeypatch.setattr(gmail_otp_reader, "ALLOW_BROWSER_AUTH", allow_browser)


def test_revoked_token_with_no_credentials_file_raises(monkeypatch):
    """The exact live combination. Before the fix this returned None."""
    _stub(monkeypatch, have_credentials_file=False)

    with pytest.raises(RuntimeError) as e:
        GmailOTPReader()

    msg = str(e.value)
    # The true cause must survive into the message the agent is shown — the
    # missing credentials file is a second problem, not the reason the login
    # failed today.
    assert REVOKED in msg
    assert "gmail_credentials.json" in msg
    assert "restart api_server" in msg


def test_revoked_token_with_browser_disabled_raises(monkeypatch):
    """The pre-existing server path, unchanged: still raises, still says why."""
    _stub(monkeypatch, have_credentials_file=True)

    with pytest.raises(RuntimeError) as e:
        GmailOTPReader()

    assert REVOKED in str(e.value)
    assert "Browser sign-in is disabled" in str(e.value)


@pytest.mark.parametrize("have_credentials_file", [True, False])
def test_no_failure_path_ever_yields_a_none_service(monkeypatch, have_credentials_file):
    """The rule itself, not one instance of it.

    A None service is indistinguishable from a working one until the first
    poll, where it fails inside a swallowing handler.
    """
    _stub(monkeypatch, have_credentials_file=have_credentials_file)

    with pytest.raises(RuntimeError):
        GmailOTPReader()


def test_the_reason_reaches_the_module_level_caller(monkeypatch):
    """dealer_login_service calls the module function, not the class, and its
    error handler is what puts the sentence on screen."""
    _stub(monkeypatch, have_credentials_file=False)

    with pytest.raises(RuntimeError) as e:
        gmail_otp_reader.get_latest_otp(to_filter="nexion.eform@gmail.com")

    assert REVOKED in str(e.value)


def test_a_missing_token_says_so_rather_than_blaming_a_refresh(monkeypatch):
    """No token at all is a different sentence: there is no refresh to blame."""
    monkeypatch.setattr(gmail_otp_reader.os.path, "exists", lambda p: False)
    monkeypatch.setattr(gmail_otp_reader, "ALLOW_BROWSER_AUTH", False)

    with pytest.raises(RuntimeError) as e:
        GmailOTPReader()

    assert "gmail_token.json is missing or invalid" in str(e.value)
    assert "refreshing the saved token failed" not in str(e.value)

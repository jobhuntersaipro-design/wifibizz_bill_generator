"""Silent-portal detection in gmail_otp_reader.

The case being modelled is real (2026-08-19): the dealer portal answered
genCaptcha with 200 and then sent no OTP mail at all, so the login sat waiting
out its whole 300s window with nothing on screen explaining why.

Runs against a fake Gmail service and a fake clock — no network, no portal, no
credentials, no real sleeping. The clock matters: get_latest_otp backdates
start_time by 60s, so a max_wait under 60 would make the loop body never run
and every assertion below would pass vacuously.
"""

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gmail_otp_reader  # noqa: E402
from gmail_otp_reader import GmailOTPReader, OtpNeverSent  # noqa: E402


class _Clock:
    """Virtual time. sleep() advances it, so the poll loop runs at full speed."""

    def __init__(self, start=1_000_000.0):
        self.now = start

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class _FakeGmail:
    """Minimal stand-in for the Gmail client.

    `script` holds one entry per list() call: a list of messages to return, or
    an Exception to raise (an outage). The last entry repeats.
    """

    def __init__(self, script):
        self.script = list(script)
        self.list_calls = 0
        self._by_id = {}

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, userId=None, q=None, maxResults=None):
        step = self.script[min(self.list_calls, len(self.script) - 1)]
        self.list_calls += 1

        def _execute():
            if isinstance(step, Exception):
                raise step
            for m in step:
                self._by_id[m["id"]] = m
            return {"messages": [{"id": m["id"]} for m in step]}

        return types.SimpleNamespace(execute=_execute)

    def get(self, userId=None, id=None, format=None, metadataHeaders=None):
        return types.SimpleNamespace(execute=lambda: self._by_id[id])


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(gmail_otp_reader.time, "time", c.time)
    monkeypatch.setattr(gmail_otp_reader.time, "sleep", c.sleep)
    return c


@pytest.fixture
def reader(monkeypatch, clock):
    monkeypatch.setattr(GmailOTPReader, "_get_gmail_service", lambda self: None)
    monkeypatch.setattr(GmailOTPReader, "_get_message_body",
                        lambda self, message: message.get("_body", ""))
    return GmailOTPReader()


def _msg(clock, msg_id, age_seconds, subject="Your One-Time Verification Code",
         body="Your OTP is 123456"):
    """A message whose arrival is `age_seconds` BEFORE now (negative = future)."""
    return {
        "id": msg_id,
        "internalDate": str(int((clock.now - age_seconds) * 1000)),
        "payload": {"headers": [{"name": "Subject", "value": subject}],
                    "body": {"data": ""}},
        "_body": body,
    }


def _run(reader, script, **kw):
    reader.service = _FakeGmail(script)
    kw.setdefault("max_wait", 300)
    return reader.get_latest_otp(sender_filter="@unifi.com.my", **kw)


def test_raises_when_nothing_ever_arrives(reader):
    """The live failure: no mail at all, so stop early rather than wait 300s."""
    with pytest.raises(OtpNeverSent) as exc:
        _run(reader, [[]], silent_after=5)
    assert "rate-limiting" in str(exc.value)


def test_silence_needs_several_polls_before_it_accuses(reader):
    """One empty result proves nothing — the first poll can simply beat the
    mail. The threshold alone must not be enough to trip it."""
    reader.service = _FakeGmail([[]])
    # Threshold effectively zero, so only the min-poll guard can hold it back.
    with pytest.raises(OtpNeverSent):
        reader.get_latest_otp(sender_filter="@unifi.com.my", max_wait=300,
                              silent_after=0.001)
    assert reader.service.list_calls == gmail_otp_reader.SILENT_MIN_POLLS


def test_a_stale_email_does_not_count_as_arrival(reader, clock):
    """The 35-minute-old code the reader correctly skipped is still silence —
    it predates the request, so it is no evidence the portal answered."""
    with pytest.raises(OtpNeverSent):
        _run(reader, [[_msg(clock, "old", 2082)]], silent_after=5)


def test_fresh_mail_with_a_code_returns_it(reader, clock):
    assert _run(reader, [[_msg(clock, "fresh", -5)]], silent_after=5) == "123456"


def test_fresh_mail_without_a_code_times_out_rather_than_accusing(reader, clock):
    """Mail arrived but held no OTP. The portal is NOT silent, so this must
    fall through to the ordinary None ("type it manually") and never to
    OtpNeverSent — the two carry opposite advice."""
    junk = _msg(clock, "junk", -5, subject="Unifi newsletter", body="no code here")
    assert _run(reader, [[junk]], max_wait=120, silent_after=5) is None


def test_gmail_outage_is_never_blamed_on_the_portal(reader):
    """Every poll raises, so no poll ever succeeds. Telling the user the portal
    is throttling them when our own Gmail access is what failed would send them
    to wait out a limit that does not exist."""
    assert _run(reader, [RuntimeError("gmail 503")], max_wait=120,
                silent_after=5) is None


def test_disabled_by_default_waits_out_the_window(reader):
    """silent_after=None keeps the pre-existing behaviour."""
    assert _run(reader, [[]], max_wait=120, silent_after=None) is None


def test_silent_clock_is_not_the_backdated_start_time(reader, clock):
    """start_time is backdated 60s. Had the silent check measured against it,
    a 90s threshold would fire after only 30s of real waiting. Assert on the
    clock, which is the property itself rather than a proxy for it."""
    began = clock.now
    reader.service = _FakeGmail([[]])
    with pytest.raises(OtpNeverSent):
        reader.get_latest_otp(sender_filter="@unifi.com.my", max_wait=300,
                              silent_after=90)
    assert clock.now - began >= 90

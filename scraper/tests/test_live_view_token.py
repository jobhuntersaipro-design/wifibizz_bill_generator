"""The viewer token that lets an admin's browser open a job's live stream.

The route it protects is reachable WITHOUT the internal token (EventSource
cannot send headers), so this is the whole gate: unforgeable, short-lived and
bound to one job id. The shared vector pins the Python rule to the TypeScript
one in src/lib/live-view-token.ts — if either drifts, the admin sees 401.

Run from the scraper/ dir:  pytest tests/test_live_view_token.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from live_view import mint_viewer_token, verify_viewer_token  # noqa: E402

SECRET = "test-token"
VECTOR = "job123.1900000000.d8641c3f0304468c252c6e01993ba5060b8659a626391acbb7b40f6020e2845b"


def test_shared_vector_verifies():
    assert verify_viewer_token(VECTOR, "job123", SECRET, now=1899999000) is True


def test_mint_matches_shared_vector():
    assert mint_viewer_token("job123", SECRET, 1900000000) == VECTOR


def test_expired_token_refused():
    assert verify_viewer_token(VECTOR, "job123", SECRET, now=1900000001) is False


def test_wrong_job_refused():
    assert verify_viewer_token(VECTOR, "job999", SECRET, now=1899999000) is False


def test_tampered_signature_refused():
    bad = VECTOR[:-1] + ("0" if VECTOR[-1] != "0" else "1")
    assert verify_viewer_token(bad, "job123", SECRET, now=1899999000) is False


def test_malformed_tokens_refused():
    for t in ["", "job123", "job123.abc.def", "job123.1900000000", None]:
        assert verify_viewer_token(t, "job123", SECRET, now=1899999000) is False


def test_empty_secret_refuses_everything():
    assert verify_viewer_token(VECTOR, "job123", "", now=1899999000) is False

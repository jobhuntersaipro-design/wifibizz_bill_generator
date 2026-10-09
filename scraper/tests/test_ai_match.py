"""The renamed-product fallback: off by default, timid when on.

No real API call is made — the anthropic client is replaced with a fake that
records what it was sent and answers what the test says.
"""
import asyncio
import json
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ai_match  # noqa: E402

OFFERS = ["unifi Home 300Mbps (24M)", "unifi Home 500Mbps (24M)", "unifi Home 1Gbps (24M)"]


class _Block:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _Response:
    def __init__(self, answer, stop_reason="end_turn"):
        self.stop_reason = stop_reason
        self.model = "fake-model"
        self.content = [_Block(json.dumps(answer))]


def _fake_anthropic(monkeypatch, answer=None, stop_reason="end_turn", raises=None):
    sent = {}

    class _Messages:
        async def create(self, **kwargs):
            sent.update(kwargs)
            if raises:
                raise raises
            return _Response(answer, stop_reason)

    class _Client:
        def __init__(self, **kwargs):
            sent["client"] = kwargs
            self.beta = types.SimpleNamespace(messages=_Messages())

    class _APIError(Exception):
        pass

    fake = types.SimpleNamespace(AsyncAnthropic=_Client, APIError=_APIError)
    monkeypatch.setitem(sys.modules, "anthropic", fake)
    monkeypatch.setenv("OE_AI_MATCH", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    return sent


def _pick(*a):
    return asyncio.run(ai_match.pick(*a))


def test_off_unless_opted_in(monkeypatch):
    monkeypatch.delenv("OE_AI_MATCH", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    assert not ai_match.enabled()
    assert _pick("package", "Unifi Home 300Mbps", OFFERS) is None
    monkeypatch.setenv("OE_AI_MATCH", "1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert not ai_match.enabled()


def test_a_confident_pick_of_a_listed_option_is_used(monkeypatch):
    sent = _fake_anthropic(monkeypatch, {"choice": OFFERS[0], "confidence": "high",
                                         "reason": "Same speed and contract."})
    out = _pick("package", "Unifi Home 300Mbps", OFFERS)
    assert out["choice"] == OFFERS[0]
    # Only product names go out: the wanted name and the portal's list.
    prompt = sent["messages"][0]["content"]
    assert "Unifi Home 300Mbps" in prompt and all(o in prompt for o in OFFERS)
    # The answer can only be a listed option (or none).
    schema = sent["output_config"]["format"]["schema"]
    assert schema["properties"]["choice"]["enum"] == [*OFFERS, ""]


def test_anything_short_of_high_confidence_is_a_stop(monkeypatch):
    for confidence in ("medium", "low"):
        _fake_anthropic(monkeypatch, {"choice": OFFERS[0], "confidence": confidence,
                                      "reason": "probably"})
        assert _pick("package", "Unifi Home 300Mbps", OFFERS) is None


def test_none_is_a_stop(monkeypatch):
    _fake_anthropic(monkeypatch, {"choice": "", "confidence": "high", "reason": "no 200Mbps"})
    assert _pick("package", "Unifi Home 200Mbps", OFFERS) is None


def test_an_option_that_is_not_listed_is_never_used(monkeypatch):
    _fake_anthropic(monkeypatch, {"choice": "unifi Home 300Mbps", "confidence": "high",
                                  "reason": "x"})
    assert _pick("package", "Unifi Home 300Mbps", OFFERS) is None


def test_a_refusal_or_an_error_is_a_stop_never_a_crash(monkeypatch):
    _fake_anthropic(monkeypatch, {"choice": OFFERS[0], "confidence": "high", "reason": "x"},
                    stop_reason="refusal")
    assert _pick("package", "Unifi Home 300Mbps", OFFERS) is None
    _fake_anthropic(monkeypatch, raises=TimeoutError("slow"))
    assert _pick("package", "Unifi Home 300Mbps", OFFERS) is None


def test_nothing_to_ask_is_not_asked(monkeypatch):
    sent = _fake_anthropic(monkeypatch, {"choice": "", "confidence": "low", "reason": ""})
    assert _pick("device", "", OFFERS) is None
    assert _pick("device", "Router", []) is None
    assert _pick("device", "Router", [f"opt {i}" for i in range(ai_match.MAX_OPTIONS + 1)]) is None
    assert "messages" not in sent


def test_accept_is_strict():
    assert ai_match.accept({"choice": "a", "confidence": "high"}, ["a"]) == "a"
    assert ai_match.accept({"choice": "a", "confidence": "medium"}, ["a"]) is None
    assert ai_match.accept({"choice": "b", "confidence": "high"}, ["a"]) is None
    assert ai_match.accept(None, ["a"]) is None

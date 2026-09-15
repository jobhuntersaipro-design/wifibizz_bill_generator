"""What a viewer is sent, and what a slow viewer loses.

A frame burst must cost a viewer at most 4 frames a second, and a viewer that
cannot keep up loses FRAMES — never a stage or a log line, because those are
the story and a frame is only its illustration.

Run from the scraper/ dir:  pytest tests/test_live_view_store.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_view  # noqa: E402
from live_view import FrameStore, QUEUE_LIMIT  # noqa: E402


def setup_function(_):
    live_view._STORES.clear()
    live_view._VIEWERS[0] = 0


def test_latest_always_updates_but_forwarding_is_throttled():
    s = FrameStore()
    sub = s.subscribe()
    s.publish_frame("A", now=100.0)
    s.publish_frame("B", now=100.1)   # 0.1s later: latest moves, not forwarded
    s.publish_frame("C", now=100.4)   # 0.4s after A: forwarded
    assert s.latest["jpeg"] == "C"
    got = [sub.get(0.01) for _ in range(3)]
    assert [g[1]["jpeg"] for g in got if g] == ["A", "C"]


def test_full_queue_drops_oldest_frame_never_a_stage_or_log():
    s = FrameStore()
    sub = s.subscribe()
    s.publish_stage({"name": "creating_customer", "detail": None, "at": "t0"})
    for i in range(QUEUE_LIMIT + 5):
        s.publish_frame(f"f{i}", now=1000.0 + i)   # 1s apart: all forwarded
    s.publish_log("a line")
    items = []
    while True:
        it = sub.get(0.01)
        if it is None:
            break
        items.append(it)
    kinds = [k for k, _ in items]
    assert kinds[0] == "stage"
    assert kinds[-1] == "log"
    assert kinds.count("frame") == QUEUE_LIMIT - 2   # 64 cap minus the stage and log
    frames = [d["jpeg"] for k, d in items if k == "frame"]
    assert frames[0] == "f7" and frames[-1] == f"f{QUEUE_LIMIT + 4}"  # oldest dropped


def test_publish_stage_records_history_for_late_joiners():
    s = FrameStore()
    s.publish_stage({"name": "a", "detail": None, "at": "t0"})
    s.publish_stage({"name": "b", "detail": "x", "at": "t1"})
    assert [st["name"] for st in s.stages] == ["a", "b"]


def test_detach_keeps_latest_for_linger_then_evicts():
    s = live_view.get_store("j1", create=True)
    sub = s.subscribe()
    s.publish_frame("last", now=5.0)
    live_view.detach_store("j1", now=1000.0)
    assert sub.closed is True
    assert live_view.get_store("j1", now=1000.0 + live_view.LIVE_VIEW_LINGER_S - 1).latest["jpeg"] == "last"
    assert live_view.get_store("j1", now=1000.0 + live_view.LIVE_VIEW_LINGER_S + 1) is None


def test_module_publish_stage_is_a_no_op_without_a_store():
    live_view.publish_stage("nope", {"name": "a", "detail": None, "at": "t"})  # must not raise


def test_viewer_slots_are_capped():
    for _ in range(live_view.LIVE_VIEW_MAX_VIEWERS):
        assert live_view.acquire_viewer_slot() is True
    assert live_view.acquire_viewer_slot() is False
    live_view.release_viewer_slot()
    assert live_view.acquire_viewer_slot() is True
    assert live_view.viewer_count() == live_view.LIVE_VIEW_MAX_VIEWERS

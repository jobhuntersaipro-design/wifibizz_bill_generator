"""The screencast produces frames from a real page, and a repaint produces a newer one.

Real Chromium, no portal: a page with a coloured box, then the box changes
colour. If attach() silently produced nothing, the live page would sit on
"Waiting for the browser…" forever — so this is the one test that must use the
real browser.

Run from the scraper/ dir:  pytest tests/test_live_view_screencast.py
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live_view  # noqa: E402

HTML = "<html><body style='margin:0'><div id=b style='width:400px;height:300px;background:%s'></div></body></html>"


def _run(coro):
    return asyncio.run(coro)


async def _wait_for(pred, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        await asyncio.sleep(0.05)
    return False


def test_attach_produces_frames_and_a_repaint_produces_a_newer_one():
    async def go():
        from playwright.async_api import async_playwright
        live_view._STORES.clear()
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 640, "height": 480})
            await page.set_content(HTML % "red")
            session = await live_view.attach(page, "jobA")
            assert session is not None
            store = live_view.get_store("jobA")
            assert await _wait_for(lambda: store.latest is not None)
            first = store.latest["jpeg"]
            assert len(first) > 200  # a real base64 JPEG, not an empty string
            await page.evaluate("document.getElementById('b').style.background='blue'")
            assert await _wait_for(lambda: store.latest["jpeg"] != first)
            await live_view.detach("jobA", session)
            assert store.detached_at is not None
            await browser.close()
    _run(go())


def test_attach_never_raises_on_a_broken_page():
    class Broken:
        @property
        def context(self):
            raise RuntimeError("no context")
    assert _run(live_view.attach(Broken(), "jobB")) is None
    _run(live_view.detach("jobB", None))  # must not raise either

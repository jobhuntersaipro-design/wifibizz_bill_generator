"""
oe_dry_run.py - Watchable headed dry-run of the order flow (dev tool).

Runs enter_order(payload, dry_run=True) with a HEADED, slow-mo browser so you
can watch stages 1-5 execute against the live portal, and auto-dumps the DOM of
the first unmapped screen (stages 6-13) so it can be mapped.

It NEVER submits: dry_run is forced True here. Stage 12's Pay/Submit is not
reached — the flow either stops at the capture frontier (status=needs_capture)
or at the dry-run stop once 6-11 are mapped.

Usage (from scraper/ project root, with config/ credentials present):
    python oe_dry_run.py
    python oe_dry_run.py --payload tests/fixtures/payload_residential.json
    python oe_dry_run.py --headless          # for CI / no display

The headed monkeypatch mirrors inspect_order_entry.py so login/stealth/patching
behave identically — we only flip headless off and add slow-mo.
"""

import argparse
import asyncio
import json
import os

import login_manager
import order_entry

DEFAULT_PAYLOAD = "tests/fixtures/payload_residential.json"


def _make_headed_launch(slow_mo: int):
    async def _headed_launch_safe():
        from playwright.async_api import async_playwright
        from playwright_stealth import Stealth

        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            headless=False,
            slow_mo=slow_mo,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--start-maximized",
            ],
            ignore_default_args=["--enable-automation"],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        await context.add_init_script(login_manager.STEALTH_SCRIPT)
        await Stealth().apply_stealth_async(context)

        async def handle_fishx_route(route):
            url = route.request.url
            try:
                response = await route.fetch()
                body = await response.text()
                patched = login_manager._patch_script(body, url)
                await route.fulfill(
                    status=response.status, headers=dict(response.headers), body=patched
                )
            except Exception as e:
                print(f"fishx intercept failed for {url}: {e}")
                await route.continue_()

        async def block_anti_bot(route):
            await route.abort()

        await context.route("**/fishx*.js", handle_fishx_route)
        await context.route("**/*no-devtool*", block_anti_bot)
        await context.route("**/*disable-devtool*", block_anti_bot)

        page = await context.new_page()
        page.set_default_timeout(45000)
        page.set_default_navigation_timeout(90000)
        print("[BROWSER] HEADED + Stealth + surgical patch")
        return pw, browser, context, page

    return _headed_launch_safe


async def main(payload_path: str, headless: bool, slow_mo: int):
    with open(payload_path) as f:
        payload = json.load(f)

    if not headless:
        # Force headed for the watchable run (same approach as inspect_order_entry).
        login_manager._launch_browser_safe = _make_headed_launch(slow_mo)

    print(f"Running DRY-RUN with payload: {payload_path}")
    result = await order_entry.enter_order(payload, dry_run=True, dump_on_capture=True)

    print("\n" + "=" * 60)
    print("DRY-RUN RESULT")
    print("=" * 60)
    print(json.dumps(result, indent=2, default=str))

    status = result.get("status")
    if status == "needs_capture":
        print(
            f"\n→ Reached the capture frontier at stage '{result.get('stage')}'.\n"
            f"  DOM outline:  {result.get('dump')}\n"
            f"  Screenshot:   {result.get('screenshot')}\n"
            f"  Use these to fill in selectors for this stage in order_entry.py."
        )
    elif status == "error":
        print(f"\n→ Expected flow error: {result.get('error')} — {result.get('message')}")
    elif status == "dry_run":
        print("\n→ Walked all mapped stages and stopped before Pay/Submit. ✅")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", default=DEFAULT_PAYLOAD, help="Path to payload JSON.")
    ap.add_argument("--headless", action="store_true", help="Run without a visible window.")
    ap.add_argument("--slow-mo", type=int, default=150, help="Headed slow-mo ms.")
    args = ap.parse_args()

    if not os.path.exists(args.payload):
        raise SystemExit(f"Payload not found: {args.payload}")

    asyncio.run(main(args.payload, args.headless, args.slow_mo))

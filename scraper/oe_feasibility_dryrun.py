"""
oe_feasibility_dryrun.py — DEV dry-run (read-only) of the FEASIBILITY step:
anonymous Feasibility survey → select serviceable address → select the package
(Main Offer). STOPS before the "Order" button — no customer, no order created.

This exercises the "address query → package query" step the order flow needs,
against a real dealer session. Screenshots + DOM dumps at each step to logs/.

Run from scraper/:
    python oe_feasibility_dryrun.py <session.json> "<STATE>" "<addr keyword>" "<package name>"
"""

import asyncio
import sys

import dealer_web_login
from oe_dump import dump_iframe_dialog
from oe_helpers import set_combobox
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, open_feasibility, _frame


async def _try(label, coro):
    try:
        await coro
        print(f"  ✓ {label}")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ {label}: {type(e).__name__}: {str(e)[:130]}")
        return False


async def run(session_path, state, keyword, package):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL
        )
        await ensure_on_order_entry(page)
        frame = _frame(page)

        print("→ open_feasibility (anonymous survey)")
        await open_feasibility(frame)
        await asyncio.sleep(2)

        # ── Address step ──────────────────────────────────────────────────────
        print("→ open Select Address modal (expand icon)")
        addr_field = frame.locator('input[name="installationAddress"]').first
        await addr_field.wait_for(state="attached", timeout=30000)
        await frame.locator(
            '.js-address-pop span.input-group-addon:has(.glyphicon-new-window)'
        ).first.click(timeout=8000, force=True)
        await asyncio.sleep(2)

        print(f"→ query address: state={state!r} keyword={keyword!r}")
        await _try("set custType=Consumer", set_combobox(frame, "custType", "Consumer"))
        await _try(f"set state={state}", set_combobox(frame, "state", state))
        await _try("#byKeywords", frame.locator("#byKeywords").first.click(timeout=5000))
        await _try("fill keywords", frame.locator('input[name="keywords"]').first.fill(keyword, timeout=5000))
        await frame.locator(".js-address-form .js-query").first.click(timeout=8000)
        await asyncio.sleep(6)

        # Pick the first result row (if any).
        rows = frame.locator(".js-address-grid tr.jqgrow")
        n = await rows.count()
        print(f"  address results: {n}")
        if n == 0:
            await dump_iframe_dialog(page, "feas_address_none")
            print("  ⚠ no serviceable address for that keyword — stopping.")
            return
        await rows.first.click()
        await frame.locator('.ui-dialog:has(form.js-address-form) .js-ok').first.click(timeout=8000)
        await asyncio.sleep(3)
        await dump_iframe_dialog(page, "feas_address_selected")
        print("  ✓ address selected")

        # ── Package step ─────────────────────────────────────────────────────
        # NOT a Main Offer Selector modal: after the address is picked the offers
        # load INLINE into the "Subscription Plan List" jqGrid (.js-offer-grid),
        # filtered by its own search box. Pick the plan row, then STOP before the
        # Order button (.js-orderNow).
        await asyncio.sleep(2)
        grid = frame.locator(".js-offer-grid")
        await _try("plan list grid visible", grid.first.wait_for(state="visible", timeout=20000))

        async def dump_offers(tag):
            rows = frame.locator(".js-offer-grid tr.jqgrow")
            n = await rows.count()
            print(f"  [{tag}] plan rows: {n}")
            for i in range(min(n, 15)):
                tds = rows.nth(i).locator("td[title]")
                titles = []
                for j in range(await tds.count()):
                    t = ((await tds.nth(j).get_attribute("title")) or "").strip()
                    if t:
                        titles.append(t)
                print(f"     row{i}: {titles[:6]}")
            return n

        await dump_offers("before search")

        # Filter the plan list by the package name via its search box.
        search = frame.locator(".search-group.search-group-tail input.form-control, .search-group input.ui-seticon-fish").first
        await _try(f"type package into plan search: {package!r}", search.fill(package, timeout=6000))
        await asyncio.sleep(3)
        await dump_offers("after search")

        # Pick the matching plan row (match a distinctive substring).
        needle = "500Mbps Premium Value"
        picked = await _try(
            f"select plan row (contains {needle!r})",
            frame.locator(f'.js-offer-grid tr.jqgrow:has(td[title*="{needle}"])').first.click(timeout=6000),
        )
        await asyncio.sleep(2)
        await dump_iframe_dialog(page, "feas_after_package")

        order_btn = frame.locator(".js-orderNow")
        order_ready = await order_btn.first.is_enabled() if await order_btn.count() else False
        print(f"\n  plan picked: {picked} | '.js-orderNow' present={await order_btn.count()>0} enabled={order_ready}")
        print("✓ feasibility dry-run complete (STOPPED before the Order button '.js-orderNow').")

    finally:
        for c in ((context.close if context else None), (browser.close if browser else None), (pw.stop if pw else None)):
            if c:
                try:
                    await c()
                except Exception:
                    pass


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    st = sys.argv[2] if len(sys.argv) > 2 else "SELANGOR"
    kw = sys.argv[3] if len(sys.argv) > 3 else "PETALING"
    pkg = sys.argv[4] if len(sys.argv) > 4 else "Unifi Home 300Mbps Netflix"
    asyncio.run(run(sess, st, kw, pkg))

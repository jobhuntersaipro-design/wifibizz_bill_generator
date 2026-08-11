"""
oe_capture_address.py — DEV DISCOVERY (read-only, non-failing inspector).

Walks the anonymous Feasibility → Select Address flow against a saved dealer
session and, at each step, (a) dumps the live iframe DOM + a screenshot and
(b) records any `callservice.json` / QryNIGAddress network traffic. Goal: learn
the real Select Address modal DOM and the QryNIGAddress request/response shape so
we can build the BizzFlow address picker.

No customer and no order are created (anonymous feasibility survey only).

Run from scraper/:
    python oe_capture_address.py sessions/dealer_<key>.json "SELANGOR" "JALAN"
"""

import asyncio
import json
import os
import sys
import time

import dealer_web_login
from oe_dump import dump_iframe_dialog
from order_entry import ensure_on_order_entry, open_feasibility, _frame

OUT_DIR = "logs"


async def _try(label, coro):
    try:
        await coro
        print(f"  ✓ {label}")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ {label} failed: {type(e).__name__}: {str(e)[:120]}")
        return False


async def main(session_path: str, state: str, keyword: str) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    pw = browser = context = page = None
    captured = []

    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path,
            landing_url="https://dealer.unifi.com.my/esales/crm-TYMH100163",
        )

        def _on_response(resp):
            # Capture ALL POSTs to the portal so nothing is missed regardless of
            # which path/serviceName QryNIGAddress uses.
            if resp.request.method == "POST" and "dealer.unifi.com.my" in resp.url:
                captured.append(resp)

        page.on("response", _on_response)

        await ensure_on_order_entry(page)
        frame = _frame(page)
        await dump_iframe_dialog(page, "addr_00_landing")

        print("→ open_feasibility")
        await open_feasibility(frame)
        await asyncio.sleep(3)
        await dump_iframe_dialog(page, "addr_01_after_feasibility")

        # Wait for the Installation Address field to actually render (it can lag).
        print("→ wait for installationAddress field")
        addr_field = frame.locator('input[name="installationAddress"]').first
        try:
            await addr_field.wait_for(state="attached", timeout=30000)
            print("  ✓ installationAddress present")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ installationAddress never rendered: {str(e)[:120]}")

        # Open the Select Address modal via the EXPAND icon (glyphicon-new-window)
        # inside .js-address-pop — NOT the div itself.
        print("→ click the expand icon in .js-address-pop")
        expand = frame.locator(
            '.js-address-pop span.input-group-addon:has(.glyphicon-new-window)'
        ).first
        if not await _try("expand icon click", expand.click(timeout=8000, force=True)):
            # fall back to clicking the glyphicon directly
            await _try(
                "glyphicon click",
                frame.locator('.js-address-pop .glyphicon-new-window').first.click(timeout=8000, force=True),
            )
        await asyncio.sleep(3)
        await dump_iframe_dialog(page, "addr_02_select_address_modal")

        # The Query only fires QryNIGAddress once the REQUIRED fields are set:
        # Customer Type + State (both comboboxes) + Keywords. Read each combobox's
        # options live, then pick sensible values.
        async def _options(hidden_name):
            try:
                wrap = f'(//input[@name="{hidden_name}"])[1]/parent::*'
                caret = frame.locator(
                    f'xpath={wrap}//span[contains(@class,"input-group-addon")]'
                ).first
                await caret.click(timeout=5000, force=True)
                menu = frame.locator("ul.combobox-dropdown:visible").last
                await menu.wait_for(state="visible", timeout=4000)
                titles = [await o.get_attribute("title") for o in await menu.locator("li[title]").all()]
                await caret.click(timeout=3000, force=True)  # close
                return [t for t in titles if t]
            except Exception as e:  # noqa: BLE001
                return [f"(err: {str(e)[:60]})"]

        cust_opts = await _options("custType")
        state_opts = await _options("state")
        print(f"  custType options: {cust_opts}")
        print(f"  state options: {state_opts}")

        from oe_helpers import set_combobox
        # Prefer Consumer (residential) if present.
        cust_choice = next((c for c in cust_opts if "consumer" in (c or "").lower()), None) or (
            cust_opts[0] if cust_opts and not cust_opts[0].startswith("(err") else None
        )
        if cust_choice:
            await _try("set custType", set_combobox(frame, "custType", cust_choice))
        st_choice = next((s for s in state_opts if state.upper() in (s or "").upper()), None)
        if st_choice:
            await _try("set state", set_combobox(frame, "state", st_choice))

        await _try("#byKeywords click", frame.locator("#byKeywords").first.click(timeout=5000))
        kw = frame.locator('input[name="keywords"]').first
        await _try("keywords fill", kw.fill(keyword, timeout=5000))
        await _try("keywords blur", kw.press("Tab", timeout=3000))
        await dump_iframe_dialog(page, "addr_03_before_query")

        # Mark where the query starts so we can see exactly what the click fires.
        query_marker = len(captured)
        await _try(".js-query click", frame.locator(".js-address-form .js-query").first.click(timeout=8000))
        await asyncio.sleep(8)
        await dump_iframe_dialog(page, "addr_04_after_query")
        print(f"  → {len(captured) - query_marker} POST(s) fired after the Query click")

        # Read captured bodies before the context closes.
        records = []
        for resp in captured:
            req = resp.request
            try:
                body = await resp.text()
            except Exception as e:  # noqa: BLE001
                body = f"(body unavailable: {e})"
            records.append({
                "url": resp.url,
                "method": req.method,
                "status": resp.status,
                "request_headers": dict(req.headers),
                "post_data": req.post_data,
                "response_body": body[:20000],
            })

        stamp = time.strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(OUT_DIR, f"qrynig_capture_{stamp}.json")
        with open(out_path, "w") as f:
            json.dump({"records": records}, f, indent=2)

        print(f"\n✓ captured {len(records)} matching network request(s) → {out_path}")
        for r in records:
            print(f"    [{r['status']}] {r['method']} {r['url'][:120]}")

    finally:
        for closer in (
            (context.close if context else None),
            (browser.close if browser else None),
            (pw.stop if pw else None),
        ):
            if closer:
                try:
                    await closer()
                except Exception:
                    pass


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    st = sys.argv[2] if len(sys.argv) > 2 else "SELANGOR"
    kw = sys.argv[3] if len(sys.argv) > 3 else "JALAN"
    asyncio.run(main(sess, st, kw))

"""REAL feasibility run (creates a real order) — heavy diagnostics. Selects the
address + plan, clicks Order, handles a possible confirm dialog, and captures
the Customer Order Number. Screenshots + body/dialog dumps at every step so we
can see exactly what the portal did (and how to cancel).

    FEAS_* env vars set by the caller (state/address_full/offer).
    python oe_real_feasibility.py <session.json>
"""
import asyncio
import os
import re
import sys
import time

import dealer_web_login
from oe_feasibility import open_feasibility, select_address, select_plan
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry


async def snap(page, tag):
    p = f"logs/real_{tag}_{time.strftime('%H%M%S')}.png"
    await page.screenshot(path=p, full_page=True)
    print(f"    [shot] {p}")


async def dump_dialogs(frame):
    dlgs = frame.locator(".ui-dialog:visible")
    n = await dlgs.count()
    out = []
    for i in range(n):
        title = ""
        t = dlgs.nth(i).locator(".ui-dialog-title, .modal-title, .modal-header")
        if await t.count():
            title = (await t.first.inner_text()).strip()
        msg = ""
        m = dlgs.nth(i).locator(".modal-message, .modal-body")
        if await m.count():
            msg = (await m.first.inner_text()).strip()[:200]
        btns = []
        b = dlgs.nth(i).locator(".modal-footer button, .ui-dialog-buttonpane button")
        for j in range(await b.count()):
            btns.append((await b.nth(j).inner_text()).strip())
        out.append({"title": title, "msg": msg, "buttons": btns})
    return out


async def find_order_id(frame):
    txt = await frame.locator("body").first.inner_text()
    m = re.search(r"(?:Customer\s+)?Order\s+N(?:o|umber)\.?\s*[:：]?\s*([A-Z0-9]{6,})", txt, re.I)
    return m.group(1) if m else None


async def main(session_path):
    payload_addr = {
        "state": os.environ.get("FEAS_STATE", "SELANGOR").upper(),
        "customer_type": "Consumer",
        "address_id": os.environ.get("FEAS_ADDRESS_ID") or None,
        "address_full": os.environ.get("FEAS_ADDRESS_FULL", ""),
        "keywords": os.environ.get("FEAS_ADDRESS_FULL", ""),
    }
    plan = {"name": os.environ.get("FEAS_OFFER", "")}

    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)

        print("→ open_feasibility"); await open_feasibility(frame); await asyncio.sleep(2)
        print("→ select_address"); r = await select_address(frame, payload_addr); print("   ", r)
        if r["status"] != "ok":
            await snap(page, "addr_fail"); return
        print("→ select_plan"); r = await select_plan(frame, plan); print("   ", r)
        if r["status"] != "ok":
            await snap(page, "plan_fail"); return

        await snap(page, "before_order")
        order_btn = frame.locator(".js-orderNow").first
        print(f"→ Order enabled: {await order_btn.is_enabled()}")

        print("→ CLICKING ORDER (real)…")
        await order_btn.click()
        await asyncio.sleep(4)
        await snap(page, "after_order_click")

        # A confirm dialog may gate the actual order creation.
        for step in range(3):
            dlgs = await dump_dialogs(frame)
            if dlgs:
                print(f"   dialog(s) after order: {dlgs}")
            oid = await find_order_id(frame)
            if oid:
                print(f"\n✅ ORDER ID CAPTURED: {oid}")
                await snap(page, "order_id")
                return
            # If there's a confirm/OK/Yes button, the order isn't minted until clicked.
            confirm = frame.locator(
                '.ui-dialog:visible .modal-footer .btn-primary, '
                '.ui-dialog:visible button:has-text("Confirm"), '
                '.ui-dialog:visible button:has-text("Yes"), '
                '.ui-dialog:visible button:has-text("OK")'
            ).first
            if await confirm.count() and await confirm.is_visible():
                label = (await confirm.inner_text()).strip()
                print(f"   → confirm dialog present; clicking '{label}' to proceed…")
                await confirm.click()
                await asyncio.sleep(4)
                await snap(page, f"after_confirm_{step}")
                continue
            break

        oid = await find_order_id(frame)
        print(f"\n{'✅ ORDER ID: '+oid if oid else '⚠️ No order id captured — see screenshots/body dump.'}")
        body = (await frame.locator('body').first.inner_text())[:1200]
        with open(f"logs/real_body_{time.strftime('%H%M%S')}.txt", "w") as fh:
            fh.write(body)
        print("   (body dump written to logs/real_body_*.txt)")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess))

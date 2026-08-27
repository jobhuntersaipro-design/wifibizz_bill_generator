"""DEV probe (read-only): land on Order Entry, look for an order-list / grid
showing in-progress orders (e.g. 2608000122285074), and dump what's clickable.
No clicks that advance/submit anything -- just locate + screenshot."""
import asyncio, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, _frame, ensure_on_order_entry

ORDER_ID = "2608000122285074"

async def main(session_path):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        await page.wait_for_timeout(2000)
        await page.screenshot(path="logs/probe_oe_landing.png", full_page=True)
        print("screenshot: logs/probe_oe_landing.png")

        # Look for the order number anywhere on the page/frame.
        for label, loc in [("page", page), ("frame", frame)]:
            try:
                txt = await loc.locator("body").first.inner_text(timeout=5000)
                found = ORDER_ID in txt
                print(f"[{label}] order id present in body text: {found}")
            except Exception as e:
                print(f"[{label}] error: {e}")

        # Common nav labels for an order list / history within Order Entry.
        candidates = ["My Order", "Order List", "Order History", "History", "Draft"]
        for c in candidates:
            loc = frame.locator(f"text={c}")
            n = await loc.count()
            print(f"nav candidate {c!r}: count={n}")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

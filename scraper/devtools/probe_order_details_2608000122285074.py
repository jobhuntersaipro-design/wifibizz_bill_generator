"""DEV probe (read-only): open the portal's OrderDetails page for the stranded
order 2608000122285074 (ORD-0025) and dump what it says about the missing
'contactless order attachment'. Pure GET navigation + read — no clicks, no
Next, no Pay. Does not touch the live order-entry flow."""
import asyncio, sys
from dotenv import load_dotenv
load_dotenv("../.env"); load_dotenv(".env")

import dealer_web_login
from oe_feasibility import _order_detail_url

ORDER_ID = "2608000122285074"

async def main(session_path):
    pw = browser = context = page = None
    try:
        url = _order_detail_url(ORDER_ID)
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=url)
        await page.wait_for_timeout(4000)
        await page.screenshot(path="logs/probe_order_details.png", full_page=True)
        print("URL:", page.url)
        print("screenshot: logs/probe_order_details.png")
        txt = await page.locator("body").first.inner_text()
        print("----- BODY TEXT (first 4000 chars) -----")
        print(txt[:4000])
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

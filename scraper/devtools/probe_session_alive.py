"""DEV probe (read-only): open a saved dealer session, land on Order Entry,
report whether we're logged in. Nothing clicked inside the portal."""
import asyncio, sys
import dealer_web_login
from order_entry import ORDER_ENTRY_URL

async def main(session_path):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await asyncio.sleep(6)
        url = page.url
        title = await page.title()
        has_iframe = await page.evaluate("!!document.querySelector('#myIframe')")
        print(f"url={url}\ntitle={title!r}\nhas_order_iframe={has_iframe}")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)

asyncio.run(main(sys.argv[1]))

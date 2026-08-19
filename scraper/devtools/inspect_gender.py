"""Open the Personal Customer form, set ID Type, then click the Gender caret and
dump every dropdown-like element + visibility so we can see what actually opens."""
import asyncio
import json

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())

import login_manager
import order_entry
from inspect_order_entry import _headed_launch_safe
from oe_helpers import set_combobox

USER_KEY = "cmno32fci000004jn760fh8fl"
SESSION = f"sessions/dealer_{USER_KEY}.json"


async def main():
    login_manager._launch_browser_safe = _headed_launch_safe
    import dealer_web_login

    pw, browser, context, page = await dealer_web_login.open_context_from_session(SESSION)
    try:
        await order_entry.ensure_on_order_entry(page)
        frame = page.frame_locator("#myIframe")
        await frame.locator(".js-order-search").first.click()
        await frame.locator(".js-add-cust-btn").first.click()
        await frame.locator(".show-customer-left").first.wait_for(state="visible", timeout=15000)
        await frame.locator(".show-customer-left").first.click()
        await asyncio.sleep(2.5)

        # Set ID type (this is the one that works today), then probe gender.
        await set_combobox(frame, "certTypeId", "MyKad")
        await asyncio.sleep(1.0)

        fr = None
        for f in page.frames:
            if "CCEntryView" in (f.url or ""):
                fr = f
                break

        # Click the gender caret via JS and report what appears.
        probe = await fr.evaluate(
            """() => {
              const hidden = document.querySelector('input[name="gender"]');
              const wrap = hidden && hidden.parentElement;
              const disp = wrap && wrap.querySelector('input[role="combobox"]');
              const caret = wrap && wrap.querySelector('.input-group-addon');
              const before = disp && disp.getAttribute('aria-expanded');
              if (caret) caret.click();
              const owns = disp && disp.getAttribute('aria-owns');
              const menu = owns && document.getElementById(owns);
              const allMenus = [...document.querySelectorAll('ul.combobox-dropdown, [id^=combobox-dropdown]')]
                .map(u => ({ id:u.id, tag:u.tagName, cls:u.className,
                             display:getComputedStyle(u).display,
                             vis:u.offsetParent!==null,
                             items:u.querySelectorAll('li').length }));
              return {
                disp_found: !!disp, caret_found: !!caret, expanded_before: before,
                expanded_after: disp && disp.getAttribute('aria-expanded'),
                owns, own_menu_display: menu && getComputedStyle(menu).display,
                own_menu_items: menu ? menu.querySelectorAll('li').length : null,
                own_menu_li_titles: menu ? [...menu.querySelectorAll('li')].slice(0,6).map(li=>li.getAttribute('title')) : null,
                allMenus
              };
            }"""
        )
        print(json.dumps(probe, indent=2, ensure_ascii=False))
        await asyncio.sleep(3)
    finally:
        await browser.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())

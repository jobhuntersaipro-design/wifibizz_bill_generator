"""
oe_capture_landing.py - Diagnostic: find which action opens the combobox
dropdown and where the menu lands. Read-only.
"""

import asyncio
import json

import login_manager
import order_entry


async def find_menu(page):
    return await page.evaluate(
        r"""(() => {
          const d = document.querySelector('#myIframe').contentDocument;
          const menus = [...d.querySelectorAll('[id^="combobox-dropdown"], ul.combobox-dropdown, .dropdown-list, [role="listbox"]')];
          const vis = menus.filter(m => m.offsetParent !== null);
          return {
            total: menus.length,
            visible: vis.length,
            samples: vis.slice(0,3).map(m => ({
              tag:m.tagName.toLowerCase(), id:m.id, cls:(m.className||'').toString().slice(0,70),
              parent:(m.parentElement?.tagName||'')+'.'+(m.parentElement?.className||'').toString().slice(0,40),
              items:[...m.querySelectorAll('li,[role="option"]')].map(li=>li.getAttribute('title')||(li.innerText||'').trim()).slice(0,10),
            })),
          };
        })()"""
    )


async def main():
    from credential_manager import CredentialManager

    creds = CredentialManager().get_credentials()
    browser, context, pw, page = await login_manager.login_and_get_context(
        creds["username"], creds["password"]
    )
    try:
        await order_entry.ensure_on_order_entry(page)
        frame = page.frame_locator("#myIframe")
        await frame.locator(".js-order-search").first.click()
        await frame.locator(".js-add-cust-btn").first.click()
        await frame.locator(".show-customer-left").first.wait_for(state="visible", timeout=15000)
        await frame.locator(".show-customer-left").first.click()
        await frame.locator('input[name="certTypeId"]').first.wait_for(state="attached", timeout=15000)
        await page.wait_for_timeout(1200)
        print("✅ form open\n")

        wrapper = frame.locator(
            'xpath=(//input[@name="certTypeId"])[1]/parent::*'
        ).first

        strategies = [
            ("addon caret", wrapper.locator(".input-group-addon").first),
            ("triangle glyph", wrapper.locator(".glyphicon-triangle-bottom").first),
            ("display input", wrapper.locator('input[role="combobox"]').first),
            ("combobox-fish div", wrapper.locator(".ui-combobox-fish").first),
        ]
        for label, loc in strategies:
            try:
                await loc.click(timeout=4000)
                await page.wait_for_timeout(900)
                menu = await find_menu(page)
                print(f"[{label}] -> visible menus: {menu['visible']}")
                if menu["visible"]:
                    print(json.dumps(menu, indent=2, default=str))
                    print(f"\n>>> WINNER: '{label}' opens the dropdown.")
                    break
                # close anything and retry next strategy
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(300)
            except Exception as e:
                print(f"[{label}] click failed: {e}")
    finally:
        await context.close()
        await browser.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())

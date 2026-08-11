"""
inspect_order_entry.py
=======================
Inspection helper for building the Order Entry automation (order_entry.py).

What it does
------------
1. Reuses your existing login_manager.login_and_get_context() — same stealth,
   same fishx patching, same session cache. The devtools detector never fires
   because we never open browser devtools.
2. Navigates Retail -> Order Entry.
3. Opens the Playwright Inspector (page.pause()) so you can hover & pick
   elements and copy auto-generated selectors WITHOUT browser devtools.
4. Gives you a dump_html() helper you can call from the Inspector console
   (or from code) to capture the DOM of any step to a file for offline study.

How to run
----------
    # headed so you can see + use the Inspector
    python inspect_order_entry.py

    # or capture-only mode: walk to a step, dump HTML, exit (no pause)
    python inspect_order_entry.py --auto-dump

Requirements
------------
- Run from the SAME folder as login_manager.py, scrape_orders.py, etc.
- Your .env / credential setup must already work for the scraper.
- IMPORTANT: this opens a REAL authenticated session. It only READS and
  navigates. It never clicks Pay/Submit. Safe to run.

Notes
-----
- login_manager launches headless=True by default. This script flips it to
  headed via the HEADED override below so you can actually watch + inspect.
"""

import argparse
import asyncio
import os
import re
from datetime import datetime

# We import the module (not just the function) so we can monkeypatch the
# browser launch to headed mode without editing login_manager.py.
import login_manager
from credential_manager import CredentialManager

ORDER_ENTRY_URL = "https://dealer.unifi.com.my/esales/crm-TYMH100163"
DUMP_DIR = "inspect_dumps"
os.makedirs(DUMP_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Force headed mode for inspection.
#
# login_manager._launch_browser_safe() hardcodes headless=True. Rather than
# edit that shared file, we wrap pw.chromium.launch so headless is forced off
# whenever this script runs. Everything else (stealth, routes, patching) is
# untouched.
# ---------------------------------------------------------------------------
_original_launch_safe = login_manager._launch_browser_safe


async def _headed_launch_safe():
    """Patched copy of _launch_browser_safe that runs headed + slow-mo."""
    from playwright.async_api import async_playwright
    from playwright_stealth import Stealth

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        headless=False,  # <-- the only real change
        slow_mo=150,  # <-- makes actions watchable
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
    stealth = Stealth()
    await stealth.apply_stealth_async(context)

    async def handle_fishx_route(route):
        url = route.request.url
        try:
            response = await route.fetch()
            body = await response.text()
            patched = login_manager._patch_script(body, url)
            await route.fulfill(
                status=response.status,
                headers=dict(response.headers),
                body=patched,
            )
        except Exception as e:
            print(f"fishx intercept failed for {url}: {e}")
            await route.continue_()

    async def block_anti_bot_urls(route):
        print(f"Blocked URL: {route.request.url}")
        await route.abort()

    await context.route("**/fishx*.js", handle_fishx_route)
    await context.route("**/*no-devtool*", block_anti_bot_urls)
    await context.route("**/*disable-devtool*", block_anti_bot_urls)

    page = await context.new_page()
    page.set_default_timeout(45000)
    page.set_default_navigation_timeout(90000)

    async def on_frame_navigated(frame):
        try:
            if any(k in frame.url.lower() for k in ["no-devtool", "disable-devtool"]):
                print(f"Frame navigated to blocked page - going back: {frame.url}")
                await page.go_back()
        except Exception:
            pass

    page.on("framenavigated", on_frame_navigated)
    print("[BROWSER] engine=playwright chromium (HEADED + Stealth + surgical patch)")
    return pw, browser, context, page


# ---------------------------------------------------------------------------
# DOM dump helpers
# ---------------------------------------------------------------------------
def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


async def dump_html(page, label: str, selector: str = None):
    """
    Capture DOM to a file for offline inspection.

    label:    short name for the step, e.g. "personal_customer_form"
    selector: optional CSS selector to capture just one subtree
              (e.g. ".ant-modal-body"). If None, captures the whole page.

    Writes:  inspect_dumps/<timestamp>_<label>.html
    Also writes a screenshot alongside it.
    """
    ts = datetime.now().strftime("%H%M%S")
    base = os.path.join(DUMP_DIR, f"{ts}_{_safe(label)}")

    if selector:
        loc = page.locator(selector)
        if await loc.count() == 0:
            print(f"  [dump] selector not found: {selector} (dumping full page)")
            html = await page.content()
        else:
            html = await loc.first.evaluate("el => el.outerHTML")
    else:
        html = await page.content()

    html_path = f"{base}.html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    png_path = f"{base}.png"
    try:
        await page.screenshot(path=png_path, full_page=True)
    except Exception as e:
        png_path = f"(screenshot failed: {e})"

    print(f"  [dump] HTML -> {html_path}")
    print(f"  [dump] PNG  -> {png_path}")
    return html_path


async def list_form_fields(page, scope: str = ".ant-modal-body"):
    """
    Quick inventory of inputs/selects/buttons in a scope. Great first look at a
    form before you decide what to capture in full. Prints id, name, placeholder,
    label-ish text. Use scope='body' for the whole page.
    """
    js = """
    (scopeSel) => {
        const root = scopeSel === 'body'
            ? document.body
            : document.querySelector(scopeSel);
        if (!root) return {error: 'scope not found: ' + scopeSel};

        const grab = (el) => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            id: el.id || '',
            name: el.getAttribute('name') || '',
            placeholder: el.getAttribute('placeholder') || '',
            text: (el.innerText || '').trim().slice(0, 40),
            cls: (el.className || '').toString().slice(0, 80),
        });

        const inputs  = Array.from(root.querySelectorAll('input')).map(grab);
        const selects = Array.from(root.querySelectorAll('.ant-select')).map(grab);
        const buttons = Array.from(root.querySelectorAll('button')).map(grab);
        return {inputs, selects, buttons};
    }
    """
    result = await page.evaluate(js, scope)
    print(f"\n  ===== form fields in [{scope}] =====")
    if isinstance(result, dict) and result.get("error"):
        print(f"  {result['error']}")
        return result
    for kind in ("inputs", "selects", "buttons"):
        items = result.get(kind, [])
        print(f"\n  --- {kind} ({len(items)}) ---")
        for it in items:
            bits = [f"<{it['tag']}>"]
            if it["type"]:
                bits.append(f"type={it['type']}")
            if it["id"]:
                bits.append(f"id={it['id']}")
            if it["name"]:
                bits.append(f"name={it['name']}")
            if it["placeholder"]:
                bits.append(f"ph='{it['placeholder']}'")
            if it["text"]:
                bits.append(f"text='{it['text']}'")
            print("    " + "  ".join(bits))
    return result


async def close_blocking_popup(page):
    """Same logic as scrape_orders.close_blocking_popup, inlined to avoid
    importing the whole scraper. Clears the 'Later'/announcement modal."""
    try:
        modal = page.locator(".ant-modal-wrap")
        if await modal.count() > 0 and await modal.first.is_visible():
            for sel in [
                'button.ant-btn:has-text("Later")',
                ".ant-modal-close",
                'button.ant-btn:has-text("Cancel")',
                'button.ant-btn:has-text("Close")',
            ]:
                btn = page.locator(sel)
                if await btn.count() > 0 and await btn.first.is_visible():
                    await btn.first.click()
                    await page.wait_for_timeout(1000)
                    return
            await page.mouse.click(1, 1)
            await page.wait_for_timeout(800)
    except Exception as e:
        print(f"  popup close error: {e}")


# ---------------------------------------------------------------------------
# Navigation to Order Entry
# ---------------------------------------------------------------------------
async def go_to_order_entry(page):
    """Navigate straight to the Order Entry CRM URL and clear popups."""
    print("\nNavigating to Order Entry...")
    await page.goto(ORDER_ENTRY_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)

    if "no-devtool" in page.url.lower() or "login" in page.url.lower():
        raise RuntimeError(
            f"Landed on {page.url} - session may be invalid or detector fired. "
            "Re-run; login_manager will do a fresh OTP login."
        )

    await close_blocking_popup(page)

    # Confirm we're on the Order Entry screen (tabs: Subscriber/Account/Order...)
    try:
        await page.wait_for_selector('text="Order Entry"', timeout=15000)
        print("  On Order Entry screen.")
    except Exception:
        print("  WARNING: 'Order Entry' heading not found - check the screenshot.")

    await dump_html(page, "00_order_entry_landing")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main(auto_dump: bool):
    # Force headed
    login_manager._launch_browser_safe = _headed_launch_safe

    cm = CredentialManager()
    if not cm.credentials_exist():
        raise SystemExit(
            "No credentials saved. Set them up the same way the scraper does."
        )
    creds = cm.get_credentials()

    browser, context, pw, page = await login_manager.login_and_get_context(
        creds.get("username"), creds.get("password")
    )

    try:
        await go_to_order_entry(page)

        # First-look inventory of the landing page (whole body).
        await list_form_fields(page, scope="body")

        if auto_dump:
            # Capture-only mode: you'd extend this to click through to the
            # customer-type modal etc., dumping at each step. Kept minimal here.
            print("\n[auto-dump] Landing captured. Exiting without pause.")
            return

        # Interactive mode: hand control to YOU via the Playwright Inspector.
        print(
            "\n"
            "============================================================\n"
            " Playwright Inspector is opening.\n"
            "  - Use 'Explore' / hover to pick elements & copy selectors.\n"
            "  - Step through the Order Entry flow manually in the window.\n"
            "  - Press the green ▶ (Resume) in the Inspector to end.\n"
            "\n"
            " To capture a step's DOM while paused, you can run from the\n"
            " Inspector's console, or just walk to the step then Resume and\n"
            " call the dump helpers from a follow-up script.\n"
            "============================================================\n"
        )
        await page.pause()

        # After you resume, grab a final snapshot of wherever you ended up.
        await dump_html(page, "99_final_state")
        await list_form_fields(page, scope=".ant-modal-body")

    finally:
        print("\nClosing browser...")
        await context.close()
        await browser.close()
        await pw.stop()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--auto-dump",
        action="store_true",
        help="Walk to Order Entry, dump landing DOM, exit (no Inspector pause).",
    )
    args = ap.parse_args()
    asyncio.run(main(args.auto_dump))

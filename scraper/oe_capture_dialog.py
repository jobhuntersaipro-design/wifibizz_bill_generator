"""
oe_capture_dialog.py - One-off capture for the "Multiple customer records found"
confirm dialog that blocks stage 1 (create_personal_customer).

Reuses the cached session (no OTP needed if the session is still valid), opens
the Personal Customer form, enters the duplicate test IC to trigger the dialog,
dumps the dialog's DOM from BOTH the iframe and the outer page (we don't yet know
which it lives in), screenshots it, clicks OK, then dumps the resulting screen so
we can map the OK branch.

Run from project root:  python3 scraper/oe_capture_dialog.py
(or from scraper/:       python3 oe_capture_dialog.py)
"""

import argparse
import asyncio
import json
import os

import login_manager
from credential_manager import CredentialManager
from oe_dry_run import _make_headed_launch
from oe_helpers import set_combobox

ORDER_ENTRY_PRIVCODE = "crm-TYMH100163"
DUMP_DIR = "logs"

# Serialize every visible dialog-like container in a document, with its buttons
# and visible text, so we learn the exact selectors + button labels.
_DIALOG_DUMP_JS = r"""(() => {
  function scan(doc, label) {
    if (!doc) return label + ': <no document>';
    const sel = '.ui-dialog, .modal, .bootbox, .swal2-popup, [class*="confirm"], [class*="dialog"], [role="dialog"], [role="alertdialog"]';
    const nodes = [...doc.querySelectorAll(sel)].filter(x => x.offsetParent !== null);
    if (!nodes.length) return label + ': <no visible dialog-like node>';
    const out = [label + ': ' + nodes.length + ' node(s)'];
    nodes.forEach((n, i) => {
      out.push('--- node ' + i + ' <' + n.tagName.toLowerCase() +
        (n.id ? '#' + n.id : '') +
        (n.className ? ' .' + String(n.className).trim().split(/\s+/).join('.') : '') + '>');
      const txt = (n.innerText || '').trim().replace(/\n+/g, ' | ');
      out.push('    text: ' + txt.slice(0, 300));
      const btns = [...n.querySelectorAll('button, a.btn, .btn, input[type="button"], [role="button"]')]
        .filter(b => b.offsetParent !== null);
      btns.forEach(b => {
        out.push('    button: <' + b.tagName.toLowerCase() +
          (b.id ? '#' + b.id : '') +
          (b.className ? ' .' + String(b.className).trim().split(/\s+/).join('.') : '') +
          '> "' + (b.innerText || b.value || '').trim() + '"');
      });
    });
    return out.join('\n');
  }
  const top = scan(document, 'OUTER PAGE');
  const frameEl = document.querySelector('#myIframe');
  const inner = frameEl && frameEl.contentDocument
    ? scan(frameEl.contentDocument, 'IFRAME #myIframe')
    : 'IFRAME #myIframe: <not accessible>';
  return top + '\n\n' + inner;
})()"""


async def _dump(page, label):
    os.makedirs(DUMP_DIR, exist_ok=True)
    try:
        outline = await page.evaluate(_DIALOG_DUMP_JS)
    except Exception as e:
        outline = f"<dump JS failed: {e}>"
    txt_path = os.path.join(DUMP_DIR, f"capture_{label}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(outline)
    try:
        await page.screenshot(path=os.path.join(DUMP_DIR, f"capture_{label}.png"), full_page=True)
    except Exception as e:
        print(f"  [dump] screenshot failed: {e}")
    print(f"\n===== {label} =====\n{outline}\n  -> {txt_path}")
    return outline


async def main(headless: bool = False, slow_mo: int = 150):
    if not headless:
        # Force a visible window (same approach as oe_dry_run.py).
        login_manager._launch_browser_safe = _make_headed_launch(slow_mo)

    # Load the duplicate IC from the fixture so we reproduce the exact dialog.
    with open("tests/fixtures/payload_residential.json", encoding="utf-8") as f:
        cust = json.load(f)["customer"]
    print(f"Using IC {cust['id_type']} / {cust['id_number']} (expected to be a duplicate)")

    creds = CredentialManager().get_credentials()
    browser, context, pw, page = await login_manager.login_and_get_context(
        creds["username"], creds["password"]
    )
    try:
        # Stage 0 — navigate to Order Entry via the outer Ant left-nav.
        await page.locator(f'li.ant-menu-item[privcode="{ORDER_ENTRY_PRIVCODE}"]').first.click()
        frame = page.frame_locator("#myIframe")

        # Open the Personal Customer creator (mirrors create_personal_customer).
        await frame.locator(".js-order-search").first.click()
        await frame.locator(".js-add-cust-btn").first.click()
        await frame.locator(".show-customer-left").first.wait_for(state="visible", timeout=15000)
        await frame.locator(".show-customer-left").first.click()

        # Enter ID type + number, then blur to trigger the duplicate lookup.
        await set_combobox(frame, "certTypeId", cust["id_type"])
        await frame.locator('input[name="certNbr"]').first.fill(cust["id_number"])
        await frame.locator('input[name="custName"]').first.click()  # blur certNbr
        await page.wait_for_timeout(3000)

        await _dump(page, "01_dialog_present")

        # Click OK on the confirm dialog — try outer page and iframe, by text.
        clicked = False
        for ctx in (page, frame):
            try:
                btn = ctx.get_by_role("button", name="OK", exact=True).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    clicked = True
                    print(f"  clicked OK on {'outer page' if ctx is page else 'iframe'}")
                    break
            except Exception as e:
                print(f"  OK-click attempt failed on {'page' if ctx is page else 'frame'}: {e}")
        if not clicked:
            print("  ⚠️ Could not find an OK button — see capture_01 dump for the real selector.")

        await page.wait_for_timeout(3000)
        await _dump(page, "02_after_ok")

        print("\nDone. Browser stays open 30s for manual inspection...")
        await page.wait_for_timeout(30000)
    finally:
        await browser.close()
        await pw.stop()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true", help="Run without a visible window.")
    ap.add_argument("--slow-mo", type=int, default=150, help="Headed slow-mo ms.")
    args = ap.parse_args()
    asyncio.run(main(args.headless, args.slow_mo))

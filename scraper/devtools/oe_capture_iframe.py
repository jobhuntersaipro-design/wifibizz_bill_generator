"""DEV diagnostic (read-only): navigate to Order Entry with a saved session and
report the true state of the inner CCEntryView iframe (#myIframe) — whether the
app rendered, or the portal served a blank / no-devtool / login / challenge page
to our automated browser (bot detection). Creates nothing.

Run from scraper/:
    python oe_capture_iframe.py <session.json>
"""
import asyncio
import json
import os
import sys
import time

import dealer_web_login
import login_manager
from order_entry import ORDER_ENTRY_URL, IFRAME_SELECTOR

# Runs inside the iframe document (same-origin) to see what actually rendered.
INSPECT_JS = r"""(() => {
  const f = document.querySelector('#myIframe');
  const out = { hasIframe: !!f, outerUrl: location.href };
  if (!f) return out;
  out.iframeSrc = f.getAttribute('src') || '';
  const r = f.getBoundingClientRect();
  out.iframeBox = { w: Math.round(r.width), h: Math.round(r.height) };
  try {
    const d = f.contentDocument;
    if (!d) { out.contentDoc = 'NULL (cross-origin or not loaded)'; return out; }
    out.innerUrl = d.location ? d.location.href : '(no location)';
    out.readyState = d.readyState;
    const body = d.body;
    out.bodyTextLen = body ? (body.innerText || '').trim().length : -1;
    out.bodyHtmlLen = body ? (body.innerHTML || '').length : -1;
    out.bodyTextHead = body ? (body.innerText || '').trim().slice(0, 300) : '';
    // Markers that tell us WHICH failure this is:
    out.hasSurveyBtn = !!d.querySelector('.js-anonymous-add-survey');
    out.hasLoginForm = !!d.querySelector('input#login-form_staffCode');
    out.mentionsDevtool = /no-devtool|devtool/i.test(d.documentElement.innerHTML);
    out.mentionsCaptcha = /captcha|verify|unusual|robot|blocked/i.test((body && body.innerText) || '');
  } catch (e) {
    out.contentDocErr = String(e);
  }
  return out;
})()"""


async def main(session_path):
    console_msgs = []
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL
        )
        page.on("console", lambda m: console_msgs.append(f"{m.type}: {m.text[:160]}"))
        page.on("pageerror", lambda e: console_msgs.append(f"pageerror: {str(e)[:160]}"))

        print(f"→ outer URL after nav: {page.url}")
        # Give the AJAX-heavy CCEntryView app time to render (or fail to).
        try:
            await page.wait_for_selector(IFRAME_SELECTOR, timeout=15000)
            print("  ✓ #myIframe element present")
        except Exception:
            print("  ✗ #myIframe element NEVER appeared")

        for wait_s in (5, 10, 20, 35):
            await asyncio.sleep(5)
            info = await page.evaluate(INSPECT_JS)
            rendered = info.get("hasSurveyBtn")
            print(f"  [t+{wait_s}s] readyState={info.get('readyState')} "
                  f"bodyTextLen={info.get('bodyTextLen')} survey={rendered} "
                  f"login={info.get('hasLoginForm')} innerUrl={info.get('innerUrl')}")
            if rendered:
                break

        info = await page.evaluate(INSPECT_JS)
        os.makedirs("logs", exist_ok=True)
        stamp = time.strftime("%H%M%S")
        shot = f"logs/iframe_diag_{stamp}.png"
        await page.screenshot(path=shot, full_page=True)
        dump = f"logs/iframe_diag_{stamp}.json"
        with open(dump, "w") as fh:
            json.dump({"info": info, "console": console_msgs[-40:]}, fh, indent=2)

        print("\n=== VERDICT ===")
        if info.get("hasSurveyBtn"):
            print("✅ iframe app RENDERED — the order UI is available to the bot.")
        elif info.get("hasLoginForm"):
            print("🔒 iframe shows a LOGIN form — session not valid in the iframe.")
        elif info.get("mentionsCaptcha"):
            print("🤖 iframe shows a CHALLENGE/captcha — IP/fingerprint bot-block.")
        elif info.get("mentionsDevtool"):
            print("🛡️ iframe hit anti-devtool (no-devtool) — fishx patch is stale.")
        elif (info.get("bodyTextLen") or 0) <= 0:
            print("⬜ iframe body is BLANK — app never rendered (detection or wedged JS).")
        else:
            print("❓ iframe has content but no survey anchor — see dump.")
        print(f"screenshot: {shot}\ndump: {dump}")
        print("console tail:")
        for m in console_msgs[-15:]:
            print("   ", m)
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    asyncio.run(main(sess))

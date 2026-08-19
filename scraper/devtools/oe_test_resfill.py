"""DEV debug (SAFE — no OK click, no customer): fill the Personal Customer form
WITH a real test address, then inspect which required fields ended up empty
(esp. the residence address). Pinpoints what makes the portal say 'data
incomplete'."""
import asyncio
import dealer_web_login
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, _frame, create_personal_customer
from order_to_payload import order_to_payload

TEST_ORDER = {
    "id": "test-resfill",
    "idType": "MyKad",
    "idNumber": "840229-14-5738",
    "fullName": "NOORIANA BINTI ABDUL RAZAK",
    "mobilePrefix": "60",
    "mobile": "176904402",
    "email": "nooriana5738@gmail.com",
    "street": "G-217 JALAN PJU 10/3C",
    "postcode": "47830",
    "city": "PETALING JAYA",
    "state": "SELANGOR",
    "offerName": "Unifi Home 1Gbps Premium Value With Device (36M)",
    "offerCategory": "unifi Home Bundle Sale Catg",
}

# Required fields to inspect (name -> label).
FIELDS = {
    "custName": "Customer Name", "certNbr": "ID Number", "gender": "Gender",
    "birthdayDay": "Birthday", "name_400011": "Race", "name_400020": "Nationality",
    "custDefLangId": "Preferred Language", "address": "Residence Address",
    "name_400054": "Customer Tenure", "name_410013": "Sub-Segment",
    "name_410011": "Segment", "name_410008": "Segment Code",
}

INSPECT_JS = r"""((names) => {
  const f = document.querySelector('#myIframe');
  if (!f || !f.contentDocument) return {err:'no iframe'};
  const d = f.contentDocument;
  const out = {};
  for (const n of names) {
    const els = [...d.querySelectorAll('input[name="'+n+'"]')];
    // Prefer the one in the customer form (js-cust-form) or the residence js-address.
    let el = els.find(e => e.closest('form.js-cust-form')) || els[0];
    if (n === 'address') el = d.querySelector('input[name="address"].js-address') || el;
    out[n] = el ? (el.value || '').trim() : '(field not found)';
  }
  return out;
})"""


async def main(session_path):
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)
        payload = order_to_payload(TEST_ORDER)
        print("→ filling Personal Customer form (fill_only, WITH address)…")
        result = await create_personal_customer(frame, payload["customer"], fill_only=True)
        print("  fill result:", result)
        await asyncio.sleep(1)
        vals = await page.evaluate(INSPECT_JS, list(FIELDS.keys()))
        print("\n=== required field values after fill ===")
        empty = []
        for n, label in FIELDS.items():
            v = vals.get(n, "?")
            flag = "  ❌ EMPTY" if (not v or v == "(field not found)") else ""
            print(f"  {label:20s} [{n}]: {v!r}{flag}")
            if flag:
                empty.append(label)
        import time, os
        os.makedirs("logs", exist_ok=True)
        shot = f"logs/resfill_{time.strftime('%H%M%S')}.png"
        await page.screenshot(path=shot, full_page=True)
        print(f"\nscreenshot: {shot}")
        print("EMPTY required fields:", empty or "none — all filled ✓")
    finally:
        for c in ((context.close if context else None), (browser.close if browser else None), (pw.stop if pw else None)):
            if c:
                try: await c()
                except Exception: pass


if __name__ == "__main__":
    asyncio.run(main("sessions/dealer_cmno32fci000004jn760fh8fl.json"))

"""Read-only probe: what does the portal expose BEFORE an order is minted?

Answers one question — can the per-package device list (the Offer dialog's
starred groups) be read without clicking Order? If it can, the catalogue can be
pre-scraped for free. If it can't, every package's device list costs one real
order, which is a decision for a human.

SAFE BY CONSTRUCTION: this never clicks Order (.js-orderNow). It opens
Feasibility Check, searches the address, and dumps what the page offers.

    python3 probe_offer_catalog.py <user_key>
"""
import asyncio
import json
import os
import sys

import dealer_web_login
import dealer_login_service
from oe_feasibility import (
    ORDER_ENTRY_URL, _frame, ensure_on_order_entry,
    open_feasibility, select_address,
)

ADDRESS = {
    "state": "JOHOR",
    "keywords": "C-5-E3 JALAN PERMAS SELATAN",
    "address_full": (
        "C-5-E3 JALAN PERMAS SELATAN - BLOK C STRAITS VIEW CONDOMINIUM "
        "BANDAR BARU PERMAS JAYA MASAI JOHOR MALAYSIA 81750"
    ),
}


async def main(user_key: str):
    session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
    pw = browser = context = page = None
    try:
        pw, browser, context, page = await dealer_web_login.open_context_from_session(
            session_path, landing_url=ORDER_ENTRY_URL)
        await ensure_on_order_entry(page)
        frame = _frame(page)

        print("→ opening Feasibility Check")
        r = await open_feasibility(frame)
        print("  ", r)
        await asyncio.sleep(2)

        print("→ selecting address")
        r = await select_address(frame, ADDRESS)
        print("  ", r)
        if r.get("status") != "ok":
            return

        await asyncio.sleep(2)
        # Everything the plan grid knows about the serviceable offers, including
        # every column — if a device/offer-group hint exists pre-order, it is here.
        data = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return null;
          const grid=d.querySelector('.js-offer-grid'); if(!grid) return {grid:false};
          const headers=[...grid.querySelectorAll('th')].map(t=>(t.innerText||'').trim()).filter(Boolean);
          const rows=[...grid.querySelectorAll('tr.jqgrow')].map(r => ({
            titles:[...r.querySelectorAll('td[title]')].map(t=>t.getAttribute('title')).filter(Boolean),
            text:(r.innerText||'').replace(/\s+/g,' ').trim().slice(0,220),
            expandable: !!r.querySelector('.ui-icon-plus, .tree-plus, .glyphicon-triangle-right, a[onclick*="expand"]'),
          }));
          return {grid:true, headers, count:rows.length, rows};
        })()""")
        os.makedirs("outputs", exist_ok=True)
        with open("outputs/probe_offer_grid.json", "w") as fh:
            json.dump(data, fh, indent=2)

        if not data or not data.get("grid"):
            print("!! no .js-offer-grid on screen")
            return
        print(f"\n=== Serviceable offers at this address: {data['count']} ===")
        print("columns:", data["headers"])
        for row in data["rows"]:
            print(f"  · {row['titles'][:2]}  expandable={row['expandable']}")
            print(f"      {row['text'][:150]}")

        # Does anything on the page mention the offer GROUPS we need?
        hints = await page.evaluate(r"""(() => {
          const f=document.querySelector('#myIframe'), d=f&&f.contentDocument; if(!d) return [];
          const rx=/\[\s*Pick\s+\d+\s*-\s*[\dN]+\s*\]/i;
          return [...d.querySelectorAll('*')]
            .filter(e=>e.children.length===0 && rx.test(e.textContent||''))
            .map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).slice(0,20);
        })()""")
        print("\n=== '[Pick n-m]' offer-group text found pre-order:",
              len(hints), "===")
        for h in hints:
            print("  *", h)
        if not hints:
            print("  (none — the offer groups are NOT reachable before Order)")
    finally:
        await dealer_web_login.safe_teardown(pw, browser, context)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))

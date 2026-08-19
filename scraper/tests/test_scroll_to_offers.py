"""Exercise SCROLL_TO_OFFERS_JS against a fixture of the portal's Broadband tab.

Why this exists: the scroll behaviour was previously observable ONLY by running a
real submit against the live Unifi portal, so every wrong guess cost a genuine
order attempt. Two bugs got through that way — an exact-text anchor the portal's
markup never satisfies, and a match on a hidden node whose zero rect reads as
"already in view". Both are reproduced in the fixture, so they can never regress
silently again.

Run:  scraper/venv/bin/python tests/test_scroll_to_offers.py
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from oe_feasibility import (  # noqa: E402
    ORDER_INFO_SECTIONS,
    SCROLLER_POSITION_JS,
    SCROLL_TO_HEADING_JS,
)

# Diagnostic screenshots land here rather than beside the fixtures — they are
# evidence for a human reading a failure, not source. Gitignored (blanket *.png).
SHOTS = pathlib.Path(__file__).parent / "_artifacts"
SHOTS.mkdir(exist_ok=True)

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "fixture_broadband_tab.html"
ORDER_INFO_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "fixture_order_info_page.html"

# The real capture is a shot of the iframe's <body>, so the fixture is loaded
# into an #myIframe exactly as the portal does — the JS walks that boundary.
#
# srcdoc, not src: a file:// iframe inside the host page is a separate origin,
# so `contentDocument` comes back null and the JS can't see in at all. A srcdoc
# frame inherits the parent's origin, which is the same access the real portal
# gives us.
HOST = """<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>
<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>"""


def host_page(fixture: pathlib.Path = FIXTURE) -> str:
    html = fixture.read_text()
    return HOST.replace("FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;"))

failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1192, "height": 716})
        await page.set_content(host_page())
        await page.wait_for_function(
            "() => { const f=document.querySelector('#myIframe');"
            " return f && f.contentDocument && f.contentDocument.querySelector"
            "('.layout-right-wrapper'); }")

        geom = await page.evaluate(SCROLL_TO_HEADING_JS, r"select\s*offer")
        print(f"\ngeometry: {geom}\n")

        check("found the scroller", bool(geom), repr(geom))
        if not geom:
            await browser.close()
            return 1

        check("picked the portal's own wrapper",
              geom["cls"] == "layout-right-wrapper", geom["cls"])
        check("anchored on Select Offer rather than falling back to the end",
              geom["how"] == "anchor", f"how={geom['how']}")
        check("anchor text is the heading, not a wrapper",
              "select offer" in (geom["anchor"] or "").lower()
              and len(geom["anchor"]) <= 60,
              repr(geom["anchor"]))
        check("actually scrolled down", geom["scrolled"] > 40,
              f"{geom['scrolled']}px")

        # The point of the whole exercise: after the scroll, are BOTH sections
        # inside the visible box? Measured against the scroller's own viewport,
        # which is what the screenshot records.
        vis = await page.evaluate("""(() => {
          const d = document.querySelector('#myIframe').contentDocument;
          const t = d.querySelector('.layout-right-wrapper');
          const tr = t.getBoundingClientRect();
          const seen = id => {
            const r = d.querySelector(id).getBoundingClientRect();
            return {top: Math.round(r.top - tr.top),
                    bottom: Math.round(r.bottom - tr.top),
                    fully: r.top >= tr.top - 1 && r.bottom <= tr.bottom + 1,
                    partly: r.bottom > tr.top && r.top < tr.bottom};
          };
          return {box: Math.round(tr.height),
                  offer: seen('#select-offer'),
                  info: seen('#order-information')};
        })()""")
        print(f"visibility: {vis}\n")

        check("Select Offer is fully in frame", vis["offer"]["fully"],
              f"top={vis['offer']['top']} bottom={vis['offer']['bottom']} box={vis['box']}")
        check("Order Information is in frame", vis["info"]["partly"],
              f"top={vis['info']['top']} bottom={vis['info']['bottom']}")

        await page.screenshot(path=str(SHOTS / "scroll_result.png"))

        # ── The post-Next page: every section must be reachable ──────────────
        print("\nCustomer Order Information page:")
        await page.set_content(host_page(ORDER_INFO_FIXTURE))
        await page.wait_for_function(
            "() => { const f=document.querySelector('#myIframe');"
            " return f && f.contentDocument && f.contentDocument.querySelector"
            "('#order-item-list'); }")

        want = {"install_info": "#install-information",
                "device_list": "#device-list",
                "fee_preview": "#fee-information-preview",
                "order_items": "#order-item-list"}

        # capture_sections() runs with the page wherever the previous step left
        # it, so the loop is reproduced faithfully: park at the BOTTOM first,
        # which is the position that used to make every section silently skip.
        await page.evaluate(SCROLLER_POSITION_JS, 99999)
        origin = await page.evaluate(SCROLLER_POSITION_JS, None)
        check("starting parked at the bottom", origin > 0, f"scrollTop={origin}")

        for pattern, slot in ORDER_INFO_SECTIONS:
            await page.evaluate(SCROLLER_POSITION_JS, 0)  # what capture_sections does
            g = await page.evaluate(SCROLL_TO_HEADING_JS, pattern)
            anchored = bool(g) and g.get("how") == "anchor"
            check(f"{slot}: anchored", anchored,
                  f"how={(g or {}).get('how')} anchor={(g or {}).get('anchor')!r}")
            if not anchored:
                continue
            # The section itself must be in frame — not merely some element whose
            # text matched. The live page repeats every heading in a right-hand
            # nav placed ABOVE the sections, so matching the nav entry would
            # "succeed" while photographing the wrong part of the page.
            seen = await page.evaluate("""(sel) => {
              const d = document.querySelector('#myIframe').contentDocument;
              const t = d.querySelector('.layout-right-wrapper');
              const tr = t.getBoundingClientRect(), r = d.querySelector(sel).getBoundingClientRect();
              return {top: Math.round(r.top - tr.top),
                      visible: r.bottom > tr.top + 4 && r.top < tr.bottom - 4};
            }""", want[slot])
            check(f"{slot}: section is in frame", seen["visible"],
                  f"top={seen['top']}")
            await page.screenshot(path=str(SHOTS / f"scroll_{slot}.png"))

        # The steps after the captures were written against the page where they
        # left it. Moving it underneath them would make evidence-gathering the
        # cause of a failure, which is the one thing capture must never be.
        await page.evaluate(SCROLLER_POSITION_JS, origin)
        back = await page.evaluate(SCROLLER_POSITION_JS, None)
        check("scroll position is restored afterwards", back == origin,
              f"{back} vs {origin}")

        await browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILED: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

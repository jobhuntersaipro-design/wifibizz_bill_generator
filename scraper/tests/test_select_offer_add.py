"""Select Offer Add must never click the filled Agreement trash.

Live report (ClickUp z8v9xnfpch): on New Connection with Agreement already
populated ("unifi Home" + trash), the scraper opened Select Agreement and the
order failed. The finder walked ≤6 ancestors matching /select\\s*offer/i on
innerText. Agreement sits above Select Offer in one scroller, so a shared
parent's text contains "Select Offer" and the first .js-add (Agreement trash)
won. Select Offer Add is often span.add without js-add, so it was not even a
candidate.

The fixture reproduces that layout. The assertion is the click target the
finder fires — Agreement trash must stay untouched.

Run from the scraper/ dir:
    python tests/test_select_offer_add.py
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from oe_feasibility import SELECT_OFFER_ADD_CLICK_JS  # noqa: E402

SHOTS = pathlib.Path(__file__).parent / "_artifacts"
SHOTS.mkdir(exist_ok=True)

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "fixture_agreement_trash.html"

HOST = """<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>
<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>"""


def host_page() -> str:
    html = FIXTURE.read_text()
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
            " return f && f.contentDocument &&"
            " f.contentDocument.getElementById('agreement-trash'); }")

        opened = await page.evaluate(SELECT_OFFER_ADD_CLICK_JS)
        clicked = await page.evaluate(
            "() => document.querySelector('#myIframe').contentWindow.__clicked")
        print(f"\nopened={opened!r}  clicked={clicked!r}\n")

        check("finder reported ok", opened == "ok", repr(opened))
        check("clicked Select Offer Add", clicked == "select-offer-add",
              f"clicked={clicked!r}")
        check("did not click Agreement trash", clicked != "agreement-trash",
              f"clicked={clicked!r}")
        check("did not click Order Comments Add", clicked != "order-comments-add",
              f"clicked={clicked!r}")

        await page.screenshot(path=str(SHOTS / "select_offer_add_result.png"))
        await browser.close()

    if failures:
        print(f"\n{len(failures)} failed: {failures}")
        return 1
    print("\nall passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

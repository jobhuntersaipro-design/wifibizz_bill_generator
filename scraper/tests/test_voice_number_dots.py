"""Voice Service Number 3-dots must not open Select Agreement.

Live ORD-0135 attempt 8 (2026-09-11): `_open_voice_number_picker` clicked the
LAST visible `span.icon-option-horizontal` on the page. Voice Agreement sits
below Service Number with the same icon class, so that click opened Select
Agreement. Query then hit that modal's Query button and the run failed as
"number cards did not load after Query" with Select Agreement still visible.

Run from the scraper/ dir:
    python tests/test_voice_number_dots.py
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from oe_feasibility import OPEN_VOICE_NUMBER_DOTS_JS  # noqa: E402

FIXTURE = """
<style>
  .row { display:flex; align-items:center; gap:8px; margin:12px 0; }
  .icon-option-horizontal { cursor:pointer; padding:4px 8px; border:1px solid #ccc; }
  .icon-option-horizontal::before { content:"⋯"; }
  .glyphicon-trash::before { content:"🗑"; }
</style>
<section id="voice-tab">
  <div class="row" id="svc-row">
    <label>*Service Number</label>
    <input name="svcNbr" value="">
    <span id="voice-dots" class="icon-option-horizontal"
          onclick="window.__clicked='voice-dots'"></span>
  </div>
  <div class="row" id="agreement-row">
    <label>*Agreement</label>
    <input value="Residential Voice Basic" readonly>
    <span id="agreement-dots" class="icon-option-horizontal"
          onclick="window.__clicked='agreement-dots'"></span>
    <span id="agreement-trash" class="input-group-addon js-add" title="Remove"
          onclick="window.__clicked='agreement-trash'">
      <i class="glyphicon glyphicon-trash"></i>
    </span>
  </div>
</section>
"""

HOST = """<!doctype html><meta charset="utf-8">
<iframe id="myIframe" srcdoc="FIXTURE_HTML" style="width:900px;height:400px;border:0"></iframe>"""

failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_content(
            HOST.replace("FIXTURE_HTML", FIXTURE.replace("&", "&amp;").replace('"', "&quot;")))
        await page.wait_for_function(
            "() => document.querySelector('#myIframe')?.contentDocument"
            "?.getElementById('agreement-dots')")

        opened = await page.evaluate(OPEN_VOICE_NUMBER_DOTS_JS)
        clicked = await page.evaluate(
            "() => document.querySelector('#myIframe').contentWindow.__clicked")
        print(f"\nopened={opened!r}  clicked={clicked!r}\n")

        check("finder reported ok", opened == "ok", repr(opened))
        check("clicked Voice Service Number dots", clicked == "voice-dots",
              f"clicked={clicked!r}")
        check("did not click Agreement dots", clicked != "agreement-dots",
              f"clicked={clicked!r}")
        check("did not click Agreement trash", clicked != "agreement-trash",
              f"clicked={clicked!r}")

        await browser.close()

    if failures:
        print(f"\n{len(failures)} failed: {failures}")
        return 1
    print("\nall passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

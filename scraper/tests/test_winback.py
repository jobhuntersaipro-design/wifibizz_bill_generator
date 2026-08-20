"""Winback Tagging must be proven set, not assumed.

ORD-0010 attempt 7 (order 2608000121821144, 2026-08-20) reported
"winback option 'HSBA Wireless Access' not found (TimeoutError)" for a field
whose dropdown offers exactly that one option. The old code called .click() on
the caret and returned 'opened' whether or not a menu appeared, so a click that
did not land was indistinguishable from a missing option. The run then walked on
and was refused at Next with the portal's "Some errors exists in order item(s)",
whose real cause — a mandatory field still reading "---Please select---" — was
visible only in the failure screenshot.

These run against real markup in a browser: the JS is the part that was wrong,
so a mock of it would prove nothing.

Run from the scraper/ dir:
    pytest tests/test_winback.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    _WINBACK_OPEN_JS,
    _WINBACK_OPTIONS_JS,
    _WINBACK_VALUE_JS,
    pick_winback_option,
)

# The portal's shape: label -> .form-group -> combobox display + caret, and a
# dropdown that exists in the DOM but is only shown when the caret is clicked.
# That last part is the whole point — it is what the old code failed to wait for.
FIELD = """
<div class="form-group">
  <label title="Winback Tagging">*Winback Tagging</label>
  <div class="input-group ui-combobox-fish">
    <input role="combobox" value="" placeholder="---Please select---">
    <span class="input-group-addon">v</span>
  </div>
  <ul class="combobox-dropdown" style="display:none">
    <li title="HSBA Wireless Access">HSBA Wireless Access</li>
  </ul>
</div>
<script>
  const grp = document.querySelector('.form-group');
  const menu = grp.querySelector('ul.combobox-dropdown');
  grp.querySelector('.input-group-addon').addEventListener('click', () => {
    menu.style.display = 'block';
  });
  menu.addEventListener('click', (e) => {
    if (e.target.tagName !== 'LI') return;
    grp.querySelector('input[role=combobox]').value = e.target.getAttribute('title');
    menu.style.display = 'none';
  });
</script>
"""

# An offer without the field at all (Unifi Home 100Mbps PrimePromo, Business
# offers). This must stay "not applicable" and never block an order.
NO_FIELD = """
<div class="form-group">
  <label title="Product Type">Product Type</label>
  <input role="combobox" value="Fixed">
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:500px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _run(fixture_html, probe):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 fixture_html.replace("&", "&amp;").replace('"', "&quot;")))
                return await probe(page)
            finally:
                await browser.close()
    return asyncio.run(go())


def test_open_reports_clicked_and_the_menu_really_appears():
    async def probe(page):
        opened = await page.evaluate(_WINBACK_OPEN_JS)
        menu = page.frame_locator("#myIframe").locator("ul.combobox-dropdown:visible")
        return opened, await menu.count()
    opened, visible = _run(FIELD, probe)
    assert opened == "clicked"
    assert visible == 1


def test_options_are_read_from_the_open_menu():
    async def probe(page):
        await page.evaluate(_WINBACK_OPEN_JS)
        return await page.evaluate(_WINBACK_OPTIONS_JS)
    assert _run(FIELD, probe) == ["HSBA Wireless Access"]


def test_options_are_empty_while_the_menu_is_shut():
    # The state the old code mistook for "option not found": nothing is offered
    # because nothing is open yet.
    async def probe(page):
        return await page.evaluate(_WINBACK_OPTIONS_JS)
    assert _run(FIELD, probe) == []


def test_value_js_reads_back_what_was_chosen():
    async def probe(page):
        await page.evaluate(_WINBACK_OPEN_JS)
        frame = page.frame_locator("#myIframe")
        await frame.locator('li[title="HSBA Wireless Access"]').first.click()
        return await page.evaluate(_WINBACK_VALUE_JS)
    assert _run(FIELD, probe) == "HSBA Wireless Access"


def test_value_js_reads_empty_before_any_choice():
    async def probe(page):
        return await page.evaluate(_WINBACK_VALUE_JS)
    assert _run(FIELD, probe) == ""


def test_absent_field_is_reported_as_nolabel():
    async def probe(page):
        return await page.evaluate(_WINBACK_OPEN_JS)
    assert _run(NO_FIELD, probe) == "nolabel"


# ── option matching ─────────────────────────────────────────────────────────

def test_picks_the_exact_option():
    assert pick_winback_option(["HSBA Wireless Access"], "HSBA Wireless Access") \
        == "HSBA Wireless Access"


def test_picks_case_and_space_insensitively():
    # The portal's own spelling wins — we return ITS string, not ours.
    assert pick_winback_option([" hsba wireless access "], "HSBA Wireless Access") \
        == " hsba wireless access "


def test_never_guesses_when_the_wanted_option_is_absent():
    # Winback Tagging classifies whether the customer is won back from another
    # operator. A first-option fallback would put a wrong classification on a
    # real order, so no match must mean no match.
    assert pick_winback_option(["Winback", "New Customer"], "HSBA Wireless Access") is None
    assert pick_winback_option([], "HSBA Wireless Access") is None
    assert pick_winback_option(None, "HSBA Wireless Access") is None

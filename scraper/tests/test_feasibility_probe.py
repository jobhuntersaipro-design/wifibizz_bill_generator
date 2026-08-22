"""test_feasibility_probe.py — reading the Subscription Plan List without buying anything.

The probe answers one question: does the portal list any offer at this address?
It exists because "the address exists" and "TM sells here" are different facts —
the BSP 21 building is findable by address search and answers "only offers
services from other operators", and every draft written against it dies at
select_plan.

The trap being pinned here is the empty grid. The grid ELEMENT appears before
its rows do (the portal fills them by a separate AJAX call after the address
OK), so reading too early makes a slow query indistinguishable from an
unserviceable address. `read_offers` must wait, and must return [] only when the
rows genuinely never arrive.

Run from the scraper/ dir:
    pytest tests/test_feasibility_probe.py
"""

import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oe_feasibility  # noqa: E402
from dealer_feasibility_probe import NO_OFFERS_MESSAGE, read_offers  # noqa: E402

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1192px;height:716px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _grid(rows: str) -> str:
    return f'<div class="js-offer-grid"><table><tbody>{rows}</tbody></table></div>'


# A serviceable address. Each row leads with the portal's 24-char internal id in
# its own title cell — the reason the reader takes the LONGEST title per row and
# not the first (taking the first reported 32-char hashes as offer names).
SERVICEABLE = _grid("""
<tr class="jqgrow">
  <td title="a1b2c3d4e5f6a7b8c9d0e1f2">id</td>
  <td title="Unifi Home 500Mbps Premium Value With Device (36M)">offer</td>
</tr>
<tr class="jqgrow">
  <td title="b1b2c3d4e5f6a7b8c9d0e1f2">id</td>
  <td title="Unifi Home 100Mbps Premium Value (36M)">offer</td>
</tr>
""")

# BSP 21: the grid renders, the rows never come.
UNSERVICEABLE = _grid("")

# The rows arrive late, as they really do after the address OK. The delay is
# comfortably longer than this test's own browser setup — a fixture that has
# already fired by the time the reader runs proves nothing about waiting.
LATE = _grid("") + """
<script>
setTimeout(() => {
  document.querySelector('.js-offer-grid tbody').innerHTML =
    '<tr class="jqgrow"><td title="c1b2c3d4e5f6a7b8c9d0e1f2">id</td>' +
    '<td title="Unifi Home 300Mbps Premium Value (24M)">offer</td></tr>';
}, 2500);
</script>"""


def _offers(inner: str) -> list:
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 inner.replace("&", "&amp;").replace('"', "&quot;")))
                frame = page.frames[1]
                return await read_offers(page, frame)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def test_a_serviceable_address_reports_every_offer():
    offers = _offers(SERVICEABLE)
    assert offers == [
        "Unifi Home 500Mbps Premium Value With Device (36M)",
        "Unifi Home 100Mbps Premium Value (36M)",
    ]


def test_the_internal_id_is_never_reported_as_an_offer():
    # A seeded draft takes its package from this list verbatim. A 24-char hash
    # landing in it would be written into Order.offerName and only surface as a
    # failed submit much later.
    assert all(len(o) > 24 and " " in o for o in _offers(SERVICEABLE))


def test_an_empty_grid_reports_no_offers():
    assert _offers(UNSERVICEABLE) == []


def test_an_empty_grid_is_decided_by_the_row_wait_not_the_grid_wait():
    # A row-less grid has zero height and so is never "visible". Waiting on the
    # GRID's visibility therefore burns its own 20s timeout on every
    # unserviceable address and reports the stall against the wrong step. With
    # the row timeout shrunk, an empty grid must come back promptly.
    original = oe_feasibility.OFFER_ROWS_TIMEOUT_MS
    oe_feasibility.OFFER_ROWS_TIMEOUT_MS = 100
    try:
        started = time.time()
        assert _offers(UNSERVICEABLE) == []
        assert time.time() - started < 10
    finally:
        oe_feasibility.OFFER_ROWS_TIMEOUT_MS = original


def test_rows_that_arrive_late_are_still_read():
    # Without the row-level wait this returns [] and a perfectly serviceable
    # address gets skipped as if it were BSP 21.
    assert _offers(LATE) == ["Unifi Home 300Mbps Premium Value (24M)"]


def test_a_slow_grid_is_not_called_unserviceable_before_the_timeout():
    # The row wait must be the thing that decides, not luck. Shrink the timeout
    # below the fixture's own delay and the same page must now read as empty —
    # proving the wait is what the earlier result depended on.
    original = oe_feasibility.OFFER_ROWS_TIMEOUT_MS
    oe_feasibility.OFFER_ROWS_TIMEOUT_MS = 100
    try:
        assert _offers(LATE) == []
    finally:
        oe_feasibility.OFFER_ROWS_TIMEOUT_MS = original


def test_the_unserviceable_wording_matches_the_real_run():
    # The probe and select_plan must describe the same address the same way.
    # Two wordings for one fact is how a seeding report and the Orders table end
    # up disagreeing about whether an address is usable — so this pins the
    # probe's sentence to the one select_plan actually emits.
    # Source-level containment, with whitespace and the string-literal quotes
    # removed — select_plan writes the same sentence across concatenated
    # literals, so a plain substring search would miss a message that matches.
    def flat(t: str) -> str:
        return "".join(t.split()).replace('"', "")

    assert flat(NO_OFFERS_MESSAGE) in flat(open(oe_feasibility.__file__).read())

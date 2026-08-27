"""Rebooking after 40301147 edits the EXISTING appointment row — it does not Add.

Live 2026-08-27, ORD-0017 attempt 3 (order 2608000122671192): the pay-tail
Next was blocked with "Slot has been taken", the rebook clicked "+ Add", and
the portal refused it with "You have an appointment already." — the order still
holds the first booking. The user's answer on how it is done by hand: open the
existing row's control under the Appointment table's Operation column, which
re-opens the calendar for that appointment.

The row's markup is not live-proven. _OPEN_APPOINTMENT_EDIT_JS therefore finds
the table by its "Appointment No." header (jqGrid keeps header and body in
separate tables), takes the first data row, and clicks the first control in its
last cell that is not a delete — and returns that control's outerHTML so the
run log shows exactly what was pressed. No data row -> 'norow', and the caller
falls back to "+ Add".

Run from the scraper/ dir:
    pytest tests/test_appointment_edit.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import _OPEN_APPOINTMENT_EDIT_JS  # noqa: E402

# jqGrid shape: a header table and a body table, the row's Operation cell
# holding a delete and an edit control (delete first, to prove it is skipped).
BOOKED = """
<div class="ui-jqgrid">
  <table class="ui-jqgrid-htable"><thead><tr>
    <th>Appointment No.</th><th>Appointment Date</th><th>Start Date</th><th>End Date</th><th>Operation</th>
  </tr></thead></table>
  <table class="ui-jqgrid-btable"><tbody>
    <tr class="jqgfirstrow"><td></td></tr>
    <tr class="jqgrow" id="1">
      <td>AP2608000001</td><td>2026-08-28</td><td>09:30:00</td><td>12:00:00</td>
      <td>
        <a class="js-del-date" title="Delete" onclick="window.pressed='delete'"><i class="icon-delete"></i></a>
        <a class="js-edit-date" title="Edit" onclick="window.pressed='edit'"><i class="icon-edit"></i></a>
      </td>
    </tr>
  </tbody></table>
</div>
<a class="js-add-date" onclick="window.pressed='add'">+ Add</a>
"""

EMPTY = """
<div class="ui-jqgrid">
  <table class="ui-jqgrid-htable"><thead><tr>
    <th>Appointment No.</th><th>Appointment Date</th><th>Start Date</th><th>End Date</th><th>Operation</th>
  </tr></thead></table>
  <table class="ui-jqgrid-btable"><tbody>
    <tr class="jqgfirstrow"><td></td></tr>
    <tr><td colspan="5">No record to view</td></tr>
  </tbody></table>
</div>
<a class="js-add-date" onclick="window.pressed='add'">+ Add</a>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1000px;height:600px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _run(fixture_html):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", fixture_html.replace("&", "&amp;").replace('"', "&quot;")))
                await page.wait_for_function(
                    "() => { const f=document.querySelector('#myIframe');"
                    " return f && f.contentDocument && f.contentDocument.body; }")
                res = await page.evaluate(_OPEN_APPOINTMENT_EDIT_JS)
                pressed = await page.evaluate(
                    "() => document.querySelector('#myIframe').contentDocument.defaultView.pressed || null")
                return res, pressed
            finally:
                await browser.close()
    return asyncio.run(go())


def test_booked_row_is_edited_not_deleted_and_not_added():
    res, pressed = _run(BOOKED)
    assert res["status"] == "ok"
    assert pressed == "edit"
    assert "js-edit-date" in res["ctl"]      # the log shows what was pressed
    assert res["row"].startswith("AP2608000001")


def test_empty_table_reports_norow_so_the_caller_adds():
    res, pressed = _run(EMPTY)
    assert res["status"] == "norow"
    assert pressed is None

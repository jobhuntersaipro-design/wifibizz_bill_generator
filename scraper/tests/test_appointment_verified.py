"""An appointment is booked only when the portal has a row for it.

Live 2026-08-28, ORD-0043 attempt 2 (order 2608000122824032): the appointment
step clicked a slot, pressed OK, saw the Appointment dialog close, and reported
`ok` with that slot. No appointment row was ever created — the failure frame
shows the Appointment table reading "No record to view" — so the run walked on
through delivery_terms to the pay tail, where the portal refused the Next with

    "Please input the appointment date."

a sentence naming neither the step that failed nor why. The order stranded with
a real portal order number and no appointment.

Two things were wrong and both are pinned here:

  _read_appointment_row()   - the step now READS THE ROW BACK instead of taking
                              "the dialog closed" as proof of a booking. Same
                              defect create_billing_account had, same fix.
  is_missing_appointment()  - the pay tail can now recognise "no appointment on
                              this order" and rebook. It previously only knew
                              the [40301147] slot race, and this incident
                              carried neither that code nor any dialog at all
                              ("dialogs": []), so the rebook never ran.

That the slot itself was fine is not a guess: ORD-0045 booked the SAME slot
(2026-08-29 13:30-16:00) eight minutes later and submitted successfully.

Run from the scraper/ dir:
    pytest tests/test_appointment_verified.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_errors import (  # noqa: E402
    APPOINTMENT_NOT_BOOKED,
    APPOINTMENT_SLOT_TAKEN,
    is_missing_appointment,
    is_slot_taken,
)
from oe_feasibility import _APPOINTMENT_ROW_JS, _TAG_APPT_DIALOG_JS  # noqa: E402

# The portal's own empty state, as the failure frame showed it.
EMPTY_TABLE = """
<div class="ui-jqgrid">
  <table class="ui-jqgrid-htable"><thead><tr>
    <th>Appointment No.</th><th>Appointment Date</th><th>Start Date</th><th>End Date</th><th>Operation</th>
  </tr></thead></table>
  <table class="ui-jqgrid-btable"><tbody>
    <tr class="jqgfirstrow"><td></td></tr>
    <tr><td colspan="5">No record to view</td></tr>
  </tbody></table>
</div>
"""

# The same table once a booking really landed.
BOOKED_TABLE = """
<div class="ui-jqgrid">
  <table class="ui-jqgrid-htable"><thead><tr>
    <th>Appointment No.</th><th>Appointment Date</th><th>Start Date</th><th>End Date</th><th>Operation</th>
  </tr></thead></table>
  <table class="ui-jqgrid-btable"><tbody>
    <tr class="jqgfirstrow"><td></td></tr>
    <tr class="jqgrow" id="1">
      <td>AP2608000042</td><td>2026-08-29</td><td>13:30:00</td><td>16:00:00</td>
      <td><a class="js-edit-date">Edit</a></td>
    </tr>
  </tbody></table>
</div>
"""

# An offer with no appointment section at all — must not be read as "empty".
NO_SECTION = "<div><h3>Device List</h3><p>nothing to do with appointments</p></div>"

# The Appointment dialog, plus a popup stacked OVER it carrying its own OK.
# `.last` across every visible dialog is what pressed the wrong control in the
# Voice picker on 2026-08-27; the tag must pick the calendar, not the popup.
STACKED_DIALOGS = """
<div class="ui-dialog" id="appt">
  <div class="ui-dialog-title">Appointment</div>
  <input name="firstPreferredDatetime" value="2026-08-29 13:30:00"/>
  <button class="js-ok" onclick="window.pressed='appointment-ok'">OK</button>
  <button onclick="window.pressed='appointment-cancel'">Cancel</button>
</div>
<div class="ui-dialog" id="popup">
  <div class="ui-dialog-title">Success</div>
  <div class="modal-message">Succeed in uploading attachment</div>
  <button class="js-ok" onclick="window.pressed='popup-ok'">OK</button>
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1000px;height:600px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _eval(fixture_html, js, then=None):
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
                res = await page.evaluate(js)
                extra = await page.evaluate(then) if then else None
                return res, extra
            finally:
                await browser.close()
    return asyncio.run(go())


# ── The read-back: the fix for the live incident ────────────────────────────

def test_empty_table_is_reported_as_not_booked():
    # THE live bug. Before the fix this state was invisible and the step
    # returned ok; the portal was the first thing to notice, four steps later.
    res, _ = _eval(EMPTY_TABLE, _APPOINTMENT_ROW_JS)
    assert res["status"] == "norow"


def test_a_real_row_is_reported_with_what_it_says():
    res, _ = _eval(BOOKED_TABLE, _APPOINTMENT_ROW_JS)
    assert res["status"] == "ok"
    assert res["rows"] == 1
    # The row text goes into the run log and the step's result, so the timeline
    # shows the appointment the portal actually recorded rather than the slot we
    # hoped for.
    assert "2026-08-29" in res["row"] and "13:30" in res["row"]


def test_an_offer_with_no_appointment_section_is_not_called_empty():
    # "This offer has no appointment table" and "the table is empty" are
    # different claims, and only the second one means a booking failed.
    res, _ = _eval(NO_SECTION, _APPOINTMENT_ROW_JS)
    assert res["status"] == "noheader"


# ── Pressing the right dialog's OK ──────────────────────────────────────────

def test_the_tag_picks_the_calendar_not_a_popup_stacked_over_it():
    res, tagged = _eval(
        STACKED_DIALOGS, _TAG_APPT_DIALOG_JS,
        then=("() => { const d=document.querySelector('#myIframe').contentDocument;"
              " return [...d.querySelectorAll('[data-bf-appt]')].map(e=>e.id); }"))
    assert res == 1                    # exactly one dialog claimed
    assert tagged == ["appt"]          # and it is the calendar, not the popup


def test_tagging_twice_does_not_leave_a_stale_tag_behind():
    # The dialog is re-tagged once per candidate slot. A tag left on a dialog
    # that has since closed would send the next OK click at a detached node.
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", STACKED_DIALOGS.replace("&", "&amp;").replace('"', "&quot;")))
                await page.wait_for_function(
                    "() => { const f=document.querySelector('#myIframe');"
                    " return f && f.contentDocument && f.contentDocument.body; }")
                await page.evaluate(_TAG_APPT_DIALOG_JS)
                # The calendar closes, as it does after a successful OK.
                await page.evaluate(
                    "() => document.querySelector('#myIframe').contentDocument"
                    ".querySelector('#appt').remove()")
                second = await page.evaluate(_TAG_APPT_DIALOG_JS)
                left = await page.evaluate(
                    "() => document.querySelector('#myIframe').contentDocument"
                    ".querySelectorAll('[data-bf-appt]').length")
                return second, left
            finally:
                await browser.close()
    second, left = asyncio.run(go())
    assert second == 0 and left == 0


# ── The pay tail can now see a missing appointment ──────────────────────────

def test_the_live_sentence_is_recognised_as_a_missing_appointment():
    # Verbatim from order 2608000122824032's blocked Next.
    assert is_missing_appointment("Please input the appointment date.")


def test_it_is_recognised_even_though_it_is_not_the_slot_race():
    # The whole reason the rebook never ran: this message carries no [40301147]
    # and the incident's page state had "dialogs": [], so is_slot_taken — which
    # needs one or the other — matched nothing.
    msg = "Please input the appointment date."
    assert not is_slot_taken(msg)
    assert is_missing_appointment(msg)


def test_the_slot_race_still_classifies_as_the_slot_race():
    # The two codes must not collapse into one: contention is worth resubmitting
    # for, a booking that never happened is not.
    race = "[40301147]: Technical Error - Slot has been taken. Kindly refresh the page"
    assert is_slot_taken(race)
    assert APPOINTMENT_SLOT_TAKEN != APPOINTMENT_NOT_BOOKED


def test_unrelated_portal_wording_is_not_swept_up():
    for msg in [
        "Please input the contact number.",
        "Some errors exists in order item(s). Please check and input again.",
        'Sorry, the SAMSUNG TV 55" is currently out of stock.',
        "",
        None,
    ]:
        assert not is_missing_appointment(msg), msg

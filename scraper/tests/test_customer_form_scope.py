"""The attach-time customer create must fill the Personal Customer DIALOG's
fields, not a same-named input elsewhere in the page.

ORD-0010 attempt 4 (2026-08-20): the fuzzy search found no customer, the
fallback opened the Personal Customer form via the dialog's Add button, and the
fill died at Customer Name — reported as the dialog's labels read out by the
exception handler. Live DOM dump showed why: input[name="custName"] index 0 is
an INVISIBLE input outside any dialog (the base page keeps one), so the old
unscoped `.first` anchored on it and timed out; the form's own custName is a
later match. certNbr happened to resolve inside the dialog, which is why the
failure frame shows ID Number filled and everything else empty.

personal_customer_dialog() is the fix: every lookup anchors on the one visible
dialog hosting form.js-cust-form (LAST such dialog = topmost).

Run from the scraper/ dir:
    pytest tests/test_customer_form_scope.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from order_entry import personal_customer_dialog  # noqa: E402

# The live collision, reduced: a hidden base-page custName (index 0), the
# Customer (Fuzzy Search) dialog's leftover search input, then the Personal
# Customer dialog with the real form — plus a second .js-ok on the underlying
# dialog, which an unscoped `.first` could click instead of the form's OK.
FALLBACK_STACK = """
<input name="custName" style="display:none">
<div class="modal in" style="display:block">
  <div class="modal-title">Customer</div>
  <input placeholder="fuzzy search">
  <button class="js-ok">OK</button>
</div>
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <form class="js-cust-form">
    <input name="certNbr">
    <input name="custName" id="real-name">
  </form>
  <form class="js-qry-form"><input name="contactManName"></form>
  <button class="js-ok" id="real-ok">OK</button>
</div>
"""

# A dismissed Personal Customer dialog leaves its DOM behind; a NEW one opens
# after it. :visible + .last must pick the new (visible, later) dialog.
DISMISSED_REMAINS = """
<div class="ui-dialog" style="display:none">
  <form class="js-cust-form"><input name="custName" id="stale-name"></form>
</div>
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <form class="js-cust-form"><input name="custName" id="real-name"></form>
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
                frame = page.frame_locator("#myIframe")
                return await probe(frame)
            finally:
                await browser.close()
    return asyncio.run(go())


def test_scope_fills_the_dialogs_own_custname():
    async def probe(frame):
        dlg = personal_customer_dialog(frame)
        await dlg.locator('input[name="custName"]').first.fill("HONG TUNG TUNG", timeout=5000)
        return await frame.locator("#real-name").input_value()
    assert _run(FALLBACK_STACK, probe) == "HONG TUNG TUNG"


def test_unscoped_first_anchors_the_wrong_element():


    # Documents the trap the fix exists for: page-wide, the FIRST custName is
    # the hidden base-page input, so the old code was waiting on an element
    # that can never become visible.
    async def probe(frame):
        first = frame.locator('input[name="custName"]').first
        return await first.evaluate("el => el.closest('form.js-cust-form') !== null")
    assert _run(FALLBACK_STACK, probe) is False


def test_scoped_ok_is_the_forms_ok():
    async def probe(frame):
        dlg = personal_customer_dialog(frame)
        return await dlg.locator(".js-ok").first.evaluate("el => el.id")
    assert _run(FALLBACK_STACK, probe) == "real-ok"


def test_dismissed_dialog_remains_are_not_matched():
    async def probe(frame):
        dlg = personal_customer_dialog(frame)
        await dlg.locator('input[name="custName"]').first.fill("X", timeout=5000)
        return await frame.locator("#real-name").input_value()
    assert _run(DISMISSED_REMAINS, probe) == "X"


# ── duplicate-IC picker: registered-name read ───────────────────────────────
# The PII dialog names the CRM's registered customer; ORD-0010's record turned
# out to be HONG LIONG TONG while the draft said HONG TUNG TUNG — the whole
# reason the IC+name search kept answering "record does not exist".
PII_DIALOG = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">PII ( ***************: 101005802971)</div>
  <div class="modal-body">Mandatory Questions
    1. Q: Registered Customer Full Name
       A: HONG LIONG TONG
    2. Q: Identification Card Number
       A: 820505034434
  </div>
</div>
"""


def test_read_pii_registered_name():
    from oe_feasibility import _read_pii_registered_name

    async def probe(frame):
        return await _read_pii_registered_name(frame)
    assert _run(PII_DIALOG, probe) == "HONG LIONG TONG"


def test_read_pii_registered_name_absent():
    from oe_feasibility import _read_pii_registered_name

    async def probe(frame):
        return await _read_pii_registered_name(frame)
    assert _run("<div>no dialog here</div>", probe) is None

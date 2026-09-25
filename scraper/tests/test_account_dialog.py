"""The portal's "Account Infomation" list: always take the FIRST account.

Live 2026-08-27, ORD-0017 attempt 2 (order 2608000122669349): the Broadband
tab's Service Number click died as `Locator.click: Timeout` — the call log
names `<div class="modal-body"> from <div class="comprivroot ui-dialog">` and
the backdrop as what intercepted it, and the failure frame shows the Account
Infomation dialog open over the tab, listing TWO accounts for the customer
(7042172192, 7042171533 — both AHMAD FAIZAL BIN HASSAN). With one account the
portal fills it silently; with two it stops to ask, and nothing answered.

Why two: page 1's account step was written to CREATE a new billing account per
order, so every re-submit of the same customer added one. The user's rule
(2026-08-27): always select the first account from the list, on page 1 as well,
and only press "+ Add" when the customer has no account at all.

Run from the scraper/ dir:
    pytest tests/test_account_dialog.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import create_billing_account, select_first_account  # noqa: E402

# The dialog as the failure frame shows it (jqGrid rows, "+ Add", OK/Cancel).
# Row clicks highlight like jqGrid does; OK hides the dialog; "+ Add" records
# that it was pressed so a test can assert it was NOT.
ACCOUNT_DIALOG = """
<div class="modal-backdrop in"></div>
<div class="comprivroot ui-dialog" style="display:block">
  <div class="ui-dialog-title">Account Infomation</div>
  <div class="modal-body">
    <span>Account List</span> <a class="js-add" onclick="window.added=(window.added||0)+1">+ Add</a>
    <table><tbody>
      <tr class="jqgfirstrow"><td></td></tr>
      <tr class="jqgrow" onclick="this.classList.add('ui-state-highlight')"><td>7042172192</td><td>AHMAD FAIZAL BIN HASSAN</td></tr>
      <tr class="jqgrow" onclick="this.classList.add('ui-state-highlight')"><td>7042171533</td><td>AHMAD FAIZAL BIN HASSAN</td></tr>
    </tbody></table>
  </div>
  <button class="js-ok" onclick="var r=this.closest('.ui-dialog').querySelector('tr.ui-state-highlight td'), a=document.querySelector('input[name=acctId]'); if(r&&a) a.value=r.innerText; this.closest('.ui-dialog').style.display='none'">OK</button>
  <button>Cancel</button>
</div>
"""

EMPTY_ACCOUNT_DIALOG = """
<div class="comprivroot ui-dialog" style="display:block">
  <div class="ui-dialog-title">Account Infomation</div>
  <div class="modal-body">
    <a class="js-add" onclick="window.added=(window.added||0)+1">+ Add</a>
    <table><tbody><tr class="jqgfirstrow"><td></td></tr></tbody></table>
  </div>
  <button class="js-ok">OK</button>
</div>
"""

ERROR_DIALOG = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Error</div>
  <div class="modal-message">[40330227]: The number is taken by another order.</div>
  <button class="js-ok" onclick="window.errorOk=1">OK</button>
</div>
"""

# Page 1: the account field whose addon opens the dialog.
PAGE1 = """
<div class="input-group">
  <input name="acctId" class="form-control">
  <span class="input-group-addon" onclick="document.querySelector('.ui-dialog').style.display='block'">...</span>
</div>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1000px;height:600px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _run(fixture_html, probe):
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
                frame = page.frame_locator("#myIframe")
                result = await probe(frame, page)
                state = await page.evaluate("""() => {
                  const d=document.querySelector('#myIframe').contentDocument;
                  const dl=d.querySelector('.ui-dialog');
                  return {open: !!dl && dl.style.display!=='none',
                          highlighted: [...d.querySelectorAll('tr.ui-state-highlight td:first-child')].map(t=>t.innerText),
                          added: d.defaultView.added||0, errorOk: d.defaultView.errorOk||0};
                }""")
                return result, state
            finally:
                await browser.close()
    return asyncio.run(go())


def test_first_account_is_selected_and_okayed():
    res, st = _run(ACCOUNT_DIALOG, select_first_account)
    assert res["status"] == "ok"
    assert res["account"].startswith("7042172192")
    assert st["highlighted"] == ["7042172192"]
    assert st["open"] is False
    assert st["added"] == 0


def test_no_account_dialog_is_a_no_op():
    res, st = _run(ERROR_DIALOG, select_first_account)
    assert res["status"] == "absent"
    assert st["errorOk"] == 0  # an Error dialog is not ours to OK here


def test_empty_account_list_is_reported_not_okayed():
    res, st = _run(EMPTY_ACCOUNT_DIALOG, select_first_account)
    assert res["status"] == "error"
    assert st["open"] is True


def test_page1_selects_the_first_existing_account_instead_of_adding():
    hidden = ACCOUNT_DIALOG.replace('style="display:block"', 'style="display:none"')
    res, st = _run(PAGE1 + hidden, create_billing_account)
    assert res["status"] == "ok"
    assert "7042172192" in res["note"]
    # The step now reads page 1's Account field back — OK'ing the list is only a
    # success if the portal actually put the account there (order
    # 2608000122708912 is what a green tick over an empty field costs).
    assert res["account"] == "7042172192"
    assert st["added"] == 0
    assert st["open"] is False


# ---------------------------------------------------------------------------
# Live 2026-09-25, order 2609000126725514: "The Account field on page 1 is
# still empty after the account step (no add (noadd); selected existing)".
# The step looked for the Account Infomation list once, three seconds after the
# click, did not find it, then pressed the first row and OK of whatever dialog
# WAS on top. That press closed the dialog, so the failure frame could not show
# what it had been.
# ---------------------------------------------------------------------------

def test_a_list_that_opens_late_is_still_used():
    # The list appears 5 s after the click: after the old single 3 s look,
    # inside the new wait.
    hidden = ACCOUNT_DIALOG.replace('style="display:block"', 'style="display:none"')
    late = PAGE1.replace(
        "onclick=\"document.querySelector('.ui-dialog').style.display='block'\"",
        "onclick=\"setTimeout(()=>document.querySelector('.ui-dialog').style.display='block',5000)\"")
    assert late != PAGE1, "fixture did not change"
    res, st = _run(late + hidden, create_billing_account)
    assert res["status"] == "ok", res
    assert res["account"] == "7042172192"
    assert st["added"] == 0


# Another picker left on top, with a grid and an OK of its own. The addon click
# never brings up the account list.
CONTACT_PICKER = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Installation Contact</div>
  <div class="modal-body"><table><tbody>
    <tr class="jqgrow"><td>POON WEI CHENG</td><td>60137089093</td></tr>
  </tbody></table></div>
  <button class="js-ok" onclick="window.errorOk=1">OK</button>
</div>
"""
DEAD_ADDON = PAGE1.replace(
    "onclick=\"document.querySelector('.ui-dialog').style.display='block'\"", "")


def test_an_unrecognised_dialog_is_named_and_never_pressed():
    assert DEAD_ADDON != PAGE1, "fixture did not change"
    res, st = _run(DEAD_ADDON + CONTACT_PICKER, create_billing_account)
    assert res["status"] == "error"
    # Same code as before, so retry policy and copy are unchanged.
    assert res["error"] == "account_not_set"
    # The failure names what was on screen — the evidence the live run lost.
    assert "Installation Contact" in res["message"], res["message"]
    # And it did not press a button on a dialog it could not identify.
    assert st["errorOk"] == 0
    assert st["open"] is True

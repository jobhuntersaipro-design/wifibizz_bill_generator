"""The Add Account form: fill EVERY starred field, and verify page 1 afterwards.

Live 2026-08-27, order 2608000122708912: the failure frame shows New Connection
page 1 with *Account empty and carrying the portal's red invalid border — the
page-1 Next refused. The account step had filled exactly ONE field on the Add
Account form (Account Name) and then OK'd whatever appeared, so no account was
ever created; and because every branch of create_billing_account returned
status "ok", the run walked on to Winback and the Next as though it had worked,
with a green "billing account" tick on the timeline.

The user's rule (2026-08-27): when the account list has no account, create one
and fill up the starred fields.

Run from the scraper/ dir:
    pytest tests/test_account_create_form.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    account_field_value,
    account_form_values,
    create_billing_account,
    fill_new_account_form,
)

PAYLOAD = {
    "customer": {
        "name": "AHMAD FAIZAL BIN HASSAN",
        "id_number": "920505034434",
        "residence_street": "NO 3 JALAN EKO MAJESTIK 1",
        "residence_postcode": "43500",
        "residence_city": "SEMENYIH",
        "residence_state": "SELANGOR",
        "contact": {"mobile_prefix": "60", "mobile": "173451209",
                    "email": "nexion.eform@gmail.com"},
    }
}

# The Add Account form as the portal builds forms elsewhere: Bootstrap
# .form-group rows, a "*" in the label for the mandatory ones, and a jQuery-UI
# combobox (display input + caret + a dropdown appended to the document). Its OK
# creates the account ONLY when every starred field carries a value — which is
# the portal behaviour the single-field fill was falling foul of.
ADD_ACCOUNT = """
<div class="input-group">
  <input name="acctId" class="form-control">
  <span class="input-group-addon" onclick="openList()">...</span>
</div>

<div id="list" class="comprivroot ui-dialog" style="display:none">
  <div class="ui-dialog-title">Account Infomation</div>
  <div class="modal-body">
    <a class="js-add" onclick="openAdd()">+ Add</a>
    <table><tbody><tr class="jqgfirstrow"><td></td></tr></tbody></table>
  </div>
  <button class="js-ok" onclick="hide('list')">OK</button>
</div>

<div id="add" class="comprivroot ui-dialog" style="display:none">
  <div class="ui-dialog-title">Add Account</div>
  <div class="modal-body">
    <div class="form-group"><label>*Account Name</label>
      <input name="acctName" class="form-control"></div>
    <div class="form-group"><label>*ID Number</label>
      <input name="certNbr" class="form-control"></div>
    <div class="form-group"><label>*Contact Number</label>
      <input name="contactNbr" class="form-control"></div>
    <div class="form-group"><label>Email</label>
      <input name="acctEmail" class="form-control"></div>
    <div class="form-group"><label>*Billing Address</label>
      <input name="billAddr" class="form-control"></div>
    <div class="form-group"><label>*Bill Media Type</label>
      <div class="input-group ui-combobox-fish">
        <input role="combobox" placeholder="---Please select---" readonly>
        <span class="input-group-addon" onclick="openMenu(this)">v</span>
      </div>
      <input name="billMediaType" style="display:none">
    </div>
  </div>
  <button class="js-ok" onclick="saveAdd()">OK</button>
  <button onclick="hide('add')">Cancel</button>
</div>

<ul class="combobox-dropdown" style="display:none">
  <li>---Please select---</li><li>E-Bill</li><li>Paper Bill</li>
</ul>

<script>
window.rejected = 0; window.created = 0;
function hide(id){ document.getElementById(id).style.display='none'; }
function openList(){ document.getElementById('list').style.display='block'; }
function openAdd(){ document.getElementById('add').style.display='block'; }
function openMenu(btn){
  var ul=document.querySelector('ul.combobox-dropdown');
  ul.style.display='block';
  ul.onclick=function(e){
    if(e.target.tagName!=='LI') return;
    var t=e.target.innerText.trim();
    if(t.indexOf('Please select')>-1) return;
    btn.closest('.form-group').querySelector('input[role=combobox]').value=t;
    btn.closest('.form-group').querySelector('input[name=billMediaType]').value=t;
    ul.style.display='none';
  };
}
function saveAdd(){
  var add=document.getElementById('add');
  var missing=[].slice.call(add.querySelectorAll('.form-group')).filter(function(g){
    var lbl=g.querySelector('label').innerText;
    if(lbl.indexOf('*')<0) return false;
    var c=g.querySelector('input[role=combobox]')||g.querySelector('input.form-control');
    return !(c.value||'').trim();
  });
  if(missing.length){ window.rejected++; return; }
  window.created++;
  document.querySelector('input[name=acctId]').value='7042180001';
  hide('add'); hide('list');
}
</script>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1000px;height:700px;border:0}</style>'
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
                  const v=n=>{const e=d.querySelector('[name="'+n+'"]'); return e? e.value : null;};
                  return {acctId: v('acctId'), acctName: v('acctName'), certNbr: v('certNbr'),
                          contactNbr: v('contactNbr'), acctEmail: v('acctEmail'),
                          billAddr: v('billAddr'), billMediaType: v('billMediaType'),
                          created: d.defaultView.created||0, rejected: d.defaultView.rejected||0,
                          openDialogs: [...d.querySelectorAll('.ui-dialog')]
                            .filter(e=>e.style.display!=='none').length};
                }""")
                return result, state
            finally:
                await browser.close()
    return asyncio.run(go())


# ── pure helpers ─────────────────────────────────────────────────────────────

def test_values_come_out_of_the_order_payload():
    v = account_form_values(PAYLOAD)
    assert v["name"] == "AHMAD FAIZAL BIN HASSAN"
    assert v["id_number"] == "920505034434"
    assert v["mobile"] == "60173451209"
    assert v["email"] == "nexion.eform@gmail.com"
    assert v["postcode"] == "43500"


def test_the_callers_account_name_wins_over_the_payload():
    assert account_form_values(PAYLOAD, "SITI BINTI ALI")["name"] == "SITI BINTI ALI"


def test_labels_map_to_the_right_value():
    v = account_form_values(PAYLOAD)
    assert account_field_value("*Account Name", v) == "AHMAD FAIZAL BIN HASSAN"
    assert account_field_value("*ID Number", v) == "920505034434"
    assert account_field_value("*Contact Number", v) == "60173451209"
    assert account_field_value("Email", v) == "nexion.eform@gmail.com"
    assert account_field_value("*Billing Address", v) == "NO 3 JALAN EKO MAJESTIK 1"
    assert account_field_value("*Postcode", v) == "43500"


def test_an_unrecognised_label_is_not_guessed_at():
    # Better an empty field the failure names than a plausible value in a
    # mandatory portal field nobody chose.
    assert account_field_value("*Credit Limit", account_form_values(PAYLOAD)) == ""
    assert account_field_value("", account_form_values(PAYLOAD)) == ""


# ── the form, in a browser ───────────────────────────────────────────────────

def test_every_starred_field_is_filled():
    async def probe(frame, page):
        await page.evaluate("""() => {
          const d=document.querySelector('#myIframe').contentDocument;
          d.defaultView.openList(); d.defaultView.openAdd();
        }""")
        return await fill_new_account_form(frame, page, PAYLOAD, "AHMAD FAIZAL BIN HASSAN")

    res, st = _run(ADD_ACCOUNT, probe)
    assert res["status"] == "ok"
    assert res["unanswered"] == []
    assert st["acctName"] == "AHMAD FAIZAL BIN HASSAN"
    assert st["certNbr"] == "920505034434"
    assert st["contactNbr"] == "60173451209"
    assert st["billAddr"] == "NO 3 JALAN EKO MAJESTIK 1"
    # A starred combobox takes the first REAL option, never the placeholder.
    assert st["billMediaType"] == "E-Bill"
    # Email is not starred and was already empty — left alone.
    assert st["acctEmail"] == ""


def test_the_whole_step_creates_the_account_and_reports_its_number():
    res, st = _run(ADD_ACCOUNT, lambda f, p: create_billing_account(
        f, p, "AHMAD FAIZAL BIN HASSAN", PAYLOAD))
    assert res["status"] == "ok", res
    assert res["account"] == "7042180001"
    assert st["created"] == 1 and st["rejected"] == 0
    assert st["openDialogs"] == 0


def test_an_account_that_never_lands_is_an_error_not_a_green_tick():
    # The portal refuses the OK and page 1's Account stays empty — the exact
    # shape of order 2608000122708912. It must NOT come back as "ok".
    stubborn = ADD_ACCOUNT.replace("window.created++;", "window.rejected++; return;")
    res, st = _run(stubborn, lambda f, p: create_billing_account(
        f, p, "AHMAD FAIZAL BIN HASSAN", PAYLOAD))
    assert res["status"] == "error"
    assert res["error"] == "account_not_set"
    assert st["acctId"] == ""


def test_a_field_the_order_cannot_answer_is_named_in_the_failure():
    extra = ADD_ACCOUNT.replace(
        '<div class="form-group"><label>Email</label>',
        '<div class="form-group"><label>*Credit Limit</label>'
        '<input name="creditLimit" class="form-control"></div>'
        '<div class="form-group"><label>Email</label>', 1)
    res, _ = _run(extra, lambda f, p: create_billing_account(
        f, p, "AHMAD FAIZAL BIN HASSAN", PAYLOAD))
    assert res["status"] == "error"
    assert any("Credit Limit" in u for u in res["unanswered"])
    assert "Credit Limit" in res["message"]

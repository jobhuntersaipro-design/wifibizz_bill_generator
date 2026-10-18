"""Delivery address: tick Default From Billing Address, never edit the address.

The portal fills the delivery address itself once the box is ticked (user,
2026-10-18). If ticking opens the Enter Address dialog, it is OKed exactly as
the portal pre-filled it. An already-ticked box is left alone.

Run from the scraper/ dir:
    python -m pytest tests/test_delivery_address.py -q
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from delivery_address import set_delivery_address  # noqa: E402

INSTALL_POSTCODE = "90000"
INSTALL_CITY = "SANDAKAN"
INSTALL_STATE = "SABAH"

BILLING_STREET = "BLOK 11 LORONG BUKIT SEPANGGAR 1"
BILLING_POSTCODE = "88450"
BILLING_CITY = "KOTA KINABALU"


# ── the delivery section, in a browser ───────────────────────────────────────

# Modelled on the live page: the checkbox, the read-only delivery fields it
# feeds, and the Enter Address dialog it opens. The dialog is the same widget as
# the residence pop-edit (order_entry.fill_residence_address): js-Postcode /
# js-city / js-state classes, disabled City + State auto-filled from the
# postcode, and a plain aria-required Address input for the street.
DELIVERY_PAGE = """
<div class="form-group">
  <label><input type="checkbox" name="defaultBillingAddress" CHECKED_ATTR
                onchange="onDefaultToggle(this)"> Default From Billing Address</label>
</div>
<div class="form-group"><label>Delivery Address</label>
  <input name="deliveryAddress" class="form-control" readonly value="PREFILL_STREET"></div>
<div class="form-group"><label>Delivery Postcode</label>
  <input name="deliveryPostcode" class="form-control" readonly value="PREFILL_POSTCODE"></div>
<div class="form-group"><label>Delivery City</label>
  <input name="deliveryCity" class="form-control" readonly value="PREFILL_CITY"></div>
<div class="form-group"><label>Delivery State</label>
  <input name="deliveryState" class="form-control" readonly value="PREFILL_STATE"></div>

<div id="enterAddress" class="comprivroot ui-dialog" style="display:none">
  <div class="ui-dialog-title">Enter Address</div>
  <form class="js-detail-form">
    <div class="form-group"><label>*Country</label>
      <input class="form-control js-countries" role="combobox" readonly value="Malaysia"></div>
    <div class="form-group"><label>*Postcode</label>
      <input class="form-control js-Postcode" aria-required="true" value=""></div>
    <div class="form-group"><label>City</label>
      <input class="form-control js-city" disabled value=""></div>
    <div class="form-group"><label>State</label>
      <input class="form-control js-state" disabled value=""></div>
    <div class="form-group"><label>*Address</label>
      <input id="streetInput" class="form-control" aria-required="true" value=""></div>
  </form>
  <button class="js-ok" onclick="okAddress()">OK</button>
  <button onclick="hideDialog()">Cancel</button>
</div>

<script>
var BILLING = {street: 'BILLING_STREET', postcode: 'BILLING_POSTCODE'};
var POSTCODES = {'BILLING_POSTCODE': ['BILLING_CITY', 'SABAH'],
                 'INSTALL_POSTCODE': ['INSTALL_CITY', 'INSTALL_STATE']};
window.opened = 0; window.rejected = 0; window.okCount = 0;
function q(s){ return document.querySelector(s); }
function autofill(){
  var p = POSTCODES[q('.js-Postcode').value] || ['', ''];
  q('.js-city').value = p[0]; q('.js-state').value = p[1];
}
q('.js-Postcode').addEventListener('blur', autofill);
function onDefaultToggle(cb){
  if(!cb.checked) return;
  window.opened++;
  q('.js-Postcode').value = BILLING.postcode; autofill();
  q('#streetInput').value = BILLING.street;
  q('#enterAddress').style.display = 'block';
}
function hideDialog(){ q('#enterAddress').style.display = 'none'; }
function okAddress(){
  var street = q('#streetInput');
  street.classList.remove('n-invalid');
  if(!street.value.trim() || /\\s\\s/.test(street.value)){
    street.classList.add('n-invalid'); window.rejected++; return;
  }
  window.okCount++;
  q('[name=deliveryAddress]').value = street.value;
  q('[name=deliveryPostcode]').value = q('.js-Postcode').value;
  q('[name=deliveryCity]').value = q('.js-city').value;
  q('[name=deliveryState]').value = q('.js-state').value;
  hideDialog();
}
</script>
"""


def delivery_page(*, already_ticked=False) -> str:
    """The page as the portal shows it. `already_ticked`: the box is checked and
    the delivery fields already hold the billing address (the shape that used to
    make delivery_terms do nothing)."""
    return (DELIVERY_PAGE
            .replace("CHECKED_ATTR", "checked" if already_ticked else "")
            .replace("PREFILL_STREET", BILLING_STREET if already_ticked else "")
            .replace("PREFILL_POSTCODE", BILLING_POSTCODE if already_ticked else "")
            .replace("PREFILL_CITY", BILLING_CITY if already_ticked else "")
            .replace("PREFILL_STATE", "SABAH" if already_ticked else "")
            .replace("BILLING_STREET", BILLING_STREET)
            .replace("BILLING_POSTCODE", BILLING_POSTCODE)
            .replace("BILLING_CITY", BILLING_CITY)
            .replace("INSTALL_POSTCODE", INSTALL_POSTCODE)
            .replace("INSTALL_CITY", INSTALL_CITY)
            .replace("INSTALL_STATE", INSTALL_STATE))


HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:1000px;height:700px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def run_step(fixture_html):
    """Run set_delivery_address against the fixture. Returns (result, page state)."""
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
                result = await set_delivery_address(page.frame_locator("#myIframe"), page)
                state = await page.evaluate("""() => {
                  const d=document.querySelector('#myIframe').contentDocument;
                  const v=n=>{const e=d.querySelector('[name="'+n+'"]'); return e? e.value : null;};
                  const dlg=d.querySelector('#enterAddress');
                  return {street: v('deliveryAddress'), postcode: v('deliveryPostcode'),
                          city: v('deliveryCity'), state: v('deliveryState'),
                          dialogOpen: !!dlg && dlg.style.display !== 'none',
                          opened: d.defaultView.opened, rejected: d.defaultView.rejected,
                          okCount: d.defaultView.okCount};
                }""")
                return result, state
            finally:
                await browser.close()
    return asyncio.run(go())


def test_unticked_box_is_ticked_and_the_prefilled_address_is_accepted():
    res, st = run_step(delivery_page())
    assert res == {"status": "ok", "detail": "ticked, Enter Address OKed untouched"}
    assert st["street"] == BILLING_STREET
    assert st["postcode"] == BILLING_POSTCODE
    assert st["city"] == BILLING_CITY
    assert st["dialogOpen"] is False
    assert st["opened"] == 1 and st["okCount"] == 1


def test_already_ticked_box_is_left_alone():
    res, st = run_step(delivery_page(already_ticked=True))
    assert res["status"] == "ok"
    assert st["street"] == BILLING_STREET
    assert st["opened"] == 0 and st["okCount"] == 0


def test_a_disabled_box_is_left_alone():
    # Live 2026-10-18: the portal greyed the box out and filled the address itself.
    disabled = delivery_page().replace('name="defaultBillingAddress"',
                                       'name="defaultBillingAddress" disabled')
    res, st = run_step(disabled)
    assert res == {"status": "ok",
                   "detail": "box disabled by the portal (address left as the portal set it)"}
    assert st["opened"] == 0 and st["okCount"] == 0


def test_ticking_without_a_dialog_is_fine():
    # The portal may fill the address on tick with no dialog at all.
    no_dialog = delivery_page().replace("q('#enterAddress').style.display = 'block';", "")
    res, st = run_step(no_dialog)
    assert res == {"status": "ok", "detail": "ticked (address left as the portal set it)"}
    assert st["opened"] == 1 and st["okCount"] == 0


def test_a_refused_ok_is_an_error():
    stubborn = delivery_page().replace(
        "window.okCount++;", "window.rejected++; return;")
    res, st = run_step(stubborn)
    assert res["status"] == "error"
    assert res["error"] == "delivery_address_rejected"
    assert res["stage"] == "delivery_terms"
    assert st["dialogOpen"] is True


def test_a_page_without_the_checkbox_skips_cleanly():
    # Engineer Door-to-door: no Delivery Information / no checkbox (ORD-0135).
    without = delivery_page().replace(
        '<label><input type="checkbox" name="defaultBillingAddress" \n'
        '                onchange="onDefaultToggle(this)"> Default From Billing Address</label>',
        '')
    assert "defaultBillingAddress" not in without
    res, st = run_step(without)
    assert res == {"status": "ok",
                   "detail": "skipped (no Default From Billing Address control)"}
    assert st["opened"] == 0 and st["okCount"] == 0


def test_checkbox_found_by_label_when_name_differs():
    renamed = delivery_page().replace('name="defaultBillingAddress"',
                                      'name="somethingElse"')
    res, st = run_step(renamed)
    assert res["status"] == "ok"
    assert st["opened"] == 1 and st["okCount"] == 1

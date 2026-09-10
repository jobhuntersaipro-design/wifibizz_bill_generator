"""Delivery address must equal the order's installation address.

The Customer Order Information page has a "Default From Billing Address"
checkbox. Ticking it opens an "Enter Address" dialog PRE-FILLED FROM THE BILLING
ACCOUNT. delivery_terms used to OK that dialog untouched, and did nothing at all
when the box was already ticked. Billing differs from the installation unit
whenever an existing account carries an older address, so submitted orders left
the portal with delivery != installation.

The fixture models that page: ticking the box opens the dialog with the billing
address; OK copies the dialog into the page's delivery fields and, like the real
validator (tests/test_address_line.py), refuses a street with consecutive
whitespace. Postcode blur auto-fills the disabled City/State the way the
residence pop-edit does live.

Run from the scraper/ dir:
    python -m pytest tests/test_delivery_address.py -q
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from delivery_address import (  # noqa: E402
    installation_address_for_delivery,
    set_delivery_address,
)

# The installation unit the order selected. Different from the billing address
# on every line so a step that leaves any billing value behind fails.
INSTALL_STREET = "353 LORONG MERPATI 4 TAMAN MERPATI"
INSTALL_POSTCODE = "90000"
INSTALL_CITY = "SANDAKAN"
INSTALL_STATE = "SABAH"

BILLING_STREET = "BLOK 11 LORONG BUKIT SEPANGGAR 1"
BILLING_POSTCODE = "88450"
BILLING_CITY = "KOTA KINABALU"


def _payload(*, street=INSTALL_STREET, postcode=INSTALL_POSTCODE,
             city=INSTALL_CITY, state=INSTALL_STATE) -> dict:
    return {
        "customer": {
            "name": "UDIN BIN RAUF",
            "residence_street": street,
            "residence_address": " ".join(p for p in (street, city, postcode, state) if p),
            "residence_postcode": postcode,
            "residence_city": city,
            "residence_state": state,
            "residence_country": "Malaysia",
            "contact": {"mobile_prefix": "60", "mobile": "138765432",
                        "email": "udin@example.com"},
        },
        "address": {
            "state": state,
            "keywords": street or postcode,
            "address_full": street,
            "postcode": postcode,
        },
    }


# ── pure helper ──────────────────────────────────────────────────────────────

def test_helper_returns_installation_street_not_billing():
    addr = installation_address_for_delivery(_payload())
    assert addr["street"] == INSTALL_STREET
    assert addr["postcode"] == INSTALL_POSTCODE
    assert addr["city"] == INSTALL_CITY
    assert addr["state"] == INSTALL_STATE
    assert addr["country"] == "Malaysia"


def test_helper_prefers_the_selected_unit_over_residence():
    # address.address_full is the unit select_address matched on the portal; the
    # customer residence is what the billing account was seeded from.
    p = _payload()
    p["customer"]["residence_street"] = BILLING_STREET
    assert installation_address_for_delivery(p)["street"] == INSTALL_STREET


def test_helper_falls_back_to_keywords_then_residence():
    p = _payload()
    p["address"]["address_full"] = ""
    p["address"]["keywords"] = "353 LORONG MERPATI 4"
    assert installation_address_for_delivery(p)["street"] == "353 LORONG MERPATI 4"
    p["address"]["keywords"] = ""
    assert installation_address_for_delivery(p)["street"] == INSTALL_STREET


def test_helper_collapses_consecutive_spaces_in_street():
    p = _payload(street="353  LORONG   MERPATI\t4")
    assert installation_address_for_delivery(p)["street"] == "353 LORONG MERPATI 4"


def test_helper_reports_an_empty_street_as_empty():
    p = _payload(street="")
    p["customer"]["residence_address"] = ""
    assert installation_address_for_delivery(p)["street"] == ""
    assert installation_address_for_delivery(None)["street"] == ""


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


def run_step(fixture_html, payload):
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
                result = await set_delivery_address(page.frame_locator("#myIframe"), page, payload)
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


def test_unticked_box_delivery_becomes_the_installation_address():
    res, st = run_step(delivery_page(), _payload())
    assert res == {"status": "ok", "detail": "ok (from installation: street, postcode)"}
    assert st["street"] == INSTALL_STREET
    assert st["postcode"] == INSTALL_POSTCODE
    assert st["city"] == INSTALL_CITY
    assert st["state"] == INSTALL_STATE
    assert st["dialogOpen"] is False
    assert st["opened"] == 1 and st["okCount"] == 1 and st["rejected"] == 0


def test_already_ticked_box_is_reopened_and_overwritten():
    # The live bug: box already ticked, delivery already holding the billing
    # address, and the old block skipped everything. It must reopen and rewrite.
    res, st = run_step(delivery_page(already_ticked=True), _payload())
    assert res["status"] == "ok"
    assert st["street"] == INSTALL_STREET
    assert st["postcode"] == INSTALL_POSTCODE
    assert st["city"] == INSTALL_CITY
    assert st["opened"] == 1
    assert st["dialogOpen"] is False


def test_an_empty_installation_street_fails_instead_of_keeping_billing():
    p = _payload(street="")
    p["customer"]["residence_address"] = ""
    res, st = run_step(delivery_page(already_ticked=True), p)
    assert res["status"] == "error"
    assert res["error"] == "delivery_address_missing_installation"
    assert res["stage"] == "delivery_terms"
    # Nothing was touched: the dialog never opened and no OK was clicked.
    assert st["opened"] == 0 and st["okCount"] == 0


def test_a_double_spaced_street_is_normalised_so_the_validator_accepts_it():
    res, st = run_step(delivery_page(), _payload(street="353  LORONG   MERPATI  4"))
    assert res["status"] == "ok"
    assert st["street"] == "353 LORONG MERPATI 4"
    assert st["rejected"] == 0


def test_a_refused_ok_is_an_error_that_names_the_field():
    # The validator keeps the dialog open and marks *Address n-invalid. That
    # must come back as an error, not as a green tick over a billing address.
    stubborn = delivery_page().replace(
        "window.okCount++;", "street.classList.add('n-invalid'); window.rejected++; return;")
    res, st = run_step(stubborn, _payload())
    assert res["status"] == "error"
    assert res["error"] == "delivery_address_rejected"
    assert "*Address" in res["message"]
    assert st["dialogOpen"] is True
    assert st["street"] == ""


def test_a_page_without_the_checkbox_is_an_error():
    without = delivery_page().replace('name="defaultBillingAddress"', 'name="somethingElse"')
    res, st = run_step(without, _payload())
    assert res["status"] == "error"
    assert res["error"] == "delivery_address_checkbox_missing"
    assert st["okCount"] == 0

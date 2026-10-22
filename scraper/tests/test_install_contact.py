"""Installation Contact is always created via New Contact (ClickUp z8v9xnj9m3).

The Add Mode dialog's markup below is a fixture, not a capture: the real New
Contact form has never been recorded, so the step finds fields by label and
the run log prints what the live dialog carries.

Run from the scraper/ dir:
    pytest tests/test_install_contact.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oe_feasibility  # noqa: E402
from install_contact import classify, contact_name, split_mobile  # noqa: E402
from oe_feasibility import set_installation_contact  # noqa: E402

PAYLOAD = {"customer": {"name": "MAT LAZIM BIN RAPAL",
                        "contact": {"mobile_prefix": "60", "mobile": "601127749539",
                                    "email": "aliffazim92@gmail.com"}}}

PAGE = """
<div class="input-group js-contact-info">
  <input name="installationContact" readonly class="form-control">
  <span class="input-group-addon" onclick="show('addmode')"><i class="glyphicon glyphicon-new-window">o</i></span>
</div>
<div class="input-group"><input name="acctId" class="form-control" value="ACCT_VALUE"></div>

<div id="addmode" class="ui-dialog" style="display:none">
  <div class="ui-dialog-title">Add Mode</div>
  <label><input type="radio" name="mode" value="E" checked onclick="mode('E')"> Select Existing Contact</label>
  <label><input type="radio" name="mode" value="N" onclick="mode('N')"> New Contact</label>
  <div id="existing" class="form-group"><label>Select Existing...</label>
    <input name="existing" readonly><span onclick="window.gridOpened=1"><i class="glyphicon-new-window">o</i></span></div>
  <div id="newform" style="display:none">
    <div class="form-group"><label>*Customer Name</label><input name="cName"></div>
    <div class="form-group"><label>*Customer Mobile</label><input name="cArea"><input name="cPhone"></div>
    <div class="form-group"><label>Second Customer Mobile</label><input name="c2Area"><input name="c2Phone"></div>
    <div class="form-group"><label>*Customer Email</label><input name="cEmail"></div>
  </div>
  <button class="js-ok" onclick="ok()">OK</button>
</div>
<script>
  function show(id){document.getElementById(id).style.display='block';}
  function mode(m){document.getElementById('existing').style.display=m==='E'?'block':'none';
                   document.getElementById('newform').style.display=m==='N'?'block':'none';}
  function v(n){return document.querySelector('[name='+n+']').value;}
  function ok(){
    if(document.querySelector('[name=mode]:checked').value!=='N'||!v('cName')){return;}
    document.querySelector('[name=installationContact]').value=v('cName');
    document.getElementById('addmode').style.display='none';
  }
</script>
"""

HOST = '<iframe id="myIframe" srcdoc="FIXTURE_HTML" style="width:900px;height:700px"></iframe>'


def _run(acct_value="", payload=PAYLOAD, ok_works=True):
    html = PAGE.replace("ACCT_VALUE", acct_value)
    if not ok_works:
        html = html.replace("onclick=\"ok()\"", "")

    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", html.replace("&", "&amp;").replace('"', "&quot;")))
                await page.wait_for_function(
                    "() => { const f=document.querySelector('#myIframe');"
                    " return f && f.contentDocument && f.contentDocument.body; }")
                shots = []

                async def fake_capture(pg, pl, slot, stage):
                    shots.append((slot, await pg.evaluate(STATE_JS)))
                oe_feasibility.capture_and_report = fake_capture
                res = await set_installation_contact(
                    page.frame_locator("#myIframe"), page, payload, stage=lambda *a: None)
                return res, shots, await page.evaluate(STATE_JS)
            finally:
                await browser.close()
    real = oe_feasibility.capture_and_report
    try:
        return asyncio.run(go())
    finally:
        oe_feasibility.capture_and_report = real


STATE_JS = """() => { const d=document.querySelector('#myIframe').contentDocument;
  const v=n=>d.querySelector('[name='+n+']').value;
  return {mode: d.querySelector('[name=mode]:checked').value, name: v('cName'),
          area: v('cArea'), phone: v('cPhone'), area2: v('c2Area'), phone2: v('c2Phone'),
          email: v('cEmail'), ic: v('installationContact'),
          gridOpened: d.defaultView.gridOpened||0}; }"""


# ── pure helpers ─────────────────────────────────────────────────────────────

def test_mobile_split_drops_the_leading_60():
    assert split_mobile("60", "601127749539") == ("60", "1127749539")


def test_mobile_not_starting_with_60_does_not_crash():
    # AC6: a local 0-leading number drops the 0; anything else is kept whole.
    assert split_mobile("60", "01127749539") == ("60", "1127749539")
    assert split_mobile("60", "1127749539") == ("60", "1127749539")
    assert split_mobile("", "") == ("60", "")


def test_contact_name_strips_the_account_number():
    assert contact_name("MAT LAZIM BIN RAPAL[7043685929]", "X") == "MAT LAZIM BIN RAPAL"
    assert contact_name("", "MAT LAZIM BIN RAPAL") == "MAT LAZIM BIN RAPAL"


def test_second_mobile_is_never_mapped():
    assert classify("Second Customer Mobile") is None
    assert classify("*Customer Mobile") == "mobile"
    assert classify("*Customer Email") == "email"
    assert classify("*Customer Name") == "name"


# ── the dialog ───────────────────────────────────────────────────────────────

def test_new_contact_is_chosen_and_filled_from_the_order():
    res, shots, state = _run()
    assert res["status"] == "ok", res
    assert state["mode"] == "N"
    assert state["gridOpened"] == 0  # Select Existing never opened (AC4)
    assert state["ic"] == "MAT LAZIM BIN RAPAL"
    # AC1/AC3: one frame before OK, with every value and the second mobile blank.
    assert [s for s, _ in shots] == ["install_contact"]
    before = shots[0][1]
    assert (before["name"], before["area"], before["phone"], before["email"]) == (
        "MAT LAZIM BIN RAPAL", "60", "1127749539", "aliffazim92@gmail.com")
    assert before["area2"] == "" and before["phone2"] == ""


def test_account_name_wins_over_the_customer_name():
    res, _, state = _run(acct_value="MAT LAZIM BIN RAPAL[7043685929]",
                         payload={"customer": {**PAYLOAD["customer"], "name": "OTHER"}})
    assert res["status"] == "ok", res
    assert state["name"] == "MAT LAZIM BIN RAPAL"


def test_an_ok_that_leaves_the_field_empty_is_an_error():
    res, _, _ = _run(ok_works=False)
    assert res["status"] == "error"
    assert res["error"] == "install_contact_not_set"

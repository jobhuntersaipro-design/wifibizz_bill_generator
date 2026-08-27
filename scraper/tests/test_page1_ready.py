"""New Connection page 1: do not fill a form that has not rendered yet.

Live 2026-08-27, order 2608000122751138. The run log:

    'install_contact': {'status':'skipped', 'reason':'not_applicable',
                        'message':'no installationContact field on this offer'}
    'account':         {'status':'skipped', 'reason':'not_applicable',
                        'note':'no account field'}
    'winback':         {'status':'ok', 'selected':'HSBA Wireless Access'}

Both lookups matched nothing; winback, which runs third and therefore later,
matched fine. The page1 capture taken moments afterwards shows BOTH fields on
screen, and the Broadband tab found `installationContact` seconds later. The
form is filled by AJAX after the customer dialog closes and nothing waited for
it.

What made this expensive rather than merely wrong: a missing field reads as
"this offer has no such field", which is a legitimate state, so nothing failed.
The run walked on with no billing account and died at the Next with the
portal's own "Some errors exists in order item(s)".

Run from the scraper/ dir:
    pytest tests/test_page1_ready.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_feasibility import (  # noqa: E402
    create_billing_account,
    wait_for_page1_form,
)

# Page 1 as the portal renders it, with the account field present.
PAGE1 = """
<div class="section-title">Main Offer Information</div>
<div class="form-group"><label>*Service Number</label><input name="svcNbr"></div>
<div class="form-group"><label>*Account</label>
  <div class="input-group">
    <input name="acctId" class="form-control">
    <span class="input-group-addon" onclick="openList()">...</span>
  </div>
</div>
<div class="form-group"><label>*Winback Tagging</label><input name="wb"></div>

<div id="list" class="comprivroot ui-dialog" style="display:none">
  <div class="ui-dialog-title">Account Infomation</div>
  <div class="modal-body">
    <table><tbody>
      <tr class="jqgfirstrow"><td></td></tr>
      <tr class="jqgrow" onclick="this.classList.add('ui-state-highlight')"><td>7042180002</td><td>TEST</td></tr>
    </tbody></table>
  </div>
  <button class="js-ok" onclick="pick()">OK</button>
</div>
<script>
  function openList(){ document.getElementById('list').style.display='block'; }
  function pick(){
    var r=document.querySelector('tr.ui-state-highlight td');
    if(r) document.querySelector('input[name=acctId]').value=r.innerText;
    document.getElementById('list').style.display='none';
  }
</script>
"""

# The live shape: the shell is up, the form arrives by AJAX a beat later.
LATE_PAGE1 = """
<div id="shell"></div>
<script>
  setTimeout(function(){
    document.getElementById('shell').innerHTML = FORM_HTML;
    [...document.querySelectorAll('script')].forEach(function(s){
      if(s.parentElement && s.parentElement.id==='shell') (0,eval)(s.textContent);
    });
  }, 1200);
</script>
"""
# NOTE the indirect `(0,eval)` above: a plain eval() inside the timeout callback
# declares the function in THAT scope, so the injected markup's inline
# `onclick="openList()"` — which resolves globally — would never find it.

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
                acct = await page.evaluate("""() => {
                  const d=document.querySelector('#myIframe').contentDocument;
                  const e=d.querySelector('input[name=acctId]');
                  return e ? e.value : null;
                }""")
                return result, acct
            finally:
                await browser.close()
    return asyncio.run(go())


def _late(form_html: str) -> str:
    # The form is injected as a JS string, so quotes/newlines must survive —
    # and the literal must not carry a raw `</script>`, which ends the OUTER
    # script tag at parse time however well quoted it is inside JS.
    import json
    return LATE_PAGE1.replace(
        "FORM_HTML", json.dumps(form_html).replace("</script>", "<\\/script>"))


def test_the_gate_waits_for_a_form_that_arrives_late():
    res, _ = _run(_late(PAGE1), lambda f, p: wait_for_page1_form(p, timeout_s=10))
    assert res["ready"] is True
    assert res["acct"] is True


def test_the_gate_gives_up_and_says_what_it_saw():
    res, _ = _run("<div>nothing here</div>",
                  lambda f, p: wait_for_page1_form(p, timeout_s=1))
    assert res["ready"] is False
    # The evidence matters more than the verdict: a run that proceeds on this
    # must be able to say the form was never there.
    assert res["acct"] is False and res["contact"] is False


def test_the_account_step_no_longer_calls_a_late_field_not_applicable():
    # The live failure, exactly: the step runs while the form is still coming.
    res, acct = _run(_late(PAGE1),
                     lambda f, p: create_billing_account(f, p, "TEST", None))
    assert res["status"] == "ok", res
    assert res["account"] == "7042180002"
    assert acct == "7042180002"


def test_an_offer_that_truly_has_no_account_field_still_skips():
    # The skip must survive — some offers genuinely carry no account field, and
    # turning that into an error would fail every one of them.
    res, _ = _run("<div class='form-group'><label>Winback</label><input name='wb'></div>",
                  lambda f, p: create_billing_account(f, p, "TEST", None))
    assert res["status"] == "skipped"
    assert res["reason"] == "not_applicable"

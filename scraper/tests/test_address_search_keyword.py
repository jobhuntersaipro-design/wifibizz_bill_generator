"""select_address against a fake portal that refuses a bracketed keyword.

Live 2026-09-25 (order cmugj47yz00000agme8927057): the portal parses the
By-keyword text as an Oracle Text query, where ( ) group, and answered
"... HERMINGTON (BLOK B) TAMAN ..." with a Warning over an empty grid:

    ORA-29902: error in executing ODCIIndexStart() routine
    ORA-20000: Oracle Text error: DRG-50901: text query parser syntax error

These drive the REAL select_address through a FrameLocator — the same object
production hands it via `_frame(page)` — because the two bugs worth pinning
are both invisible to a test of the helpers alone: the keyword the portal
actually receives, and whether the Warning's text reaches the error message
at all (a FrameLocator has no evaluate(); passing it to the dialog reader
reported nothing, silently).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from oe_feasibility import select_address  # noqa: E402

ADDRESS = ("B-17-03 JALAN KUCHAI 8 17 RESIDENSI HERMINGTON (BLOK B) "
           "TAMAN LIAN HOE KUALA LUMPUR WILAYAH PERSEKUTUAN MALAYSIA 58200")
ORACLE = ("ORA-29902: error in executing ODCIIndexStart() routine "
          "ORA-20000: Oracle Text error: DRG-50901: text query parser "
          "syntax error on line 1, column 215")


def _combo(name, options):
    lis = "".join(f'<li title="{o}">{o}</li>' for o in options)
    return f"""
      <div class="input-group">
        <div class="input-group ui-combobox-fish">
          <input role="combobox"><span class="input-group-addon">v</span>
        </div>
        <input name="{name}" style="display:none">
      </div>
      <ul class="combobox-dropdown" style="display:none">{lis}</ul>"""


# `refuse` is a JS expression over `kw`: true means the portal answers with the
# Oracle Warning instead of a grid.
FIXTURE = """
<input name="installationAddress">
<div class="js-address-pop input-group">
  <span class="input-group-addon"><i class="glyphicon glyphicon-new-window">+</i></span>
</div>
<div class="ui-dialog" id="modal" style="display:none">
  <form class="js-address-form">
    CUSTTYPE
    STATE
    <button type="button" id="byKeywords">By keyword</button>
    <input name="keywords">
    <button type="button" class="js-query">Query</button>
  </form>
  <table class="js-address-grid"><tbody id="grid"></tbody></table>
  <button type="button" class="js-ok">OK</button>
</div>
<div class="ui-dialog" id="warn" style="display:none">
  <div class="modal-message" id="warn-text"></div>
</div>
<script>
  const $ = s => document.querySelector(s);
  $('.js-address-pop .input-group-addon').onclick = () => $('#modal').style.display = 'block';
  document.querySelectorAll('.ui-combobox-fish .input-group-addon').forEach(caret => {
    const row = caret.closest('.input-group').parentElement;
    const menu = row.nextElementSibling;
    caret.onclick = () => menu.style.display = 'block';
    menu.querySelectorAll('li').forEach(li => li.onclick = () => {
      row.querySelector('input[role=combobox]').value = li.title;
      row.querySelector('input[style]').value = li.title;
      menu.style.display = 'none';
    });
  });
  $('.js-query').onclick = () => {
    const kw = document.querySelector('input[name=keywords]').value;
    document.body.setAttribute('data-searched', kw);
    if (REFUSE) {
      $('#warn-text').textContent = 'ORACLE';
      $('#warn').style.display = 'block';
      return;
    }
    $('#grid').innerHTML =
      '<tr class="jqgrow"><td title="W.P. KUALA LUMPUR">x</td>' +
      '<td title="KUALA LUMPUR">x</td><td title="ADDRESS">x</td></tr>';
  };
</script>
"""

HOST = ('<!doctype html><meta charset="utf-8">'
        '<iframe id="myIframe" style="width:900px;height:700px" srcdoc="FIXTURE_HTML"></iframe>')


def _run(refuse_js):
    fixture = (FIXTURE
               .replace("CUSTTYPE", _combo("custType", ["Consumer"]))
               .replace("STATE", _combo("state", ["W.P. KUALA LUMPUR"]))
               .replace("REFUSE", refuse_js)
               .replace("ORACLE", ORACLE)
               .replace("ADDRESS", ADDRESS))

    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(HOST.replace(
                    "FIXTURE_HTML", fixture.replace("&", "&amp;").replace('"', "&quot;")))
                frame = page.frame_locator("#myIframe")  # what _frame(page) returns
                result = await select_address(frame, {
                    "state": "Wilayah Persekutuan Kuala Lumpur",
                    "keywords": ADDRESS, "address_full": ADDRESS})
                searched = await page.frame_locator("#myIframe").locator(
                    "body").get_attribute("data-searched")
                return result, searched
            finally:
                await browser.close()
    return asyncio.run(go())


def test_the_bracketed_address_is_searched_without_brackets_and_matched():
    # The fake refuses exactly what the live portal refused.
    result, searched = _run("kw.includes('(') || kw.includes(')')")
    assert searched and "(" not in searched and ")" not in searched
    assert result["status"] == "ok", result
    # The row the portal returns still carries its brackets, and is still taken.
    assert result["matched"] == ADDRESS


def test_an_oracle_refusal_is_reported_in_the_portals_own_words():
    # A future character the portal chokes on must say so, not read as an
    # unserviceable address — which sends an agent to question TM coverage.
    result, _ = _run("true")
    assert result["error"] == "address_not_found"
    assert "DRG-50901" in result["message"], result["message"]

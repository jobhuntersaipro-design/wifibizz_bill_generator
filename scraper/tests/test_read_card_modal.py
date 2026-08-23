"""The MyKad card-reader dialog must come off the customer form — and only it.

A live submit died at "Creating customer profile" with the reader dialog open
over the Personal Customer form ("Device is reconnecting", Error "Fail to read
card!"), the run dying at the ID Type step. read_card_modal.dismiss_read_card
clears it; oe_helpers.set_combobox(skip_if_set=True) keeps us off that widget in
the first place.

These run against real markup in a real browser, because every trap here is a
DOM trap that a description of the DOM would not catch:

  * "Read Card" is a heading AND a button on the ORDINARY form — matching that
    phrase would report a perfectly healthy form as blocked.
  * The error popup covers the reader's Cancel, so it has to go first.
  * A Cancel that closes the whole Personal Customer dialog looks exactly like
    a successful dismissal unless somebody checks the form is still there.

Run from the scraper/ dir:
    pytest tests/test_read_card_modal.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_helpers import set_combobox  # noqa: E402
from read_card_modal import dismiss_read_card  # noqa: E402

# The ordinary Personal Customer form: a "Read Card" section heading and a Read
# Card button sit in the ID Type row, right beside the combobox caret.
PLAIN_FORM = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <form class="js-cust-form">
    <fieldset><legend>Read Card</legend>
      <div class="input-group">
        <div class="input-group ui-combobox-fish">
          <input role="combobox" value="MyKad">
          <span class="input-group-addon" id="caret">&#9662;</span>
        </div>
        <input name="certTypeId" value="1" style="display:none">
        <button class="btn btn-primary" id="read-card-btn">Read Card</button>
      </div>
    </fieldset>
    <input name="custName">
  </form>
</div>
"""

# The failure screen: the reader dialog over the form, with the error popup on
# top of it. Both are dialogs; the reader's Cancel is underneath.
BLOCKED = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <form class="js-cust-form"><input name="custName"></form>
</div>
<div class="ui-dialog" id="reader" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <div>Read Card</div>
  <div class="tab">Fingerprint Verification</div>
  <div class="modal-footer">
    <button class="btn btn-primary" id="reader-read">Read Card</button>
    <button class="btn" id="reader-cancel">Cancel</button>
  </div>
</div>
<div class="ui-dialog modal-danger" id="err" style="display:block">
  <div class="modal-message">Fail to read card!</div>
  <div class="modal-footer"><button class="btn btn-danger" id="err-ok">OK</button></div>
</div>
<script>
  document.getElementById('err-ok').onclick =
    () => document.getElementById('err').style.display = 'none';
  document.getElementById('reader-cancel').onclick =
    () => document.getElementById('reader').style.display = 'none';
  document.getElementById('reader-read').onclick =
    () => document.body.setAttribute('data-read-card-pressed', '1');
</script>
"""

# The same screen, wired so Cancel takes the whole customer form with it. The
# dialogs are gone either way — only the form tells the two apart.
CANCEL_CLOSES_EVERYTHING = BLOCKED.replace(
    "() => document.getElementById('reader').style.display = 'none';",
    "() => document.querySelectorAll('.ui-dialog')"
    ".forEach(d => d.style.display = 'none');")

HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:600px;border:0}</style>'
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
                return await probe(page.frame_locator("#myIframe"))
            finally:
                await browser.close()
    return asyncio.run(go())


def test_plain_form_is_not_reported_as_blocked():
    """"Read Card" on the ordinary form must not read as a reader dialog."""
    result = _run(PLAIN_FORM, dismiss_read_card)
    assert result == {"dismissed": False, "seen": False}


def test_clears_the_error_popup_and_the_reader():
    async def probe(frame):
        result = await dismiss_read_card(frame)
        pressed = await frame.locator("body").get_attribute("data-read-card-pressed")
        return result, pressed

    result, pressed = _run(BLOCKED, probe)
    assert result["dismissed"] is True
    assert result["closed"] == ["error popup", "reader dialog"]
    # The one button on that dialog we must never press.
    assert pressed is None


def test_reports_when_cancel_took_the_customer_form_with_it():
    result = _run(CANCEL_CLOSES_EVERYTHING, dismiss_read_card)
    assert result["dismissed"] is False
    assert "took the customer form" in result["error"]


def test_skip_if_set_leaves_the_id_type_widget_alone():
    """MyKad is already selected: no click lands in the Read Card row at all."""
    async def probe(frame):
        clicks = []
        await frame.locator("#caret").evaluate(
            "el => el.onclick = () => window.__caret = 1")
        await frame.locator("#read-card-btn").evaluate(
            "el => el.onclick = () => window.__readcard = 1")
        await set_combobox(frame, "certTypeId", "MyKad",
                           scope=frame.locator(".ui-dialog"), skip_if_set=True)
        for name in ("__caret", "__readcard"):
            clicks.append(await frame.locator("body").evaluate(
                f"() => window.{name} || 0"))
        return clicks

    assert _run(PLAIN_FORM, probe) == [0, 0]


def test_skip_if_set_still_sets_a_field_that_differs():
    """The skip is a match test, not a blanket opt-out: a different value still
    goes through the normal open-the-dropdown path (here: no dropdown exists, so
    it must fail loudly rather than silently do nothing)."""
    async def probe(frame):
        try:
            await set_combobox(frame, "certTypeId", "Passport",
                               scope=frame.locator(".ui-dialog"), skip_if_set=True,
                               timeout=2000)
            return "returned"
        except Exception as e:
            return type(e).__name__

    assert _run(PLAIN_FORM, probe) == "RuntimeError"


# ── The real cause of the reported screen ────────────────────────────────────
# Live probe of the portal (2026-08-23), buttons of the Personal Customer dialog
# in DOM order: .close, .js-read-card ("Read Card"), a slide-toggle, .js-ok
# ("OK"), .js-add-cancel ("Cancel"). The dialog has NO .modal-footer.
#
# _await_customer_create_result used to end by clicking the first `button.btn`
# in any visible dialog — which on the timeout path (no outcome dialog at all)
# is `.js-read-card`. That is why every timed-out create finished by opening the
# MyKad reader and its "Fail to read card!" error.
CUSTOMER_DIALOG_NO_OUTCOME = """
<div class="ui-dialog" style="display:block">
  <div class="ui-dialog-title">Personal Customer</div>
  <button class="close"></button>
  <button class="btn btn-primary js-read-card" id="read-card-btn">Read Card</button>
  <button class="btn btn-default js-slide-toggle-btn"></button>
  <form class="js-cust-form"><input name="custName"></form>
  <button class="btn btn-primary js-ok" id="ok-btn">OK</button>
  <button class="btn btn-default js-add-cancel">Cancel</button>
</div>
<script>
  document.getElementById('read-card-btn').onclick =
    () => document.body.setAttribute('data-read-card-pressed', '1');
</script>
"""

# The same dialog with a real outcome popup over it — that one SHOULD be
# dismissed, so the fix must not simply stop clicking.
WITH_OUTCOME_DIALOG = CUSTOMER_DIALOG_NO_OUTCOME + """
<div class="ui-dialog" id="warn" style="display:block">
  <div class="ui-dialog-title">Warning</div>
  <div class="modal-message">The data is incomplete, Please check and input again.</div>
  <div class="modal-footer"><button class="btn btn-danger" id="warn-ok">OK</button></div>
</div>
<script>
  document.getElementById('warn-ok').onclick =
    () => document.getElementById('warn').style.display = 'none';
</script>
"""


def test_timeout_cleanup_never_presses_read_card():
    from order_entry import _await_customer_create_result

    async def probe(frame):
        result = await _await_customer_create_result(frame, timeout_s=1)
        pressed = await frame.locator("body").get_attribute("data-read-card-pressed")
        return result, pressed

    result, pressed = _run(CUSTOMER_DIALOG_NO_OUTCOME, probe)
    assert result["error"] == "customer_create_timeout"
    assert pressed is None, "the cleanup click pressed Read Card"
    # And it says what was on screen instead of only "no dialog appeared".
    assert "Personal Customer" in result["message"]


def test_a_real_outcome_dialog_is_still_dismissed():
    from order_entry import _await_customer_create_result

    async def probe(frame):
        result = await _await_customer_create_result(frame, timeout_s=1)
        return result, await frame.locator("#warn").is_visible()

    result, still_open = _run(WITH_OUTCOME_DIALOG, probe)
    assert result["error"] == "customer_data_incomplete"
    assert still_open is False

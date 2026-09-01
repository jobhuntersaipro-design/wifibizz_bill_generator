"""The PII identity check must be answered, or reported — never assumed.

Live 2026-09-01, production order cmtha9j3o… failed EIGHT times on one screen.
`submit-7-failure.jpg` shows it: the customer's IC is already an active
subscriber (customer code 101005413283), so before the portal will hand that
record to the order it puts up its PII dialog — titled `PII (******: …)`, two
tabs, **OTP** active with a Send OTP button against the customer's own line
601159345877, **Questions** beside it, and **Proceed greyed out**.

`_answer_pii_and_proceed` ticked every `answerCheck` in the Questions form and
pressed Proceed. On the OTP tab there are no such boxes, so it ticked nothing
and pressed a disabled button — and then returned `{"status": "ok"}` regardless.
The run walked on, died later with no idea why, and the unclassified failure
was retried three more times against a code that only the customer's phone can
supply.

The fixtures below are those two screens in miniature. Run from scraper/:
    pytest tests/test_pii_verification.py
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oe_errors import (  # noqa: E402
    BLACKLISTED_IC, DEVICE_OUT_OF_STOCK, PII_VERIFICATION_REQUIRED, map_error)
from oe_feasibility import _answer_pii_and_proceed  # noqa: E402

# ── The dialog, parameterised by which tab holds what ────────────────────────
#
# Two things are modelled because both decide the outcome: Proceed is
# `disabled` until a question is ticked (the portal's real gate), and the
# inactive tab's panel is `display:none` — so its checkboxes are IN THE DOM but
# not on screen, which is precisely the state a `count()`-based test reads as
# "questions available" and gets wrong.

DIALOG = """
<style>
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
</style>
<div class="ui-dialog">
  <div class="ui-dialog-title">PII ( ******: 101005413283)</div>
  <ul class="nav nav-tabs">
    <li class="OTP_LI"><a href="#otp" data-tab="otp">OTP</a></li>
    <li class="Q_LI"><a href="#questions" data-tab="questions">Questions</a></li>
  </ul>
  <div id="otp" class="tab-pane OTP_ACTIVE">
    <label>Service Number</label>
    <input name="serviceNumber" value="601159345877">
    <button type="button" class="js-send-otp">Send OTP</button>
    <label>OTP</label>
    <input name="otp">
    <button type="button" class="js-check-otp">Check</button>
  </div>
  <div id="questions" class="tab-pane Q_ACTIVE">
    QUESTIONS_BODY
  </div>
  <button type="button" class="js-proceed" DISABLED>Proceed</button>
  <button type="button" class="js-cancel">Cancel</button>
</div>
<script>
  window.__proceedClicks = 0;
  window.__tabClicks = 0;
  var proceed = document.querySelector('.js-proceed');
  proceed.addEventListener('click', function () {
    // A disabled button fires nothing in a real browser either; counted here so
    // a test can prove the dead click was never even attempted.
    window.__proceedClicks++;
    document.querySelector('.ui-dialog').remove();
  });
  [].forEach.call(document.querySelectorAll('.nav-tabs a'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.__tabClicks++;
      [].forEach.call(document.querySelectorAll('.tab-pane'), function (p) {
        p.className = p.className.replace(' active', '');
      });
      document.getElementById(a.getAttribute('data-tab')).className += ' active';
    });
  });
  // The portal's own gate: Proceed lights up once a question is answered.
  [].forEach.call(document.querySelectorAll('input[name="answerCheck"]'), function (c) {
    c.addEventListener('change', function () { proceed.removeAttribute('disabled'); });
    c.addEventListener('click', function () { proceed.removeAttribute('disabled'); });
  });
</script>
"""

QUESTIONS = """
    <form class="js-mandatory-question-form">
      <label><input type="checkbox" name="answerCheck" value="1"> Date of birth</label>
      <label><input type="checkbox" name="answerCheck" value="2"> Registered address</label>
    </form>
"""


def build(*, questions: str, active: str) -> str:
    """`active` is the tab the dialog opens on: "otp" or "questions"."""
    return (DIALOG
            .replace("QUESTIONS_BODY", questions)
            .replace("OTP_ACTIVE", "active" if active == "otp" else "")
            .replace("Q_ACTIVE", "active" if active == "questions" else "")
            .replace("OTP_LI", "active" if active == "otp" else "")
            .replace("Q_LI", "active" if active == "questions" else "")
            .replace("DISABLED", "disabled"))


HOST = ('<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0}#myIframe{width:900px;height:600px;border:0}</style>'
        '<iframe id="myIframe" srcdoc="FIXTURE_HTML"></iframe>')


def _run(html, coro_factory):
    async def go():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content(
                    HOST.replace("FIXTURE_HTML",
                                 html.replace("&", "&amp;").replace('"', "&quot;")))
                frame = page.frame_locator("#myIframe")
                return await coro_factory(page, frame)
            finally:
                await browser.close()
    try:
        return asyncio.run(go())
    except Exception as e:  # noqa: BLE001
        if "executable doesn't exist" in str(e).lower():
            pytest.skip("chromium not installed for playwright")
        raise


def _counters(page):
    return page.evaluate("""(() => {
      const w = document.querySelector('#myIframe').contentWindow;
      return {proceed: w.__proceedClicks, tabs: w.__tabClicks,
              dialogUp: !!w.document.querySelector('.ui-dialog')};
    })""")


# ── The live screen ──────────────────────────────────────────────────────────

def test_otp_only_is_reported_not_walked_past():
    """cmtha9j3o…'s screen: OTP tab, no questions anywhere, Proceed disabled."""
    html = build(questions="", active="otp")

    async def go(page, frame):
        return await _answer_pii_and_proceed(frame), await _counters(page)

    r, c = _run(html, go)
    assert r["status"] == "error"
    assert r["error"] == PII_VERIFICATION_REQUIRED
    # The reason has to survive into the message: an agent reading this needs to
    # know it is the customer's phone that is missing, not their own draft.
    assert "one-time code" in r["message"]
    assert "601159345877" in r["message"], "the dialog's own text should be quoted"
    assert c["proceed"] == 0, "a disabled Proceed must not be clicked at all"


def test_the_old_code_would_have_called_that_screen_a_success():
    """Guards the fix from being 'simplified' back.

    Without this the test above could pass for the wrong reason — so reproduce
    what the previous implementation did (tick whatever is there, press Proceed,
    return ok) and assert the screen genuinely does not yield to it.
    """
    html = build(questions="", active="otp")

    async def go(page, frame):
        checks = frame.locator('form.js-mandatory-question-form input[name="answerCheck"]')
        ticked = await checks.count()
        proceed = frame.locator('button:has-text("Proceed"):visible').first
        try:
            await proceed.click(timeout=1500)
        except Exception:  # noqa: BLE001
            pass
        return ticked, await _counters(page)

    ticked, c = _run(html, go)
    assert ticked == 0, "there is nothing to tick on the OTP tab"
    assert c["dialogUp"] is True, "and Proceed does not move — the run was stuck here"


# ── The fix that can make these orders go through ────────────────────────────

def test_questions_behind_the_inactive_tab_are_found_and_answered():
    """The dialog opens on OTP but this customer HAS answerable questions.

    The portal only shows the active tab's panel, so the boxes are in the DOM
    and invisible — which a count()-based reading calls "available" and then
    ticks to no effect. Activating the tab first is what turns this screen from
    a failure into a submitted order.
    """
    html = build(questions=QUESTIONS, active="otp")

    async def go(page, frame):
        return await _answer_pii_and_proceed(frame), await _counters(page)

    r, c = _run(html, go)
    assert r["status"] == "ok"
    assert c["tabs"] == 1, "the Questions tab had to be activated"
    assert c["proceed"] == 1
    assert c["dialogUp"] is False, "the portal closes the dialog on success"


def test_that_fixture_really_hides_the_questions():
    """Without which the test above would pass whether or not the tab was ever
    clicked — the boxes are present, so only their VISIBILITY distinguishes."""
    html = build(questions=QUESTIONS, active="otp")

    async def go(page, frame):
        checks = frame.locator('form.js-mandatory-question-form input[name="answerCheck"]')
        return await checks.count(), await checks.first.is_visible()

    n, visible = _run(html, go)
    assert n == 2, "present in the DOM"
    assert visible is False, "and not on screen until the tab is active"


def test_the_ordinary_path_is_untouched():
    """The dialog as it has always arrived on the working path: Questions
    already active. It must still tick, proceed, and report ok."""
    html = build(questions=QUESTIONS, active="questions")

    async def go(page, frame):
        return await _answer_pii_and_proceed(frame), await _counters(page)

    r, c = _run(html, go)
    assert r["status"] == "ok"
    assert c["proceed"] == 1
    assert c["dialogUp"] is False


def test_a_note_still_rides_along_on_success():
    """The caller's note ("registered as X — attached the existing record") is
    what the timeline shows for a matched-by-prefix customer."""
    html = build(questions=QUESTIONS, active="questions")

    async def go(page, frame):
        return await _answer_pii_and_proceed(frame, note="Matched on the prefix.")

    r = _run(html, go)
    assert r["status"] == "ok"
    assert r["note"] == "Matched on the prefix."


# ── Reading back what it did ─────────────────────────────────────────────────

def test_a_proceed_that_does_not_take_is_reported():
    """The defect this codebase keeps paying for: a step that reports success
    without reading back its own work. Here the questions ARE answerable but the
    portal keeps the dialog up — which used to come back as `ok`."""
    html = build(questions=QUESTIONS, active="questions").replace(
        "document.querySelector('.ui-dialog').remove();", "")

    async def go(page, frame):
        return await _answer_pii_and_proceed(frame), await _counters(page)

    r, c = _run(html, go)
    assert r["status"] == "error"
    assert r["error"] == PII_VERIFICATION_REQUIRED
    assert "kept the identity check open" in r["message"]
    assert c["proceed"] == 1, "it did try"


def test_no_dialog_at_all_is_its_own_answer():
    """Not the OTP refusal: nothing refused anything. Reported rather than
    called a success, because a silent ok here hides a customer that was never
    attached — and left unclassified so the retry may have another go."""
    async def go(page, frame):
        return await _answer_pii_and_proceed(frame)

    r = _run("<div>Feasibility Check</div>", go)
    assert r["status"] == "error"
    assert r["error"] == "pii_dialog_not_found"
    assert r["error"] != PII_VERIFICATION_REQUIRED


# ── The classification ───────────────────────────────────────────────────────

def test_the_dialogs_own_words_classify():
    """Every dialog reader in the flow funnels through map_error, so naming it
    once means a PII check surfacing anywhere else is named too."""
    live = "OTP Questions Service Number Send OTP OTP Check"
    assert map_error(live) == PII_VERIFICATION_REQUIRED


def test_it_does_not_swallow_the_other_refusals():
    """`send otp` is specific, but the table is first-match-wins and this rule
    sits at the top — so prove the neighbours still classify as themselves."""
    assert map_error(
        "[40300805]: You're on our blacklist. Visit our nearest Unifi Store for help."
    ) == BLACKLISTED_IC
    assert map_error(
        '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.'
    ) == DEVICE_OUT_OF_STOCK

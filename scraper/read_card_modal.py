"""The portal's MyKad card-reader dialog — detect it, get rid of it, or say so.

Why this module exists
──────────────────────
A live submit died at "Creating customer profile". The failure frame shows the
Personal Customer form covered by the portal's card-reader dialog: a "Read Card"
panel with a Fingerprint Verification tab, an info toast reading "Device is
reconnecting", and an Error popup reading "Fail to read card!". The run died at
the **ID Type step** — the first field the fill touches, and the one row on this
form that carries a Read Card button beside its combobox.

There is no card reader on the droplet and there never will be: we type the ID
number, we do not read a chip. So this dialog is never wanted, and the only
question is how it got there. Two orderings produce the same screen:

  * our own clicks opened it — `set_combobox` force-clicks the caret and the
    display input up to eight times when a dropdown will not open; or
  * the portal opened it itself when the form rendered, and its overlay ate
    every click, so the dropdown never opened.

The caller defends against the first (it does not touch the ID Type widget when
it already reads MyKad). This module defends against the second.

Two rules, both borrowed from shell_modal.py, which learned them the hard way:

  * **Poll for it, never sample once.** The reader applet connects a moment
    after the form renders; absence at one instant says nothing.
  * **Verify it actually went away**, and verify the form it was covering is
    still there. A Cancel that closed the wrong dialog must not be reported as
    a successful dismissal.

Safety: the only controls clicked are an OK on the error popup and a control
whose whole text is exactly "Cancel". "Read Card" is never clicked — pressing it
is what asks a reader that does not exist to read a card that is not there.
"""

import asyncio
import re

# The reader dialog is recognised by its own furniture, not by the words "Read
# Card": that phrase is also a section heading and a button on the ordinary
# customer form, so matching it would report the plain form as blocked.
READER_MARKER = re.compile(r"fingerprint verification", re.I)
ERROR_MARKER = re.compile(r"fail(ed)? to read card", re.I)

_DIALOGS = ".ui-dialog:visible, .modal.in:visible"


def reader_dialog(frame):
    """The visible card-reader dialog (topmost), if one is open."""
    return frame.locator(_DIALOGS).filter(has_text=READER_MARKER).last


def reader_error_dialog(frame):
    """The visible "Fail to read card!" error popup, if one is open."""
    return frame.locator(_DIALOGS).filter(has_text=ERROR_MARKER).last


async def _visible(locator) -> bool:
    try:
        return await locator.count() > 0 and await locator.is_visible()
    except Exception:  # noqa: BLE001 — a detached node is simply not visible
        return False


async def dismiss_read_card(frame, watch_s: float = 4.0) -> dict:
    """Clear the card-reader dialog off the Personal Customer form.

    Polls for `watch_s` seconds so a reader that opens a beat after the form
    renders is still caught. Returns:

        {"dismissed": False, "seen": False}                  nothing was there
        {"dismissed": True,  "seen": True, "closed": [...]}  cleared it
        {"dismissed": False, "seen": True, "error": "..."}   still in the way

    Never raises: this runs on the way to a real order, and a failure to tidy up
    must not be the thing that ends the run — the caller finds out from the
    return value and can report it in words.
    """
    seen = False
    closed: list[str] = []
    deadline = watch_s
    step = 0.5

    while deadline > 0:
        # The error popup sits ON TOP of the reader dialog, so it goes first —
        # its overlay is what would swallow the click on Cancel.
        if await _visible(reader_error_dialog(frame)):
            seen = True
            if await _click_ok(reader_error_dialog(frame)):
                closed.append("error popup")
        elif await _visible(reader_dialog(frame)):
            seen = True
            if await _click_cancel(reader_dialog(frame)):
                closed.append("reader dialog")
        elif seen:
            break
        await asyncio.sleep(step)
        deadline -= step

    if not seen:
        return {"dismissed": False, "seen": False}

    if await _visible(reader_error_dialog(frame)) or await _visible(reader_dialog(frame)):
        return {"dismissed": False, "seen": True, "closed": closed,
                "error": "The card-reader dialog is still covering the customer form."}

    # It is gone — but gone how? A Cancel that took the whole Personal Customer
    # dialog with it looks identical from here unless somebody looks.
    form = frame.locator("form.js-cust-form:visible").last
    if not await _visible(form):
        return {"dismissed": False, "seen": True, "closed": closed,
                "error": "The card-reader dialog closed and took the customer form with it."}

    return {"dismissed": True, "seen": True, "closed": closed}


async def _click_ok(dialog) -> bool:
    for sel in (".modal-footer .btn-danger", ".modal-footer button",
                'button:text-is("OK")', ".btn-danger"):
        try:
            btn = dialog.locator(sel).first
            if await btn.count() > 0 and await btn.is_visible():
                await btn.click(timeout=3000)
                return True
        except Exception:  # noqa: BLE001
            pass
    return False


async def _click_cancel(dialog) -> bool:
    """Close the reader with Cancel — and only ever with Cancel.

    `:text-is` is a whole-text match on purpose. A contains-match for "Cancel"
    is fine here, but the same habit applied one selector over would let "Read
    Card" match a looser rule; the exact form is the one that stays safe when
    this list grows.
    """
    for sel in ('button:text-is("Cancel")', '.btn:text-is("Cancel")',
                '[role="button"]:text-is("Cancel")'):
        try:
            btn = dialog.locator(sel).last
            if await btn.count() > 0 and await btn.is_visible():
                await btn.click(timeout=3000)
                return True
        except Exception:  # noqa: BLE001
            pass
    return False

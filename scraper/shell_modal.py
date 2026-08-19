"""The portal shell's own modal — read it, dismiss it safely, or name it.

Why this module exists
──────────────────────
On 2026-08-19 four consecutive live submits died at "Creating customer profile"
with a 45-second Playwright timeout on the very first click into the order
iframe. The droplet was healthy and the portal was not under load. The blocker
was an Ant Design dialog on the *outer* shell — outside `#myIframe` entirely:

    Your Password is Expiring Soon
    Please update your password to maintain access to your account.
    [ Later ]  [ Change Now ]                       (no ✕ close control)

`ensure_on_order_entry` already looked for a "Later" button, and the selector
was right. It lost a race: it navigated, slept 3000ms, looked exactly once, and
the modal is inserted at **t+3.0s** (measured live, polled at 500ms). When the
look came up empty it skipped silently, the modal appeared a moment later, the
iframe app rendered happily *underneath* it, and every subsequent click was
eaten by the overlay.

So the two rules here are:

  * **Poll for the modal, never sample once.** Absence at one instant says
    nothing — that is the entire bug.
  * **Verify it actually went away.** A click that did not dismiss is
    indistinguishable from no modal at all if nobody looks again.

Safety: dismissal is a strict ALLOWLIST of deferring labels. This dialog's other
button is "Change Now", which opens a password-change form on a live CRM, and
the next unknown shell modal may well pair a harmless label with a consequential
one. Anything not on the list is reported, never clicked — a run that stops with
"a dialog called X is covering the form" is strictly better than one that
silently pressed a button nobody chose.
"""

# Read the topmost visible shell dialog and decide whether it is in the way.
#
# A module constant so tests/test_shell_modal.py can exercise it against the
# real markup rather than against a description of it.
#
# `blocking` is a hit-test, not a guess: it asks the document what is actually
# painted over the centre of #myIframe. A shell modal that does NOT cover the
# order form must not fail a run that would otherwise have succeeded.
#
# Visibility deliberately tolerates `position: fixed` — `.ant-modal-wrap` is
# fixed, so its `offsetParent` is always null and an offsetParent-only test
# reports every Ant modal as hidden.
READ_SHELL_DIALOG_JS = r"""(() => {
  const SAFE = ['later','not now','remind me later','maybe later','skip',
                'dismiss','close','cancel'];
  const WRAPS = ['.ant-modal-wrap','.modal.in','.modal.show'];

  const vis = e => {
    if (!e) return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return (e.offsetParent !== null || s.position === 'fixed')
        && s.visibility !== 'hidden' && s.display !== 'none'
        && r.width > 0 && r.height > 0;
  };
  const text = e => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();

  let wrap = null, selector = null;
  for (const sel of WRAPS) {
    const hit = [...document.querySelectorAll(sel)].filter(vis).pop();
    if (hit) { wrap = hit; selector = sel; break; }
  }
  if (!wrap) return {present: false};

  const buttons = [...wrap.querySelectorAll('button, a.ant-btn, a.btn')]
    .filter(vis).map(b => text(b)).filter(Boolean);

  // First SAFE label wins, so a dialog offering both "Later" and "Cancel"
  // defers rather than cancels.
  let dismiss = null;
  for (const want of SAFE) {
    const hit = buttons.find(b => b.toLowerCase() === want);
    if (hit) { dismiss = hit; break; }
  }
  const closer = wrap.querySelector('.ant-modal-close, .close');
  if (!dismiss && vis(closer)) dismiss = '__close__';

  // Is it actually over the order form? Ask the document, don't assume.
  const frame = document.querySelector('#myIframe');
  const box = frame ? frame.getBoundingClientRect() : null;
  const cx = box && box.width  ? box.left + box.width  / 2 : innerWidth  / 2;
  const cy = box && box.height ? box.top  + box.height / 2 : innerHeight / 2;
  const at = document.elementFromPoint(cx, cy);
  const blocking = !!at && (wrap.contains(at) || at === wrap);

  const body = wrap.querySelector('.ant-modal-body, .modal-body');
  return {
    present: true,
    selector,
    title: text(wrap.querySelector('.ant-modal-title, .modal-title')),
    body: text(body || wrap).slice(0, 300),
    buttons: buttons.slice(0, 8),
    dismiss,
    blocking,
  };
})"""


# Click one specific label inside the shell dialog, chosen by the reader above.
#
# A direct DOM click rather than a Playwright one: the dialog is the topmost
# thing on the page, so pointer interception is not the risk here — a second
# overlay stacked above it is, and `.click()` is immune to that. React's root
# listener picks up the real bubbling event, so Ant's handler still fires.
DISMISS_SHELL_DIALOG_JS = r"""((label) => {
  const vis = e => {
    if (!e) return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return (e.offsetParent !== null || s.position === 'fixed')
        && s.visibility !== 'hidden' && s.display !== 'none'
        && r.width > 0 && r.height > 0;
  };
  const WRAPS = ['.ant-modal-wrap','.modal.in','.modal.show'];
  let wrap = null;
  for (const sel of WRAPS) {
    const hit = [...document.querySelectorAll(sel)].filter(vis).pop();
    if (hit) { wrap = hit; break; }
  }
  if (!wrap) return 'nodialog';

  if (label === '__close__') {
    const x = wrap.querySelector('.ant-modal-close, .close');
    if (!x) return 'nobutton';
    x.click();
    return 'clicked';
  }
  const want = String(label).toLowerCase();
  const btn = [...wrap.querySelectorAll('button, a.ant-btn, a.btn')]
    .filter(vis)
    .find(b => ((b.innerText || '').replace(/\s+/g,' ').trim().toLowerCase()) === want);
  if (!btn) return 'nobutton';
  btn.click();
  return 'clicked';
})"""


def describe_blocking_dialog(info: dict | None) -> str | None:
    """One sentence naming the dialog that is covering the portal, or None.

    Pure, so the wording is tested without a browser. It exists because the
    message this replaces — "The portal was still busy (its loading overlay was
    up)… try again in a moment" — was wrong in every particular: nothing was
    loading, the portal was not busy, and retrying could never clear a dialog
    that waits for a human. Four identical retries were burned on it.
    """
    if not info or not info.get("present"):
        return None
    title = (info.get("title") or "").strip()
    named = f'"{title}"' if title else "an unnamed dialog"
    buttons = [b for b in (info.get("buttons") or []) if b]
    choices = f" Its buttons are: {', '.join(buttons)}." if buttons else ""
    return (f"A portal dialog is open over the order form and is swallowing every "
            f"click: {named}.{choices} It has to be answered in the portal before "
            f"an order can be submitted.")


def dialog_summary(info: dict | None) -> str:
    """Short log line for a shell dialog — title plus how it was handled."""
    if not info or not info.get("present"):
        return "none"
    bits = [info.get("title") or "(untitled)"]
    if info.get("dismiss"):
        bits.append(f"dismiss={info['dismiss']}")
    if info.get("blocking"):
        bits.append("BLOCKING")
    return " | ".join(bits)


async def read_shell_dialog(page) -> dict:
    """One read of the shell dialog. Never raises — a page that is mid-navigation
    must not turn a real error into an evaluate() crash."""
    try:
        return await page.evaluate(READ_SHELL_DIALOG_JS) or {"present": False}
    except Exception:
        return {"present": False}


async def clear_shell_dialog(page, appear_ms: int = 8000, settle_ms: int = 6000,
                             poll_ms: int = 250) -> dict:
    """Wait for the shell dialog to appear, dismiss it safely, confirm it left.

    `appear_ms=0` makes this a single look — the right call for the sweep that
    runs after the iframe app has rendered, where the only question is whether
    something arrived late.

    Outcomes:
      none       — nothing showed up inside the window
      dismissed  — a safe button was clicked and the dialog is gone
      stuck      — it is still there: no safe button, or the click didn't take
    """
    import asyncio

    waited = 0
    info = await read_shell_dialog(page)
    while not info.get("present") and waited < appear_ms:
        await asyncio.sleep(poll_ms / 1000)
        waited += poll_ms
        info = await read_shell_dialog(page)

    if not info.get("present"):
        return {"outcome": "none"}

    label = info.get("dismiss")
    if not label:
        # Nothing on the allowlist. Report it — clicking an unvetted button on a
        # live CRM is how an automation changes a password or confirms an order
        # nobody asked it to.
        return {"outcome": "stuck", "reason": "no_safe_button", **info}

    try:
        clicked = await page.evaluate(DISMISS_SHELL_DIALOG_JS, label)
    except Exception as e:  # noqa: BLE001
        return {"outcome": "stuck", "reason": f"click_failed: {e}", **info}
    if clicked != "clicked":
        return {"outcome": "stuck", "reason": f"click_{clicked}", **info}

    # Confirm. An unverified click is exactly the assumption that caused this.
    gone, waited = False, 0
    while waited < settle_ms:
        await asyncio.sleep(poll_ms / 1000)
        waited += poll_ms
        if not (await read_shell_dialog(page)).get("present"):
            gone = True
            break
    if not gone:
        return {"outcome": "stuck", "reason": "still_up_after_click", **info}
    # Same shape as the stuck/read results — one payload everywhere, so a log
    # line or a message never has to know which branch produced it.
    return {**info, "outcome": "dismissed", "clicked": label}

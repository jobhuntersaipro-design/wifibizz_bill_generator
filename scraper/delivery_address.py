"""Delivery address on the Unifi order form: tick the box, leave the address alone.

The Customer Order Information page offers a "Default From Billing Address"
checkbox, which must be ticked. The portal fills the delivery address itself
(user, 2026-10-18), so nothing here types an address. If ticking opens the
"Enter Address" dialog it is OKed exactly as the portal pre-filled it.

This replaces the 2026-09-10 behaviour, which rewrote that dialog from the
order's installation address on every submit.
"""

import asyncio
import re

_DIALOG = '.ui-dialog:visible:has-text("Enter Address")'
_OK = re.compile(r"^\s*ok\s*$", re.I)


def _error(code: str, message: str) -> dict:
    return {"status": "error", "stage": "delivery_terms", "error": code, "message": message}


async def set_delivery_address(frame, page) -> dict:
    """Tick Default From Billing Address and accept what the portal fills in.

    Returns {"status": "ok", "detail": ...} or {"status": "error", "stage",
    "error", "message"}. Never edits an address field.
    """
    try:
        return await _tick_default_billing(frame)
    except Exception as e:  # noqa: BLE001 - a Playwright timeout is a named step failure
        return _error("delivery_address_failed",
                      f"Ticking Default From Billing Address failed: "
                      f"{type(e).__name__}: {str(e)[:160]}")


async def _find_billing_checkbox(frame):
    """Locate Default From Billing Address by name, then by label text.

    Engineer Door-to-door (and other non-courier) orders never render this
    control. Name alone also drifts; the printed label is the stable signal.
    """
    by_name = frame.locator('input[name="defaultBillingAddress"]').first
    if await by_name.count():
        return by_name
    by_label = frame.locator(
        'label:has-text("Default From Billing Address") input[type="checkbox"]').first
    if await by_label.count():
        return by_label
    return None


async def _tick_default_billing(frame) -> dict:
    box = await _find_billing_checkbox(frame)
    if box is None:
        # Door-to-door leaves no Delivery Information block (ORD-0135).
        return {"status": "ok",
                "detail": "skipped (no Default From Billing Address control)"}
    if await box.is_checked():
        return {"status": "ok", "detail": "already ticked (address left as the portal set it)"}
    await box.check(timeout=5000)

    dialog = frame.locator(_DIALOG).first
    try:
        await dialog.wait_for(state="visible", timeout=5000)
    except Exception:
        return {"status": "ok", "detail": "ticked (address left as the portal set it)"}
    await asyncio.sleep(0.8)
    await dialog.locator("button, a.btn").filter(has_text=_OK).first.click(timeout=5000)
    await asyncio.sleep(1)
    if await dialog.count():
        return _error("delivery_address_rejected",
                      "The Enter Address dialog refused OK with the address the portal "
                      "pre-filled, so the delivery address is not set.")
    return {"status": "ok", "detail": "ticked, Enter Address OKed untouched"}

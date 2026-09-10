"""Delivery address on the Unifi order form := the order's installation address.

The Customer Order Information page offers a "Default From Billing Address"
checkbox. Ticking it opens an "Enter Address" dialog pre-filled from the billing
account. Until 2026-09-10 delivery_terms OKed that dialog untouched, and did
nothing at all when the box was already ticked. An existing account keeps the
address it was opened with, so delivery and installation diverged on submitted
orders. Here the checkbox only OPENS the dialog: every editable field is then
rewritten from the installation address before OK, and a refused OK or a missing
installation street is an error rather than a fall-through to billing.
"""

import asyncio
import re

from order_entry import normalize_address_line


def installation_address_for_delivery(payload: dict | None) -> dict:
    """The installation address delivery must copy. Pure.

    Street: address.address_full (the unit select_address matched on the portal),
    else address.keywords, else the customer residence. Postcode and state prefer
    the address block; city and country come from the residence.
    """
    payload = payload or {}
    cust = payload.get("customer") or {}
    addr = payload.get("address") or {}

    def first(*values) -> str:
        return str(next((v for v in values if v), "")).strip()

    # order_to_payload falls back to the bare postcode for keywords. That is a
    # search key for select_address, not a street line.
    keywords = addr.get("keywords") or ""
    if not re.search(r"[a-z]", str(keywords), re.I):
        keywords = ""
    return {
        "street": normalize_address_line(first(
            addr.get("address_full"), keywords,
            cust.get("residence_street"), cust.get("residence_address"))),
        "postcode": first(addr.get("postcode"), cust.get("residence_postcode")),
        "city": first(cust.get("residence_city")),
        "state": first(addr.get("state"), cust.get("residence_state")),
        "country": first(cust.get("residence_country"), "Malaysia"),
    }


# The dialog the checkbox opens: the same widget as the residence pop-edit
# (order_entry.fill_residence_address), found by its title so no other open
# dialog is ever filled. Field selectors are the residence modal's stable js-*
# classes first, then the field's printed label.
_DIALOG = '.ui-dialog:visible:has-text("Enter Address")'
_FIELDS = {
    "postcode": ('input.js-Postcode',
                 '.form-group:has-text("Postcode") input.form-control'),
    "street": ('input.form-control[aria-required="true"]:not(.js-countries)'
               ':not(.js-Postcode):not(.js-city):not(.js-state):not([role="combobox"])',
               '.form-group:has-text("Address") input.form-control'),
    "city": ('input.js-city', '.form-group:has-text("City") input.form-control'),
    "state": ('input.js-state', '.form-group:has-text("State") input.form-control'),
}
_OK = re.compile(r"^\s*ok\s*$", re.I)


def _error(code: str, message: str) -> dict:
    return {"status": "error", "stage": "delivery_terms", "error": code, "message": message}


async def _editable_field(dialog, key: str):
    for selector in _FIELDS[key]:
        field = dialog.locator(selector).first
        if await field.count() and await field.is_visible() and await field.is_editable():
            return field
    return None


async def _invalid_field_labels(dialog) -> list[str]:
    labels = []
    for field in await dialog.locator("input.n-invalid, .has-error input").all():
        labels.append(await field.evaluate(
            "i => { const g = i.closest('.form-group'), l = g && g.querySelector('label');"
            " return ((l && l.innerText) || i.name || '').trim(); }"))
    return [label for label in labels if label]


async def set_delivery_address(frame, page, payload: dict | None) -> dict:
    """Make the delivery address the order's installation address.

    Tick (or re-tick) Default From Billing Address to open Enter Address, rewrite
    postcode + street (and City/State when the portal leaves them editable) from
    installation_address_for_delivery, OK, and confirm the dialog closed.
    Returns {"status": "ok", "detail": ...} or {"status": "error", "stage",
    "error", "message"}; never falls through with the billing address in place.
    """
    addr = installation_address_for_delivery(payload)
    if not addr["street"]:
        return _error("delivery_address_missing_installation",
                      "The order carries no installation street, so the delivery "
                      "address cannot be copied from it. Refusing to leave the "
                      "billing address as the delivery address.")
    try:
        return await _fill_from_installation(frame, page, addr)
    except Exception as e:  # noqa: BLE001 - a Playwright timeout is a named step failure
        return _error("delivery_address_failed",
                      f"Setting the delivery address from the installation address "
                      f"failed: {type(e).__name__}: {str(e)[:160]}")


async def _fill_from_installation(frame, page, addr: dict) -> dict:
    box = frame.locator('input[name="defaultBillingAddress"]').first
    if not await box.count():
        return _error("delivery_address_checkbox_missing",
                      "No 'Default From Billing Address' checkbox on the Customer Order "
                      "Information page, so the Enter Address dialog could not be "
                      "opened to set delivery = installation.")
    # A ticked box means the dialog was already accepted with the billing
    # address. Only ticking opens it, so untick first to get it back.
    if await box.is_checked():
        await box.uncheck(timeout=5000)
        await asyncio.sleep(0.8)
    await box.check(timeout=5000)
    dialog = frame.locator(_DIALOG).first
    try:
        await dialog.wait_for(state="visible", timeout=8000)
    except Exception:
        return _error("delivery_address_dialog_missing",
                      "Ticking Default From Billing Address did not open the Enter "
                      "Address dialog, so the delivery address was not set.")
    await asyncio.sleep(0.8)

    filled = []
    # Postcode first, TYPED and tabbed out: the portal fills the disabled City
    # and State from it on blur (fill_residence_address, verified live).
    if addr["postcode"]:
        postcode = await _editable_field(dialog, "postcode")
        if postcode is None:
            return _error("delivery_address_not_set",
                          "The Enter Address dialog has no editable Postcode field, so "
                          "the installation postcode could not be written.")
        await postcode.fill("")
        await postcode.press_sequentially(addr["postcode"], delay=40)
        await postcode.press("Tab")
        await asyncio.sleep(1.5)
        filled.append("postcode")
    street = await _editable_field(dialog, "street")
    if street is None:
        return _error("delivery_address_not_set",
                      "The Enter Address dialog has no editable Address field, so the "
                      "installation street could not be written.")
    await street.fill(addr["street"])
    filled.append("street")
    for key in ("city", "state"):
        field = await _editable_field(dialog, key)
        if field is not None and addr[key]:
            await field.fill(addr[key])
            filled.append(key)

    await dialog.locator("button, a.btn").filter(has_text=_OK).first.click(timeout=5000)
    await asyncio.sleep(1)
    # The validator refuses silently: the dialog stays open with the field
    # marked n-invalid (tests/test_address_line.py). Name it instead of walking
    # on with the billing address still in place.
    if await dialog.count():
        rejected = await _invalid_field_labels(dialog)
        detail = f" Rejected: {', '.join(rejected)}." if rejected else ""
        return _error("delivery_address_rejected",
                      f"The Enter Address dialog refused OK, so the delivery address is "
                      f"not the installation address.{detail} Sent: {addr['street']!r}, "
                      f"postcode {addr['postcode']!r}.")
    order = [k for k in ("street", "postcode", "city", "state") if k in filled]
    return {"status": "ok", "detail": f"ok (from installation: {', '.join(order)})"}

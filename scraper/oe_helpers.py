"""
oe_helpers.py - The 3 reusable primitives the whole order flow rests on.

Everything below operates on a Playwright `FrameLocator` for the order app's
iframe (`page.frame_locator("#myIframe")`). The inner app is jQuery UI +
Bootstrap 3, so the three recurring shapes are:

  1. combobox  -> set_combobox()      (paired visible/hidden input + dropdown)
  2. jqGrid    -> select_grid_row()   (results tables: address, offers, VoBB)
  3. dialog    -> check_error() + wait_dialog/close_dialog/newest_dialog

The error helper (`check_error`) returns a result dict shaped for the
orchestrator; the other primitives raise on their own not-found conditions and
let the orchestrator translate them.
"""

import asyncio

from playwright.async_api import FrameLocator, TimeoutError as PWTimeout

from oe_errors import ADDRESS_NOT_FOUND, map_error

# Default wait for AJAX-driven UI to settle (ms). This app is slow.
DEFAULT_TIMEOUT = 15000


class GridEmptyError(Exception):
    """Raised by select_grid_row when the grid shows 'No record to view'."""

    def __init__(self, error_code: str = ADDRESS_NOT_FOUND, message: str = ""):
        self.error_code = error_code
        self.message = message or "Grid is empty (no record to view)."
        super().__init__(self.message)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Combobox
# ─────────────────────────────────────────────────────────────────────────────
async def set_combobox(
    frame: FrameLocator,
    field_name: str,
    option_text: str,
    timeout: int = DEFAULT_TIMEOUT,
    nth: int = 0,
    hidden_selector: str | None = None,
    scope=None,
) -> None:
    """
    Set a `---Please select---` combobox by its hidden input's `name`.

    Verified live DOM shape:

        <div class="input-group ...">              <- shared wrapper
          <div class="input-group ui-combobox-fish">
            <input role="combobox" placeholder="---Please select---">  <- display
          </div>
          <input name="<field_name>" style="display:none">  <- hidden value (SIBLING)
        </div>

    The hidden named input is a *sibling* of the `.ui-combobox-fish` div, so we
    anchor on the hidden input and climb to its parent. The dropdown is opened by
    clicking the caret (`.input-group-addon`), NOT the display input — a click on
    the display input alone does not open it (verified live). Then:

      1. click the caret to open the menu (`ul.combobox-dropdown`, appended to body)
      2. wait for it to be visible
      3. click `li[title="<option_text>"]`
      4. assert the hidden input now carries a value

    `nth` disambiguates duplicate field names (e.g. certTypeId exists in both the
    Read Card panel and the contact form). Raises on missing field/option or an
    empty value after the click.
    """
    print(f"→ set_combobox {field_name!r} = {option_text!r}")
    # The visible combobox input (role="combobox") and the caret both live inside
    # the .ui-combobox-fish div; the hidden value input is its SIBLING. Anchor on
    # the hidden input, climb to its parent wrapper, and reach back down for the
    # display input + caret. `hidden_selector` lets callers target a field whose
    # name is obfuscated (e.g. the address modal) by a stable class instead.
    # `scope` narrows the anchor search to one dialog. Needed when the same
    # field name exists in several stacked dialogs (the attach-time create:
    # Advanced Query's search fields are literally certNbr/custName, so an
    # unscoped nth(0) can anchor on a hidden leftover and time out).
    if hidden_selector:
        hidden = (scope or frame).locator(hidden_selector).nth(nth)
        wrap = hidden.locator("xpath=..")
        disp = wrap.locator('input[role="combobox"]').first
        caret = wrap.locator('span.input-group-addon').first
    elif scope is not None:
        hidden = scope.locator(f'input[name="{field_name}"]').nth(nth)
        wrap = hidden.locator("xpath=..")
        disp = wrap.locator('input[role="combobox"]').first
        caret = wrap.locator('span.input-group-addon').first
    else:
        hidden = frame.locator(f'input[name="{field_name}"]').nth(nth)
        wrap_xpath = f'(//input[@name="{field_name}"])[{nth + 1}]/parent::*'
        disp = frame.locator(f'xpath={wrap_xpath}//input[@role="combobox"]').first
        caret = frame.locator(
            f'xpath={wrap_xpath}//span[contains(@class,"input-group-addon")]'
        ).first

    # Some attribute fields are plain hidden inputs (no combobox widget) or live
    # in a display:none block — they carry no interactive dropdown. If this field
    # has no visible combobox display input, skip it gracefully.
    try:
        await disp.wait_for(state="visible", timeout=timeout)
    except Exception:
        print(f"  ↳ '{field_name}' has no visible combobox (hidden/plain field) — skipping.")
        return

    # Selecting an upstream combobox (e.g. ID Type) re-renders the form, so the
    # next field's widget may not be wired yet. Wait for the display input to be
    # enabled before interacting.
    disabled = True
    for _ in range(20):
        try:
            disabled = await disp.is_disabled()
            if not disabled:
                break
        except Exception:
            pass
        await asyncio.sleep(0.3)
    if disabled:
        # The portal auto-manages this field (e.g. Nationality is derived from the
        # ID and locked). Nothing to set — leave the portal's value in place.
        print(f"  ↳ '{field_name}' is disabled/auto-managed — skipping.")
        return
    await disp.scroll_into_view_if_needed(timeout=timeout)

    # The open dropdown is the only visible ul.combobox-dropdown (each field has
    # its own, hidden until opened). Check-before-click so a retry never toggles
    # an open menu shut; force-click to bypass any transient re-render overlay;
    # wait_for(visible) rather than sleep-and-poll so we catch it deterministically.
    vis_menu = frame.locator("ul.combobox-dropdown:visible").last
    menu = None
    last_err: Exception | None = None
    for attempt in range(8):
        try:
            if await vis_menu.count() > 0:
                menu = vis_menu
                break
        except Exception:
            pass
        target = caret if attempt % 2 == 0 else disp
        try:
            await target.click(timeout=4000, force=True)
        except Exception as e:
            last_err = e
        try:
            await vis_menu.wait_for(state="visible", timeout=2500)
            menu = vis_menu
            break
        except Exception as e:
            last_err = e
    if not menu:
        raise RuntimeError(
            f"set_combobox: '{field_name}' (nth={nth}) dropdown didn't open after "
            f"retries — caret not visible/rendered (wrong tab/section?). "
            f"{type(last_err).__name__ if last_err else ''}"
        ) from last_err

    option = menu.locator(f'li[title="{option_text}"]').first
    try:
        await option.click(timeout=timeout)
    except Exception as e:
        raise RuntimeError(
            f"set_combobox: '{field_name}' has no option titled '{option_text}'. {type(e).__name__}"
        ) from e

    # Sanity check: the hidden input should now carry a value.
    value = await hidden.input_value()
    if not value:
        raise RuntimeError(
            f"set_combobox: '{field_name}' still empty after selecting "
            f"'{option_text}'. Option may not have matched."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. jqGrid row selection
# ─────────────────────────────────────────────────────────────────────────────
async def select_grid_row(
    frame: FrameLocator,
    grid_selector: str,
    match_text: str | None = None,
    row_id: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> None:
    """
    Select a row in a jqGrid (address results, offer list, VoBB numbers, ...).

    Pass exactly one of:
      - match_text: clicks the row whose any `<td title="...">` matches.
      - row_id:     clicks `tr.jqgrow#<row_id>` (row id == the entity id, e.g.
                    an offer id).

    Before selecting, checks the grid's empty state (`.ui-jqgrid-tip` with
    "No record to view") and raises GridEmptyError so the caller can return a
    not-found error.
    """
    if (match_text is None) == (row_id is None):
        raise ValueError("select_grid_row: pass exactly one of match_text / row_id")

    grid = frame.locator(grid_selector).first
    await grid.wait_for(state="visible", timeout=timeout)

    # Empty-state check first.
    tip = frame.locator(f"{grid_selector} .ui-jqgrid-tip, .ui-jqgrid-tip").first
    if await tip.count() > 0 and await tip.is_visible():
        text = (await tip.inner_text()).strip().lower()
        if "no record" in text:
            raise GridEmptyError(message=(await tip.inner_text()).strip())

    if row_id is not None:
        row = frame.locator(f"{grid_selector} tr.jqgrow#{row_id}").first
    else:
        row = frame.locator(
            f'{grid_selector} tr.jqgrow:has(td[title="{match_text}"])'
        ).first

    try:
        await row.wait_for(state="visible", timeout=timeout)
    except PWTimeout:
        raise GridEmptyError(
            message=(
                f"No row matched "
                f"{'id=' + row_id if row_id else 'text=' + repr(match_text)} "
                f"in {grid_selector}."
            )
        )

    await row.click(timeout=timeout)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Dialog helpers + the error check
# ─────────────────────────────────────────────────────────────────────────────
def newest_dialog(frame: FrameLocator):
    """The last (newest) open `.ui-dialog` inside the iframe."""
    return frame.locator(".ui-dialog").last


async def wait_dialog(
    frame: FrameLocator, title_text: str, timeout: int = DEFAULT_TIMEOUT
):
    """Wait for a `.ui-dialog` whose `.modal-title` contains `title_text`."""
    dialog = frame.locator(
        f'.ui-dialog:has(.modal-title:has-text("{title_text}"))'
    ).last
    await dialog.wait_for(state="visible", timeout=timeout)
    return dialog


async def close_dialog(frame: FrameLocator) -> None:
    """Dismiss the newest dialog via its close affordance, if present."""
    dialog = newest_dialog(frame)
    if await dialog.count() == 0:
        return
    for sel in [".modal-footer .btn-danger", ".modal-footer .btn", ".close", ".ui-dialog-titlebar-close"]:
        btn = dialog.locator(sel).first
        if await btn.count() > 0 and await btn.is_visible():
            await btn.click()
            return


async def check_error(frame: FrameLocator, stage: str) -> dict | None:
    """
    Call after EVERY Query/Next/OK/Pay action.

    If an error dialog (`.ui-dialog.modal-danger`) is open: read its message,
    map it to a code, dismiss it, and return an error result dict. Otherwise
    return None (no error).

    The returned dict carries the verbatim message so the caller can log
    unmapped (`unknown_error`) cases for later mapping.
    """
    danger = frame.locator(".ui-dialog.modal-danger").last
    if await danger.count() == 0 or not await danger.is_visible():
        return None

    msg = (await danger.locator(".modal-message").inner_text()).strip()
    code = map_error(msg)

    # Dismiss so the flow can continue / unwind cleanly.
    dismiss = danger.locator(".modal-footer .btn-danger").first
    if await dismiss.count() > 0 and await dismiss.is_visible():
        await dismiss.click()

    return {"status": "error", "error": code, "message": msg, "stage": stage}

"""
order_entry.py - Automated Unifi eSales Order Entry (CRM crm-TYMH100163).

Public entrypoint:

    await enter_order(payload, dry_run=True) -> dict

Returns one of:
    {"status": "success", "order_id": "2503000062852562"}
    {"status": "error", "error": "address_already_has_service",
     "message": "...", "screenshot": "logs/err_...png", "stage": "feasibility"}
    {"status": "dry_run", "would_submit": {...}, "screenshot": "...", "fees": {...}}

SAFETY: `dry_run=True` is the default. This flow submits real, billable orders.
Dry-run walks every step, fills every field, stops BEFORE the final Pay/Submit,
captures a screenshot + fee preview, and returns what it would submit. Only
`dry_run=False` clicks Pay/Submit.

Expected flow failures (MSR, address-taken, validation) are returned as
status=error and never raise. Only infrastructure failures (browser launch,
lost session) raise, so the caller can retry.

Run from the project root so config/ and sessions/ resolve.

Auth, stealth, and the iframe machinery are reused as-is from login_manager /
oe_helpers — see SELECTOR_MAP.md and context/features/order-entry-build-spec.md.
"""

import asyncio
import os
from datetime import datetime

import dealer_web_login
import login_manager
from credential_manager import CredentialManager
from oe_errors import ADDRESS_NOT_FOUND
from oe_helpers import (
    GridEmptyError,
    check_error,
    select_grid_row,
    set_combobox,
)

ORDER_ENTRY_URL = "https://dealer.unifi.com.my/esales/crm-TYMH100163"
IFRAME_SELECTOR = "#myIframe"
LOGS_DIR = "logs"


class InfraError(RuntimeError):
    """Infrastructure failure (browser/session). Caller may retry."""


# ─────────────────────────────────────────────────────────────────────────────
# Small shared utilities
# ─────────────────────────────────────────────────────────────────────────────
def _ts() -> str:
    # datetime.now() is fine here (real process, not a workflow sandbox).
    return datetime.now().strftime("%Y%m%d_%H%M%S")


async def _screenshot(page, label: str) -> str:
    os.makedirs(LOGS_DIR, exist_ok=True)
    path = os.path.join(LOGS_DIR, f"{label}_{_ts()}.png")
    try:
        await page.screenshot(path=path, full_page=True)
    except Exception as e:
        return f"(screenshot failed: {e})"
    return path


async def _err(page, result: dict) -> dict:
    """Attach a screenshot path to an error result dict."""
    if "screenshot" not in result:
        result["screenshot"] = await _screenshot(page, f"err_{result.get('stage', 'unknown')}")
    return result


def _frame(page):
    return page.frame_locator(IFRAME_SELECTOR)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 0 — make sure we're on the Order Entry screen (outer page)
# ─────────────────────────────────────────────────────────────────────────────
async def ensure_on_order_entry(page) -> dict:
    """
    Navigate to the Order Entry CRM and clear any blocking announcement modal.
    Raises InfraError if we land on login/no-devtool (session lost / detector).
    """
    await page.goto(ORDER_ENTRY_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)

    if "no-devtool" in page.url.lower() or "login" in page.url.lower():
        raise InfraError(
            f"Landed on {page.url} — session invalid or anti-bot detector fired."
        )

    # Clear the 'Later'/announcement modal on the outer (Ant) shell.
    try:
        modal = page.locator(".ant-modal-wrap")
        if await modal.count() > 0 and await modal.first.is_visible():
            for sel in (
                'button.ant-btn:has-text("Later")',
                ".ant-modal-close",
                'button.ant-btn:has-text("Cancel")',
                'button.ant-btn:has-text("Close")',
            ):
                btn = page.locator(sel)
                if await btn.count() > 0 and await btn.first.is_visible():
                    await btn.first.click()
                    await page.wait_for_timeout(800)
                    break
    except Exception:
        pass

    # Confirm the order iframe is present.
    try:
        await page.wait_for_selector(IFRAME_SELECTOR, timeout=15000)
    except Exception:
        raise InfraError("Order Entry iframe (#myIframe) never appeared.")

    # The CCEntryView app inside the iframe is slow + AJAX-heavy (~10s). Wait for
    # a real content anchor (the shopping bar) before any stage runs — the
    # iframe element appears long before its app renders.
    try:
        await _frame(page).locator(".js-anonymous-add-survey").first.wait_for(
            state="visible", timeout=45000
        )
    except Exception:
        raise InfraError(
            "Order Entry app never rendered inside #myIframe (shopping bar not visible)."
        )

    return {"status": "ok", "stage": "ensure_on_order_entry"}


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — create personal customer  (MAPPED — SELECTOR_MAP §3)
# ─────────────────────────────────────────────────────────────────────────────
async def _check_duplicate_records(frame) -> str | None:
    """Detect an existing-customer popup after entering an ID already in the CRM:
    either the "Multiple customer records found…" Confirm, OR the "Customer with
    the ID Type and ID Number already exists in the system." Error (modal-danger).

    Returns its message (the caller maps it to the customer-reuse path so
    feasibility attaches the existing customer instead of creating a duplicate).
    The Error variant COVERS the form, so we dismiss it; the Confirm variant is
    left as-is (feasibility re-navigates past it).
    """
    try:
        for _ in range(16):
            marker = frame.get_by_text("Multiple customer records", exact=False).first
            if await marker.count() > 0 and await marker.is_visible():
                return (await marker.inner_text()).strip()
            exists = frame.get_by_text("already exists", exact=False).first
            if await exists.count() > 0 and await exists.is_visible():
                msg = (await exists.inner_text()).strip()
                # Dismiss the blocking Error popup so it doesn't cover the form /
                # intercept the next clicks (this is why Race combobox timed out).
                for sel in ('.ui-dialog.modal-danger .btn-danger',
                            '.ui-dialog:visible .btn-danger',
                            '.ui-dialog:visible button:has-text("OK")'):
                    try:
                        btn = frame.locator(sel).first
                        if await btn.count() > 0 and await btn.is_visible():
                            await btn.click(timeout=3000)
                            break
                    except Exception:
                        pass
                return msg
            await asyncio.sleep(0.3)
    except Exception as e:
        print(f"  ↳ dup-dialog check: {e}")
    return None


async def fill_residence_address(frame, customer: dict) -> None:
    """Fill the required Residence Address via its pop-edit modal.

    The residence field (input[name="address"].js-address) is readonly; clicking
    its .glyphicon-new-window expand icon opens a modal (form.js-detail-form) with
    Country (combobox) + Postcode (auto-fills City/State) + Address (street). The
    modal's field names are obfuscated ("counSplittry"/"PostSplitcode"/...), so we
    target stable js-* classes instead.
    """
    postcode = (customer.get("residence_postcode") or "").strip()
    street = (customer.get("residence_street") or customer.get("residence_address") or "").strip()
    country = (customer.get("residence_country") or "Malaysia").strip()
    if not (postcode or street):
        print("  ↳ no residence address data — skipping.")
        return

    # Open the modal via the expand icon next to the customer-form residence input.
    addr_input = frame.locator('input[name="address"].js-address').first
    caret = addr_input.locator(
        'xpath=following-sibling::span[contains(@class,"input-group-addon")]'
    ).first
    await caret.click(timeout=10000, force=True)
    modal = frame.locator("form.js-detail-form").first
    await modal.wait_for(state="visible", timeout=15000)
    await asyncio.sleep(0.8)

    # Country — combobox keyed by the stable js-countries class.
    await set_combobox(
        frame, "country", country,
        hidden_selector="form.js-detail-form input.js-countries",
    )

    # Postcode — typing it (plus a blur) auto-fills the disabled City + State.
    pc = modal.locator("input.js-Postcode").first
    await pc.fill("")
    await pc.type(postcode, delay=40)
    await pc.press("Tab")
    await asyncio.sleep(1.5)

    # Street address — the required plain text input in the modal that isn't
    # Country / Postcode / City / State / a combobox display.
    street_input = modal.locator(
        'input.form-control[aria-required="true"]'
        ':not(.js-countries):not(.js-Postcode):not(.js-city):not(.js-state)'
        ':not([role="combobox"])'
    ).first
    await street_input.fill(street)

    # Confirm the modal (button text varies — try the common ones, scoped to the
    # dialog that hosts the address form).
    dialog = frame.locator('.ui-dialog:has(form.js-detail-form)').first
    confirmed = False
    for label in ("OK", "Confirm", "Save", "Submit", "Done"):
        btn = dialog.locator(f'button:has-text("{label}")').first
        try:
            if await btn.count() > 0 and await btn.is_visible():
                await btn.click(timeout=5000)
                confirmed = True
                print(f"  ↳ residence modal confirmed via '{label}'.")
                break
        except Exception:
            continue
    if not confirmed:
        print("  ⚠ residence modal: no confirm button matched — left open.")
    await asyncio.sleep(0.8)
    try:
        val = await addr_input.input_value()
        print(f"  ↳ residence address now: {val!r}")
    except Exception:
        pass


async def _upload_id_documents(frame, customer: dict) -> None:
    """Upload the required "Customer ID copy" attachment (doctypeid="2").

    Files come from a local path (customer["id_doc_path"], for testing) or the
    order's R2 keys (customer["id_doc_keys"]), which are downloaded to temp files.
    The row's <input type=file> is set directly (no need to click the button).
    """
    files: list[str] = []
    local = customer.get("id_doc_path")
    if local:
        files = [local] if isinstance(local, str) else list(local)
    elif customer.get("id_doc_keys"):
        try:
            from r2_download import download_many
            files = download_many(list(customer["id_doc_keys"]))
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ could not fetch ID docs from R2: {e}")

    if not files:
        print("  ↳ no ID-copy document provided — attachment left empty.")
        return

    file_input = frame.locator(
        'li.js-attach-item[doctypeid="2"] input[type="file"].fileupload-select'
    ).first
    await file_input.set_input_files(files)
    # Wait for the upload to register (a file chip appears in the list container).
    container = frame.locator(
        'li.js-attach-item[doctypeid="2"] .js-files-container'
    ).first
    for _ in range(20):
        try:
            if (await container.inner_text()).strip():
                break
        except Exception:
            pass
        await asyncio.sleep(0.5)
    print(f"  ↳ uploaded {len(files)} ID-copy file(s).")


async def create_personal_customer(frame, customer: dict, fill_only: bool = False) -> dict:
    """
    Open the customer-type picker, choose Personal Customer, fill the profile
    (Basic Info + customer attributes + Contact tab), attach the ID doc, submit.

    Contact-form lookups are scoped to `form.js-qry-form` because certTypeId /
    certNbr also exist in the Read Card panel (SELECTOR_MAP warning).

    fill_only=True fills every field but does NOT click Submit (.js-ok), so a
    first dry-run can verify the field mapping without creating a real customer
    record (and without hitting the required ID-copy attachment). Returns
    status="filled" in that mode.
    """
    # Open the customer creator (verified live; not in the original SELECTOR_MAP):
    #   1. click the (initially empty) order-search box to render the search bar
    #   2. click the "Create New Customer" (+) button -> opens the type picker
    #   3. choose Personal Customer
    await frame.locator(".js-order-search").first.click()
    await frame.locator(".js-add-cust-btn").first.click()
    await frame.locator(".show-customer-left").first.wait_for(state="visible", timeout=15000)
    await frame.locator(".show-customer-left").first.click()

    # --- Basic Information (form.js-cust-form) ---
    await set_combobox(frame, "certTypeId", customer["id_type"])
    await frame.locator('input[name="certNbr"]').first.fill(customer["id_number"])
    await frame.locator('input[name="custName"]').first.fill(customer["name"])

    # MyKad-like IDs: the portal auto-derives Gender + Birthday from the ID number
    # and locks those fields, so their widgets won't accept input. Wait for the
    # auto-fill, then skip both. Non-MyKad IDs (passport, etc.) aren't derived, so
    # fill them manually.
    # Entering the ID number may trigger a "Multiple customer records found for
    # this ID type and ID number" dialog when the IC already exists in the CRM.
    # That's a real business condition — stop and surface it rather than create a
    # duplicate. (A future enhancement can offer to select the existing customer.)
    dup_warning = await _check_duplicate_records(frame)
    if dup_warning:
        print(f"  ⚠ {dup_warning}")
        return {
            "status": "warning",
            "stage": "create_personal_customer",
            "error": "multiple_customer_records",
            "warning": dup_warning,
            "message": dup_warning,
        }

    id_type = (customer.get("id_type") or "").strip().lower()
    mykad_like = id_type in {"mykad", "mykas", "mytentera"}
    if mykad_like:
        gender_hidden = frame.locator('input[name="gender"]').first
        for _ in range(20):
            if await gender_hidden.input_value():
                break
            await asyncio.sleep(0.3)
        print("  ↳ MyKad: Gender + Birthday auto-derived from ID — skipping manual set.")
    else:
        await set_combobox(frame, "gender", customer["gender"])
        # Date fields open a jQuery UI datepicker on focus; fill then dismiss it
        # with Escape so its overlay doesn't intercept later clicks.
        birthday = frame.locator('input[name="birthdayDay"]').first
        await birthday.fill(customer["birthday"])
        await birthday.press("Escape")

    await set_combobox(frame, "name_400011", customer["race"])
    await set_combobox(frame, "name_400020", customer["nationality"])
    await set_combobox(frame, "custDefLangId", customer["preferred_language"])

    # Customer Type: the <select name="custType"> lives in a display:none wrapper
    # ("temporarily only support personal customer") and already defaults to
    # "A" (Individual, selected). It's hidden and pre-set, so don't touch it.

    # Residence Address (required) — readonly input opened via the expand icon
    # into a pop-edit modal (Country + Postcode auto-fills City/State + street).
    await fill_residence_address(frame, customer)

    # --- Customer attributes (.js-cust-attr-form) ---
    await set_combobox(frame, "name_400054", customer["customer_tenure"])
    await set_combobox(frame, "name_410013", customer["sub_segment"])
    await set_combobox(frame, "name_410011", customer["segment"])
    await set_combobox(frame, "name_410008", customer["segment_code"])

    # --- Contact Information (scope to form.js-qry-form to avoid name collisions) ---
    contact = customer["contact"]
    contact_form = frame.locator("form.js-qry-form")
    await contact_form.locator('input[name="contactManName"]').first.fill(contact["name"])
    await set_combobox(frame, "mainComm", contact["preferred_contact"])
    await set_combobox(frame, "roleType", contact["role"])
    await set_combobox(frame, "contactManType", contact.get("contact_man_type", contact["role"]))
    # Mobile: the number field (mobilePhone) is disabled until a valid area code
    # (portal example "eg.60") is entered. .fill() sets the value but may not fire
    # the keyup the validator listens for, so type it and blur to enable the
    # number field, then wait for it to become editable.
    area = contact_form.locator('input[name="mobileAreaCode"]').first
    await area.fill("")
    await area.type(contact["mobile_prefix"] or "60", delay=40)
    await area.press("Tab")
    phone = contact_form.locator('input[name="mobilePhone"]').first
    for _ in range(20):
        try:
            if not await phone.is_disabled():
                break
        except Exception:
            pass
        await asyncio.sleep(0.3)
    await phone.fill(contact["mobile"])
    await contact_form.locator('input[name="emailAddr"]').first.fill(contact["email"])

    # --- Attachment: required "Customer ID copy" (li[doctypeid="2"]) ---
    # The row has a real <input type=file class=fileupload-select multiple>, so we
    # set files directly. Source: a local path (id_doc_path, for testing) or the
    # order's R2 keys (id_doc_keys) downloaded on the fly.
    await _upload_id_documents(frame, customer)

    # Fill-only dry run: stop here without saving (no real customer created).
    if fill_only:
        return {"status": "filled", "stage": "create_personal_customer"}

    # Submit profile (this CREATES a real customer). Verified live: .js-ok fires
    # the app's validation — an incomplete form shows a "data is incomplete"
    # Warning and creates nothing; a complete one shows "...successfully created".
    await frame.locator(".js-ok").first.click()
    return await _await_customer_create_result(frame)


async def _await_customer_create_result(frame, timeout_s: int = 40) -> dict:
    """After clicking .js-ok, resolve the customer-create outcome:

      - success: a "...successfully created" dialog  -> {status: ok, created: True}
      - validation: "The data is incomplete..." Warning -> {status: error, ...}
      - timeout: neither appeared                     -> {status: error, ...}

    Dismisses the outcome dialog before returning so the flow can continue/unwind.
    """
    stage = "create_personal_customer"
    outcome = None
    for _ in range(timeout_s * 2):
        try:
            succ = frame.get_by_text("successfully created", exact=False).first
            if await succ.count() > 0 and await succ.is_visible():
                msg = (await succ.inner_text()).strip()
                outcome = {"status": "ok", "stage": stage, "created": True,
                           "message": msg or "Customer profile created."}
                break
        except Exception:
            pass
        try:
            warn = frame.locator(".ui-dialog").filter(has_text="incomplete").first
            if await warn.count() > 0 and await warn.is_visible():
                try:
                    msg = (await warn.locator(".modal-message, .modal-body").first.inner_text()).strip()
                except Exception:
                    msg = "The data is incomplete."
                outcome = {"status": "error", "stage": stage,
                           "error": "customer_data_incomplete", "message": msg}
                break
        except Exception:
            pass
        # Any other error dialog (modal-danger) — map it.
        err = await check_error(frame, stage)
        if err:
            return err
        await asyncio.sleep(0.5)

    if outcome is None:
        outcome = {"status": "error", "stage": stage, "error": "customer_create_timeout",
                   "message": "No success or validation dialog appeared after clicking OK."}

    # Dismiss the outcome dialog (OK button) so the app returns to a clean state.
    try:
        await frame.locator(
            ".ui-dialog:visible .modal-footer button, .ui-dialog:visible button.btn"
        ).first.click(timeout=3000)
    except Exception:
        pass
    return outcome


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — open Feasibility Check  (MAPPED)
# ─────────────────────────────────────────────────────────────────────────────
async def open_feasibility(frame) -> dict:
    await frame.locator(".js-anonymous-add-survey").first.click()
    return {"status": "ok", "stage": "open_feasibility"}


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — select address  (MAPPED — SELECTOR_MAP §4b)
# ─────────────────────────────────────────────────────────────────────────────
async def select_address(frame, address: dict) -> dict:
    """
    Open the Select Address modal (via .js-address-pop), search, and pick a row.
    Returns address_not_found when the grid is empty.
    """
    await frame.locator(".js-address-pop").first.click()

    # Customer Type + State are required comboboxes.
    if address.get("customer_type"):
        await set_combobox(frame, "custType", address["customer_type"])
    await set_combobox(frame, "state", address["state"])

    # Search type tabs (default: By keyword).
    search_type = address.get("search_type", "By keyword")
    tab = {
        "By keyword": "#byKeywords",
        "By Street": "#byStreetName",
        "By Building": "#byBuildName",
        "By Address Id": "#byAddressId",
    }.get(search_type, "#byKeywords")
    await frame.locator(tab).first.click()

    if search_type == "By keyword":
        await frame.locator('input[name="keywords"]').first.fill(address["keywords"])

    # Run the query, then check for the address-already-has-service warning.
    await frame.locator(".js-query").first.click()
    err = await check_error(frame, stage="feasibility")
    if err:
        return err

    # Pick the requested row (by text or index 0 default) from the results grid.
    try:
        if address.get("pick_text"):
            await select_grid_row(frame, ".js-address-grid", match_text=address["pick_text"])
        else:
            # Default: first data row.
            row = frame.locator(".js-address-grid tr.jqgrow").first
            tip = frame.locator(".js-address-grid .ui-jqgrid-tip, .ui-jqgrid-tip").first
            if await tip.count() > 0 and await tip.is_visible():
                text = (await tip.inner_text()).strip().lower()
                if "no record" in text:
                    raise GridEmptyError(message=(await tip.inner_text()).strip())
            await row.click()
    except GridEmptyError as e:
        return {"status": "error", "error": ADDRESS_NOT_FOUND, "message": e.message, "stage": "feasibility"}

    # Confirm the selection.
    await frame.locator(".js-ok").first.click()
    err = await check_error(frame, stage="feasibility")
    if err:
        return err

    return {"status": "ok", "stage": "select_address"}


# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 — select main offer  (MAPPED — SELECTOR_MAP §4c)
# ─────────────────────────────────────────────────────────────────────────────
async def select_main_offer(frame, plan: dict) -> dict:
    """
    Open the Main Offer Selector (pencil in .js-shrink-body), pick the category
    node, select the plan row, submit.
    """
    # The pencil only appears after an address is selected.
    await frame.locator(".js-shrink-body .glyphicon-new-window").first.click()

    # Optionally search across all categories.
    if plan.get("all_categories"):
        await frame.locator("input.js-all-catg").first.check()

    # Pick the category node by title.
    await frame.locator(
        f'.js-offerCatg-tree a.level0[title="{plan["category"]}"]'
    ).first.click()

    # Select the plan row by name, then submit.
    try:
        await select_grid_row(frame, ".js-offer-grid", match_text=plan["name"])
    except GridEmptyError as e:
        return {
            "status": "error",
            "error": "offer_not_found",
            "message": f"Plan '{plan['name']}' not found under '{plan['category']}': {e.message}",
            "stage": "main_offer",
        }

    await frame.locator(".js-btn-submit").first.click()
    err = await check_error(frame, stage="main_offer")
    if err:
        return err
    return {"status": "ok", "stage": "select_main_offer"}


# ─────────────────────────────────────────────────────────────────────────────
# Stage 5 — click Order
# ─────────────────────────────────────────────────────────────────────────────
async def click_order(frame) -> dict:
    await frame.locator(".js-orderNow").first.click()
    err = await check_error(frame, stage="order")
    if err:
        return err
    return {"status": "ok", "stage": "click_order"}


# ─────────────────────────────────────────────────────────────────────────────
# Stages 6-13 — NOT YET MAPPED. These must be captured during the first headed
# dry-run with oe_dump.dump_iframe_dialog() before they can be implemented.
# Each raises NotImplementedError so the flow can never silently submit a
# half-built order. enter_order() treats a NotImplementedError as a controlled
# "needs_capture" result, NOT an infra failure.
# ─────────────────────────────────────────────────────────────────────────────
class _NeedsCapture(NotImplementedError):
    """Raised by an unmapped stage; carries the stage name for reporting."""

    def __init__(self, stage: str):
        self.stage = stage
        super().__init__(f"Stage '{stage}' not yet mapped — capture DOM first.")


async def fill_install_info(frame, payload: dict) -> dict:
    raise _NeedsCapture("fill_install_info")  # slides 25-26


async def create_billing_account(frame, payload: dict) -> dict:
    raise _NeedsCapture("create_billing_account")  # slides 28-30 (NEW account each order)


async def set_broadband_login(frame, payload: dict) -> dict:
    raise _NeedsCapture("set_broadband_login")  # slide 31 (2-11 chars)


async def pick_vobb_number(frame) -> dict:
    raise _NeedsCapture("pick_vobb_number")  # slides 33-35


async def set_appointment(frame, payload: dict) -> dict:
    raise _NeedsCapture("set_appointment")  # slides 41-42


async def set_contactless_and_confirm(frame, payload: dict) -> dict:
    raise _NeedsCapture("set_contactless_and_confirm")  # slides 38, 44 (Contactless=YES)


async def read_fee_preview(frame) -> dict:
    """Best-effort read of the fee/AP/deposit preview before Pay (slide 46)."""
    # TODO(stage12): capture the fee panel selectors during dry-run.
    return {}


async def pay_and_submit(frame) -> dict:
    raise _NeedsCapture("pay_and_submit")  # slide 46 — only on dry_run=False


async def capture_order_id(frame) -> dict:
    raise _NeedsCapture("capture_order_id")  # slide 48 "Order Number: ..."


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────
async def enter_order(
    payload: dict, dry_run: bool = True, dump_on_capture: bool = False,
    user_key: str = None, stop_after_customer_fill: bool = False,
    stop_after_customer_create: bool = False,
) -> dict:
    """
    Drive the full order flow. See module docstring for the result contract.

    dry_run=True (default) stops before Pay/Submit and returns status="dry_run".
    Expected failures return status="error"; only infra failures raise.

    user_key (the BizzFlow user) selects that user's captured dealer session at
    sessions/dealer_<user_key>.json, so the order runs under the dealer account
    they connected. If omitted, falls back to the shared CredentialManager login
    (local dev/testing only) — production must always pass user_key.

    dump_on_capture=True (dev only) writes a structural DOM dump + screenshot of
    the current screen whenever an unmapped stage is reached, so stages 6-13 can
    be mapped from a single headed dry-run. No effect in production.
    """
    browser = context = pw = page = None
    try:
        try:
            if user_key:
                # Per-user path: drive the order with this user's saved portal
                # session (captured via the OTP connect flow) — not shared creds.
                import dealer_login_service
                import dealer_web_login

                session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
                # Land straight on Order Entry (skip the Retail History bounce).
                pw, browser, context, page = await dealer_web_login.open_context_from_session(
                    session_path, landing_url=ORDER_ENTRY_URL
                )
            else:
                cm = CredentialManager()
                if not cm.credentials_exist():
                    raise InfraError(
                        "No dealer session (pass user_key) and no stored credentials (config/)."
                    )
                creds = cm.get_credentials()
                browser, context, pw, page = await login_manager.login_and_get_context(
                    creds.get("username"), creds.get("password")
                )
        except InfraError:
            raise
        except Exception as e:
            raise InfraError(f"Login / session load failed: {e}") from e

        # Stage 0 — navigation (may raise InfraError on lost session).
        await ensure_on_order_entry(page)
        frame = _frame(page)

        # First-dry-run mode: fill the customer profile only, don't save. Verifies
        # stage-1 field mapping against a real session without creating a record.
        if stop_after_customer_fill:
            print("→ stage: create_personal_customer (fill_only)")
            try:
                result = await create_personal_customer(
                    frame, payload["customer"], fill_only=True
                )
            except Exception as e:
                if isinstance(e, InfraError):
                    raise
                return await _err(page, {
                    "status": "error",
                    "error": "stage_failed",
                    "stage": "create_personal_customer",
                    "message": f"{type(e).__name__}: {e}",
                })
            # The stage stopped early on a known condition (e.g. the customer
            # already exists) — surface it as a warning.
            if result.get("status") == "warning":
                shot = await _screenshot(page, "dry_run_customer_warning")
                return {
                    "status": "warning",
                    "stage": "create_personal_customer",
                    "error": result.get("error"),
                    "warning": result.get("warning"),
                    "message": result.get("message") or result.get("warning"),
                    "screenshot": shot,
                }
            err = await check_error(frame, "create_personal_customer")
            if err:
                return await _err(page, err)
            shot = await _screenshot(page, "dry_run_customer_fill")
            print(f"✓ customer form filled (not saved). Screenshot: {shot}")
            out = {
                "status": "dry_run",
                "stage": "create_personal_customer",
                "message": "Customer profile filled; stopped before save.",
                "screenshot": shot,
            }
            if result.get("warning"):
                out["warning"] = result["warning"]
            return out

        # "Order entry" mode (PDF pages 1-16): CREATE the customer profile for
        # real (fill + click OK to save), then STOP. This is what BizzFlow's
        # Submit triggers today — feasibility -> order id is a later step, run
        # separately. Creates a real (but not billed) customer record.
        if stop_after_customer_create:
            print("→ stage: create_personal_customer (REAL — saving profile)")
            try:
                result = await create_personal_customer(
                    frame, payload["customer"], fill_only=False
                )
            except Exception as e:
                if isinstance(e, InfraError):
                    raise
                return await _err(page, {
                    "status": "error", "error": "stage_failed",
                    "stage": "create_personal_customer",
                    "message": f"{type(e).__name__}: {e}",
                })
            # Duplicate-customer condition surfaced before OK.
            if result.get("status") == "warning":
                shot = await _screenshot(page, "customer_create_warning")
                return {
                    "status": "warning", "stage": "create_personal_customer",
                    "error": result.get("error"),
                    "warning": result.get("warning") or result.get("message"),
                    "message": result.get("message") or result.get("warning"),
                    "screenshot": shot,
                }
            # Validation failure / infra error from the OK-result checker.
            if result.get("status") == "error":
                return await _err(page, result)
            # Created successfully.
            shot = await _screenshot(page, "customer_created")
            print(f"✓ customer profile created. Screenshot: {shot}")
            return {
                "status": "success", "stage": "create_personal_customer",
                "customer_created": True,
                "message": result.get("message") or "Customer profile created.",
                "screenshot": shot,
            }

        # Full flow (feasibility -> order id -> ...). Stages 1-5 mapped; stop at
        # first non-OK result.
        ordered_stages = [
            ("create_personal_customer", lambda: create_personal_customer(frame, payload["customer"])),
            ("open_feasibility", lambda: open_feasibility(frame)),
            ("select_address", lambda: select_address(frame, payload["address"])),
            ("select_main_offer", lambda: select_main_offer(frame, payload["plan"])),
            ("click_order", lambda: click_order(frame)),
        ]
        for name, run in ordered_stages:
            print(f"→ stage: {name}")
            try:
                result = await run()
            except Exception as e:
                # A mapped stage hit something unexpected (selector timeout,
                # combobox option mismatch, etc.). Don't crash — report it as a
                # structured error with a screenshot so the caller can act and
                # we can refine selectors. Infra failures still raise.
                if isinstance(e, InfraError):
                    raise
                return await _err(page, {
                    "status": "error",
                    "error": "stage_failed",
                    "stage": name,
                    "message": f"{type(e).__name__}: {e}",
                })
            if result.get("status") != "ok":
                return await _err(page, result)

        # Stages 6-13 — not yet mapped. Run them; a _NeedsCapture means we've
        # reached the capture frontier (expected during build-out), so report it
        # cleanly instead of crashing.
        back_half = [
            ("fill_install_info", lambda: fill_install_info(frame, payload)),
            ("create_billing_account", lambda: create_billing_account(frame, payload)),
            ("set_broadband_login", lambda: set_broadband_login(frame, payload)),
            ("pick_vobb_number", lambda: pick_vobb_number(frame)),
            ("set_appointment", lambda: set_appointment(frame, payload)),
            ("set_contactless_and_confirm", lambda: set_contactless_and_confirm(frame, payload)),
        ]
        try:
            for name, run in back_half:
                print(f"→ stage: {name}")
                result = await run()
                if result.get("status") != "ok":
                    return await _err(page, result)
        except _NeedsCapture as nc:
            shot = await _screenshot(page, f"needs_capture_{nc.stage}")
            dump = None
            if dump_on_capture:
                from oe_dump import dump_iframe_dialog
                dump = await dump_iframe_dialog(page, nc.stage)
            return {
                "status": "needs_capture",
                "stage": nc.stage,
                "message": str(nc),
                "screenshot": shot,
                "dump": dump,
                "hint": "Run a headed dry-run and oe_dump.dump_iframe_dialog(page, '<stage>') to map this screen.",
            }

        # Stage 12 — fee preview + the dry-run safety stop.
        fees = await read_fee_preview(frame)
        if dry_run:
            shot = await _screenshot(page, "dry_run_before_pay")
            return {
                "status": "dry_run",
                "would_submit": payload,
                "fees": fees,
                "screenshot": shot,
            }

        # Real submission — only reached when dry_run is explicitly False.
        try:
            pay_result = await pay_and_submit(frame)
            if pay_result.get("status") != "ok":
                return await _err(page, pay_result)
            id_result = await capture_order_id(frame)
            return id_result
        except _NeedsCapture as nc:
            shot = await _screenshot(page, f"needs_capture_{nc.stage}")
            return {
                "status": "needs_capture",
                "stage": nc.stage,
                "message": str(nc),
                "screenshot": shot,
            }

    finally:
        # Bounded teardown: a wedged browser.close() (common under memory
        # pressure) must not block pw.stop(), or the Chromium processes leak.
        await dealer_web_login.safe_teardown(pw, browser, context)

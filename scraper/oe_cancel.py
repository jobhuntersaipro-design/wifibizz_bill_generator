"""
oe_cancel.py — cancel a provision order in the Unifi dealer portal.

The flow the user performs by hand (live screenshots, 2026-08-26):

    Advanced Query (>>)  →  ID Type + ID Number + Customer Name  →  Query
      →  select the account row, OK  →  Order tab
        →  the "..." button beside "Order Decomposition" on the provision order
          →  Cancel Order  →  confirm OK  →  screenshot as proof

Two rules carry the whole design:

  * The provision order is matched by its ORDER NUMBER, never by position.
    Cancelling the wrong provision order is unrecoverable, so an order number
    that is not visible is a failure with a screenshot, not a guess.
  * Everything before the confirm-OK click is read-only against the portal.
    Any failure up to that point leaves the order untouched at Unifi — and an
    outcome the screen cannot confirm afterwards is reported as
    `cancel_unconfirmed`, never as success (the pay-click lesson).

The Advanced Query widgets are the ones the attach flow already drives
(`.js-advanced-query-btn`, `certNbr`, `custName`, `button.js-query`,
`.js-customer-result-grid`) — reused via oe_feasibility so the two flows
cannot drift. The Order-tab side is new and unproven against the live DOM;
its finder is a module-constant JS blob exercised by fixture tests
(tests/test_cancel_finder.py), the same arrangement that caught the three
scroll-anchor traps.
"""

import asyncio
import re

from oe_errors import (
    CANCEL_CONFIRM_UNRECOGNISED,
    CANCEL_CUSTOMER_NOT_FOUND,
    CANCEL_OPTION_MISSING,
    CANCEL_ORDER_NOT_FOUND,
    CANCEL_UNCONFIRMED,
)

# How many account rows to try before giving up. The Active Subscribers grid
# can list one account per service; the order-number match in the Order tab is
# the real safety, this only bounds the walk.
MAX_ACCOUNT_ROWS = 5

# ─────────────────────────────────────────────────────────────────────────────
# The Order-tab finder.
#
# A module constant, not an inline string, so tests/test_cancel_finder.py can
# run it against fixture markup without a portal. It tags rather than clicks:
# Python clicks `[data-oe-cancel-trigger]`, so what the tests prove is exactly
# what the flow uses.
#
# Traps it is written around (all inherited from the scroll-anchor lessons):
#   * innerText of a HIDDEN node is "", so a display:none template block can
#     never match; visibility is checked with offsetParent/getClientRects.
#   * The smallest block containing the order number is climbed to the nearest
#     ancestor that ALSO contains "Order Decomposition" — matching the whole
#     page would find a trigger belonging to a different order.
#   * The trigger is the clickable nearest the "Order Decomposition" label
#     whose text is an ellipsis ("...", "…", "⋯") or whose class/title says
#     more/dropdown — searched outward from the label, never page-wide.
# ─────────────────────────────────────────────────────────────────────────────
FIND_CANCEL_TRIGGER_JS = r"""
(orderNo) => {
  const clean = String(orderNo).trim();
  if (!clean) return { found: false, reason: "no_order_no" };

  for (const el of document.querySelectorAll(
      "[data-oe-cancel-trigger],[data-oe-cancel-block]")) {
    el.removeAttribute("data-oe-cancel-trigger");
    el.removeAttribute("data-oe-cancel-block");
  }

  const visible = (el) =>
    !!el && el.getClientRects().length > 0;

  // Every visible element whose OWN text nodes carry the order number.
  const holders = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.nodeValue || "";
    if (t.includes(clean)) {
      const el = walker.currentNode.parentElement;
      if (visible(el)) holders.push(el);
    }
  }
  if (!holders.length) return { found: false, reason: "order_no_not_on_screen" };

  const DECOMP = "order decomposition";
  // The nearest decomposition-bearing ancestor can be just the label's own
  // row; grow it while the parent still describes exactly THIS order (one
  // decomposition label, one occurrence of the number), so the tagged block
  // carries the order's status line without ever swallowing a sibling order.
  const expand = (block) => {
    const dec = (el) => ((el.innerText || "").toLowerCase().split(DECOMP).length - 1);
    const num = (el) => ((el.innerText || "").split(clean).length - 1);
    for (let i = 0; i < 3; i++) {
      const p = block.parentElement;
      if (!p || p === document.body || dec(p) !== 1 || num(p) !== 1) break;
      block = p;
    }
    return block;
  };
  const ellipsis = (s) => {
    const t = (s || "").trim();
    return t === "..." || t === "…" || t === "⋯" || t === "···";
  };
  const moreish = (el) => {
    const cls = (el.className && String(el.className).toLowerCase()) || "";
    const title = ((el.getAttribute("title") || "") +
                   (el.getAttribute("aria-label") || "")).toLowerCase();
    return cls.includes("dropdown-toggle") || cls.includes("more") ||
           title.includes("more");
  };

  for (const holder of holders) {
    // Climb to the nearest ancestor that also carries the Order Decomposition
    // label — that ancestor IS this order's block.
    let block = holder;
    while (block && block !== document.body) {
      if ((block.innerText || "").toLowerCase().includes(DECOMP)) break;
      block = block.parentElement;
    }
    if (!block || block === document.body) continue;

    // The label element itself: the deepest visible element whose text is
    // exactly the label (so the block, which also "contains" it, never wins).
    let label = null;
    for (const el of block.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const own = (el.childNodes.length &&
        [...el.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.nodeValue).join("")) || "";
      if (own.toLowerCase().includes(DECOMP)) label = el;
    }
    if (!label) continue;

    // Search outward from the label, at most 4 ancestors, for the trigger.
    let scope = label;
    for (let depth = 0; depth < 4 && scope && scope !== block.parentElement;
         depth++, scope = scope.parentElement) {
      const candidates = [...scope.querySelectorAll("a,button,span,i,div")]
        .filter(visible)
        .filter((el) => el !== label && !label.contains(el))
        .filter((el) => ellipsis(el.innerText) || moreish(el));
      // Nearest first: prefer an ellipsis over a class hint.
      const pick = candidates.find((el) => ellipsis(el.innerText)) || candidates[0];
      if (pick) {
        pick.setAttribute("data-oe-cancel-trigger", "1");
        expand(block).setAttribute("data-oe-cancel-block", "1");
        return {
          found: true,
          trigger: {
            tag: pick.tagName.toLowerCase(),
            text: (pick.innerText || "").trim().slice(0, 40),
            cls: String(pick.className || "").slice(0, 120),
          },
        };
      }
    }
    return { found: false, reason: "no_trigger_near_decomposition" };
  }
  return { found: false, reason: "no_block_with_decomposition" };
}
"""

# Read the tagged order block's text again — after the cancel, to see whether
# the portal now says so. Falls back to re-finding the smallest visible block
# holding the order number, because the confirm can re-render the tab.
READ_ORDER_BLOCK_JS = r"""
(orderNo) => {
  const clean = String(orderNo).trim();
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const tagged = document.querySelector("[data-oe-cancel-block]");
  if (tagged && visible(tagged) && (tagged.innerText || "").includes(clean)) {
    return { text: tagged.innerText || "" };
  }
  let best = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.nodeValue || "";
    if (!t.includes(clean)) continue;
    // Same anchor as the finder: the nearest ancestor that also carries the
    // Order Decomposition label IS this order's block — the status line lives
    // in the block, not on the number's own row.
    const DECOMP = "order decomposition";
    const expand = (b) => {
      const dec = (x) => ((x.innerText || "").toLowerCase().split(DECOMP).length - 1);
      const num = (x) => ((x.innerText || "").split(clean).length - 1);
      for (let i = 0; i < 3; i++) {
        const p = b.parentElement;
        if (!p || p === document.body || dec(p) !== 1 || num(p) !== 1) break;
        b = p;
      }
      return b;
    };
    let el = walker.currentNode.parentElement;
    let block = el;
    while (block && block !== document.body) {
      if ((block.innerText || "").toLowerCase().includes(DECOMP)) break;
      block = block.parentElement;
    }
    if (block && block !== document.body) {
      block = expand(block);
    } else {
      // No label (the confirm may have re-rendered it away) — climb until the
      // text reads like more than the bare number, capped.
      block = el;
      for (let i = 0; i < 5 && block && block !== document.body; i++) {
        if ((block.innerText || "").length > clean.length + 40) break;
        block = block.parentElement;
      }
    }
    if (visible(block) && (!best || (block.innerText || "").length <
                           (best.innerText || "").length)) best = block;
  }
  return best ? { text: best.innerText || "" } : { text: "" };
}
"""

# What counts as "the portal says it is cancelled". Matched against the order
# block's text AFTER the confirm; anything else is cancel_unconfirmed.
#
# Deliberately NOT a bare /cancel/: the word "Cancel" is all over a portal
# screen that has cancelled nothing — the "Cancel Order" menu entry, any
# dialog's Cancel button — and matching it would report success for an order
# that is still live. Only a STATE wording counts: an inflection (Cancelled /
# Cancellation / Cancelling) or an explicit outcome phrase.
_CANCELLED_RE = re.compile(
    r"cancell(?:ed|ation|ing)"
    r"|cancel\s+(?:order\s+)?(?:submitted|success|in\s*progress|complete)",
    re.IGNORECASE)


def cancelled_state_visible(block_text: str | None) -> bool:
    """Does the order block's text show a cancel STATE (Cancelled /
    Cancellation In Progress / Cancel Order Submitted, …)?

    Pure so the verification rule is testable: the whole honesty of the flow is
    that this returning False reports `cancel_unconfirmed`, never success — the
    order is never marked cancelled in BizzFlow until the portal itself says so.
    """
    return bool(block_text and _CANCELLED_RE.search(block_text))


def _result(code: str, stage: str, message: str) -> dict:
    return {"status": "error", "error": code, "stage": stage, "message": message}


async def _click_ok_in_query_dialog(frame) -> bool:
    """OK on the Advanced Query dialog, confirming the selected account row."""
    dlg = frame.locator(".ui-dialog:visible, .modal.in:visible").filter(
        has_text="Advanced Query").last
    scope = dlg if await dlg.count() else frame
    btn = scope.locator('button:has-text("OK"):visible').last
    if not await btn.count():
        return False
    await btn.click(timeout=8000)
    return True


async def _open_order_tab(frame) -> None:
    """Best-effort: bring the customer view's Order tab forward.

    The tab's exact markup is live-unverified. An exact-text match keeps
    "Order Entry", "Order Decomposition" and friends from being clicked; if no
    such tab is found the flow simply proceeds — the finder failing to see the
    order number is what actually reports the problem, with a screenshot.
    """
    tab = frame.locator("a:visible, li:visible > a").filter(
        has_text=re.compile(r"^\s*Order\s*$")).first
    try:
        if await tab.count():
            await tab.click(timeout=5000)
            await asyncio.sleep(2)
    except Exception:  # noqa: BLE001
        pass


async def run_cancel(payload: dict, user_key: str = None, on_stage=None) -> dict:
    """Drive the portal cancel end to end. Returns a result dict:

        {"status": "cancelled", "order_id": ..., "message": ...}       success
        {"status": "error", "error": <code>, "stage": ..., "message"}  refusal

    Raises InfraError only for session/login problems (same contract as
    enter_order). Expected failures return, so the caller can capture the
    screen at the moment of refusal.
    """
    from order_entry import (
        IFRAME_SELECTOR, InfraError, ORDER_ENTRY_URL, ensure_on_order_entry,
    )
    from oe_feasibility import (
        _open_advanced_query, _search_customer_rows, capture_and_report,
        capture_failure,
    )
    from oe_helpers import check_error

    def stage(name, detail=None):
        if on_stage:
            try:
                on_stage(name, detail)
            except Exception:  # noqa: BLE001
                pass
        print(f"→ stage: {name}" + (f" ({detail})" if detail else ""), flush=True)

    order_no = str(payload.get("order_no") or "").strip()
    customer = payload.get("customer") or {}
    id_type = customer.get("id_type") or "MyKad"
    ic = str(customer.get("id_number") or "").strip()
    name = str(customer.get("full_name") or "").strip()
    if not order_no:
        return _result(CANCEL_ORDER_NOT_FOUND, "validating", "No portal order number to cancel.")
    if not ic or not name:
        return _result(CANCEL_CUSTOMER_NOT_FOUND, "validating",
                       "The order is missing the ID number or customer name the portal search needs.")

    browser = context = pw = page = None
    try:
        try:
            if user_key:
                import dealer_login_service
                import dealer_web_login
                session_path = f"sessions/dealer_{dealer_login_service._safe_key(user_key)}.json"
                pw, browser, context, page = await dealer_web_login.open_context_from_session(
                    session_path, landing_url=ORDER_ENTRY_URL)
            else:
                from credential_manager import CredentialManager
                import login_manager
                cm = CredentialManager()
                if not cm.credentials_exist():
                    raise InfraError(
                        "No dealer session (pass user_key) and no stored credentials (config/).")
                creds = cm.get_credentials()
                browser, context, pw, page = await login_manager.login_and_get_context(
                    creds.get("username"), creds.get("password"))
        except InfraError:
            raise
        except Exception as e:
            raise InfraError(f"Login / session load failed: {e}") from e

        await ensure_on_order_entry(page)
        frame = page.frame_locator(IFRAME_SELECTOR)

        result = await _drive_cancel(
            page, frame, payload, order_no, id_type, ic, name, stage,
            capture_and_report, check_error,
            _open_advanced_query, _search_customer_rows)
        # One chokepoint photographs every refusal — the error result returns
        # immediately upward, so the page still shows what was refused on.
        await capture_failure(page, payload, result, stage)
        return result
    finally:
        for closer in (
            (context.close() if context else None),
            (browser.close() if browser else None),
            (pw.stop() if pw else None),
        ):
            if closer is not None:
                try:
                    await closer
                except Exception:  # noqa: BLE001
                    pass


async def _drive_cancel(page, frame, payload, order_no, id_type, ic, name, stage,
                        capture_and_report, check_error,
                        open_advanced_query, search_customer_rows) -> dict:
    """The flow proper, after the session and iframe are up."""
    # ── Advanced Query: search the customer ─────────────────────────────────
    stage("opening_query")
    try:
        await open_advanced_query(frame, id_type)
    except Exception as e:  # noqa: BLE001
        return _result(CANCEL_CUSTOMER_NOT_FOUND, "opening_query",
                       f"Advanced Query did not open: {type(e).__name__}: {e}")

    stage("querying_customer")
    rows, n, not_exist = await search_customer_rows(frame, ic, name)
    await capture_and_report(page, payload, "cancel_query", stage)
    if not_exist or n == 0:
        return _result(
            CANCEL_CUSTOMER_NOT_FOUND, "querying_customer",
            not_exist or f"Advanced Query returned no accounts for IC {ic}.")

    # ── Account rows: newest first, until the order number shows up ────────
    found = None
    tried = 0
    for idx in range(min(n, MAX_ACCOUNT_ROWS)):
        if idx > 0:
            # Trying another account means re-opening the query — OK closed it.
            stage("selecting_account", f"account row {idx + 1} of {n}")
            try:
                await open_advanced_query(frame, id_type)
                rows, n2, not_exist = await search_customer_rows(frame, ic, name)
                if not_exist or n2 == 0:
                    break
            except Exception:  # noqa: BLE001
                break
        else:
            stage("selecting_account", f"1 of {n} account(s)")
        tried = idx + 1
        try:
            await rows.nth(idx).click(timeout=8000)
            await asyncio.sleep(1)
            if not await _click_ok_in_query_dialog(frame):
                return _result(CANCEL_CUSTOMER_NOT_FOUND, "selecting_account",
                               "The Advanced Query dialog has no OK button to confirm the account.")
            await asyncio.sleep(3)
        except Exception as e:  # noqa: BLE001
            return _result(CANCEL_CUSTOMER_NOT_FOUND, "selecting_account",
                           f"Could not select account row {idx + 1}: {type(e).__name__}: {e}")
        err = await check_error(frame, "selecting_account")
        if err:
            return err

        # ── Order tab: find the provision order BY NUMBER ───────────────────
        stage("locating_order", f"looking for {order_no}")
        await _open_order_tab(frame)
        try:
            found = await frame.locator("body").evaluate(FIND_CANCEL_TRIGGER_JS, order_no)
        except Exception as e:  # noqa: BLE001
            found = {"found": False, "reason": f"finder failed: {type(e).__name__}: {e}"}
        if found.get("found"):
            break
        print(f"  ↳ account row {idx + 1}: {found.get('reason')}", flush=True)

    if not found or not found.get("found"):
        await capture_and_report(page, payload, "cancel_order_tab", stage)
        return _result(
            CANCEL_ORDER_NOT_FOUND, "locating_order",
            f"Order {order_no} was not found under {tried} account(s) for IC {ic} "
            f"({(found or {}).get('reason', 'not searched')}). Nothing was cancelled.")

    # ── The "..." menu → Cancel Order ───────────────────────────────────────
    stage("cancelling", f"menu trigger: {found['trigger']['tag']} "
                        f"'{found['trigger']['text']}'")
    try:
        await frame.locator('[data-oe-cancel-trigger="1"]').first.click(
            timeout=8000, force=True)
        await asyncio.sleep(1.5)
    except Exception as e:  # noqa: BLE001
        return _result(CANCEL_OPTION_MISSING, "cancelling",
                       f"The '...' menu beside Order Decomposition did not accept the click: "
                       f"{type(e).__name__}: {e}")

    item = frame.locator("a:visible, li:visible, button:visible, span:visible").filter(
        has_text=re.compile(r"^\s*Cancel Order\s*$")).first
    if not await item.count():
        return _result(
            CANCEL_OPTION_MISSING, "cancelling",
            f"The menu opened but offered no 'Cancel Order' entry for order {order_no} — "
            "the portal may no longer allow cancelling this order. Nothing was cancelled.")
    await item.click(timeout=8000)

    # ── Confirm dialog: photograph BEFORE the irreversible click ────────────
    stage("confirming")
    dlg = frame.locator(".ui-dialog:visible, .modal.in:visible").last
    try:
        await dlg.wait_for(state="visible", timeout=10000)
    except Exception:  # noqa: BLE001
        dlg = None
    await capture_and_report(page, payload, "cancel_confirm", stage)
    if dlg is not None:
        ok = dlg.locator(
            'button:has-text("OK"):visible, button:has-text("Yes"):visible, '
            'button:has-text("Confirm"):visible').last
        if not await ok.count():
            # Read-only refusal: an unrecognised dialog is not ours to guess at.
            return _result(
                CANCEL_CONFIRM_UNRECOGNISED, "confirming",
                "A dialog appeared after Cancel Order but offered no OK/Yes/Confirm "
                "button. Nothing was clicked and nothing was cancelled.")
        await ok.click(timeout=8000)  # ← the one irreversible click

    # ── Proof + verification ────────────────────────────────────────────────
    stage("capturing_proof")
    await asyncio.sleep(4)
    err = await check_error(frame, "capturing_proof")
    if err:
        err["message"] = (f"The portal refused the cancellation of {order_no}: "
                          f"{err.get('message', '')}")
        return err
    await capture_and_report(page, payload, "cancel_proof", stage)

    try:
        block = await frame.locator("body").evaluate(READ_ORDER_BLOCK_JS, order_no)
    except Exception:  # noqa: BLE001
        block = {"text": ""}
    state_text = (block or {}).get("text", "")
    if cancelled_state_visible(state_text):
        snippet = " ".join(state_text.split())[:200]
        stage("cancelled", snippet)
        return {"status": "cancelled", "order_id": order_no,
                "message": f"Portal shows: {snippet}"}

    # OK was clicked but the screen never said so — report unconfirmed, with
    # the proof frame already stored. Claiming success here would send nobody
    # to follow up on an order that may still be live.
    return _result(
        CANCEL_UNCONFIRMED, "capturing_proof",
        f"Cancel was confirmed for {order_no}, but the screen does not show a "
        "cancelled state. Check the order in the portal before treating it as cancelled.")

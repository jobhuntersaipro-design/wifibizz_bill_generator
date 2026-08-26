# Cancel Order — Real Portal Cancel via Advanced Query

## Status

SPEC — awaiting review. No code written.

## Problem

BizzFlow's "Cancel order…" is bookkeeping only: it flips the row to `cancelled`, appends an
info event, and tells the agent to void the order at Unifi by hand. The portal half has
never been automated, which is why a backlog of stranded orders still needs manual voiding.
This feature makes the existing Cancel actually cancel the provision order in the Unifi
dealer portal, with a screenshot as proof.

## User-observed portal flow (from live screenshots, 2026-08-26)

1. In Order Entry, open **Advanced Query** (the dialog titled "Advanced Query" with
   "Please enter at least 3 search field, including mandatory fields.").
2. Fill **ID Type** (combobox), **ID Number**, **Customer Name** — three fields, satisfying
   the 3-field minimum, two of them the mandatory ones.
3. Click **Query** → Active Subscribers grid lists the customer's account(s).
4. Select the **latest account**, click OK — lands on the subscriber/account view.
5. Under the **Order** tab there is a provision order. Click the **"…" button beside
   "Order Decomposition"**.
6. **Cancel Order** appears in that menu — click it.
7. A **confirmation dialog (plain OK/Yes, no reason field)** appears — confirm.
8. Screenshot the result as proof of cancellation.

## Decisions (settled with user, 2026-08-26)

- **Trigger:** extend the existing "Cancel order…" row action. It now runs the portal
  cancel on the droplet and only marks the BizzFlow order `cancelled` once the portal
  confirms. If the portal run fails, the order **stays `submitted`** and the dialog offers
  the old behavior explicitly: "Mark cancelled in BizzFlow only (does NOT void at Unifi)".
- **Eligibility unchanged:** `canCancel` still admits only `status === "submitted"`.
  Stranded `order_entered` rows keep needing manual voiding (revisit later if wanted).
- **Order selection: match the stored order number, never "the latest order".** The scraper
  finds the provision-order row whose order number equals the BizzFlow order's stored
  16-digit portal number (`Order.orderId`, validated by `isPortalOrderNumber`). If that
  number is not visible under the selected account, **fail with a screenshot rather than
  guess** — cancelling the wrong provision order is unrecoverable.
- **Confirm dialog:** plain OK/Yes confirmation, no reason field. The scraper screenshots
  the dialog *before* confirming (that frame shows exactly what was about to be agreed to),
  then confirms, then screenshots the final state as proof.

## Design

### Scraper: new `scraper/oe_cancel.py`

A separate module — this is a read-navigate-click flow, not part of the 3,300-line submit
path in `oe_feasibility.py`. It reuses the existing plumbing: the dealer session from
`login_manager`, `set_combobox` / dialog helpers from `oe_helpers`, capture upload via
`r2_upload`, error codes via `oe_errors`.

`cancel_order(page, params, on_stage, on_capture)` steps, each emitting a stage event:

1. `opening_query` — open Advanced Query from Order Entry. The exact opener control is
   unknown (the customer-attach flow's `.js-advanced-query-btn` lives inside a different
   dialog); a devtools probe (`scraper/devtools/probe_advanced_query.py`) pins the selector
   before the feature is built, same as the `probe_js_ok.py` precedent.
2. `querying_customer` — fill ID Type (via `set_combobox` with `skip_if_set=` — MyKad is
   the portal default, and that row is the one carrying the Read Card button; the ID Type
   value comes from the order's `idType` mapped the same way the submit flow maps it),
   ID Number, Customer Name; click Query. Capture slot `cancel_query` (filled form +
   results grid).
3. `selecting_account` — pick the latest account row and confirm. "Latest" = the newest row
   the grid offers; if the grid's ordering is ambiguous on the first live run, the
   order-number match in the next step is the real safety. **Fallback:** if the stored
   order number is not found under that account and the grid listed more than one account,
   try the remaining accounts (bounded at 5) before failing. Zero accounts → fail
   `cancel_customer_not_found` with a screenshot.
4. `locating_order` — open the **Order** tab, find the provision-order row whose order
   number equals `params["order_no"]`. Not found after the account fallback → fail
   `cancel_order_not_found` with capture slot `cancel_order_tab` (the tab as seen, so the
   agent can read what orders ARE there).
5. `cancelling` — click the "…" beside Order Decomposition **on the matched row**, click
   "Cancel Order" in the menu it opens. Menu item absent (e.g. order state no longer
   cancellable) → fail `cancel_option_missing` with a screenshot of the open menu.
6. `confirming` — capture slot `cancel_confirm` (the confirmation dialog, pre-click), then
   click OK/Yes. This is the irreversible click; everything before it is read-only.
7. `capturing_proof` — capture slot `cancel_proof` (the screen after confirmation). Then
   **verify best-effort**: re-read the order row's state. If the portal visibly reflects the
   cancel (status text changed / row gone / success toast recorded), result is `cancelled`.
   If the screen cannot confirm it, result is `cancel_unconfirmed` **with the proof frame
   attached** — the same honesty rule as `pay_click_did_not_take`: claiming a cancel that
   didn't happen sends nobody to follow up, so unconfirmed is reported as unconfirmed,
   never as success.

Everything before step 6 is read-only against the portal, so any failure up to there
leaves the order untouched at Unifi.

New error codes in `oe_errors.py` (+ mirrored in BizzFlow's error map):
`cancel_customer_not_found`, `cancel_order_not_found`, `cancel_option_missing`,
`cancel_unconfirmed`, plus the generic fall-through with `_describe_screen()` output.

### Scraper API: `POST /orders/cancel` in `api_server.py`

Async job, same shape as `create_order`: token-authed, spawns a job thread, returns
`job_id`; progress readable via the existing `job_status` / stage-event channel; captures
upload under the order's existing R2 prefix (`order-screenshots/<userId>/<orderId>/…`)
with the new slots added to `CAPTURE_SLOTS`. Payload: `{ order_no, id_type, id_number,
customer_name, user_key, order_ref }` — no more; the cancel needs no address, package or
documents. Result whitelist (`_redact_order_result`) gains the cancel outcome fields.

### Revision (2026-08-26, user review): cancel progress rides the submit surfaces

The dialog-only progress view was replaced. Confirming "Cancel at Unifi" closes
the dialog and moves the order into a new transient **`cancelling`** status —
the ROW then behaves exactly as a submitting one: amber spinner pill, the
expanded live checklist (a 7-step `CANCEL_STEPS` list rendered by the same
`SubmitProgress`, via a new `steps` prop and a steps-aware `progressReading`),
the same `/api/orders/[id]/progress` route (branching to `pollCancelProgress`
for cancelling rows), and the same follow loop in OrdersList. The detail page
treats `cancelling` as live too. Stage rows + captures land on the cancel's own
attempt in the history, so the timeline shows the run like any submit attempt.

`cancelling` is locked down like `submitted`: no edit (menu + `saveOrder`
guard), no delete, no submit/resubmit/second cancel (all predicates refuse it),
absent from the status filter like `submitting`.

**Only the portal confirmation path may ever produce `cancelled`**: the scraper
reports `status: "cancelled"` only when the order block's text shows a cancel
STATE — the matcher requires an inflection (Cancelled/Cancellation/Cancelling)
or an outcome phrase (Cancel Order Submitted / Cancel In Progress), never the
bare word "Cancel", which the menu entry and every dialog button put on screens
that cancelled nothing. Anything else reverts the row to `submitted` with the
failure recorded as history + toast.

### BizzFlow: `cancelOrder` becomes a two-mode action

- `cancelOrder(id, { portal: true })` (new default from the dialog): validates
  `canCancel` + `isPortalOrderNumber(order.orderId)`, starts the droplet job (10s bounded
  fetch, same guard as `startSubmit`), records a history event that a portal cancel was
  started. The dialog switches to a progress view polling the job (reusing the submit
  progress polling pattern); stage events + captures land on the order's timeline as their
  own attempt-like group, so the proof screenshot is one click away in the Capture Carousel.
- On job success (`cancelled`): status → `cancelled`, terminal history event names the
  portal confirmation and the proof capture. The one-way door is unchanged — nothing
  transitions out of `cancelled`.
- On job failure or `cancel_unconfirmed`: status **stays `submitted`**, the error renders
  with its code and captures, and the dialog offers the explicit fallback button
  "Mark cancelled in BizzFlow only" → the existing bookkeeping path verbatim (including its
  honest "does NOT void at Unifi" copy).
- Dealer session required: if the dealer connection is down, the dialog says so and offers
  only the bookkeeping fallback — same session gate the submit button uses.

Dialog copy changes from "this does NOT void at Unifi" to describing what will actually
happen, with the fallback wording keeping the old warning.

### Inputs mapping

| Portal field | Source |
| --- | --- |
| ID Type | `Order.idType` → portal label (same mapping the submit flow uses) |
| ID Number | `Order.idNumber` (raw digits; portal shows unmasked) |
| Customer Name | `Order.fullName` |
| Order number to match | `Order.orderId` (must pass `isPortalOrderNumber`) |

## Testing

- **Fixture tests** (browser-fixture pattern like `test_error_dialog` / `read_card_modal`):
  the provision-order row matcher picks the row by exact order number and never the first
  row; multiple accounts → fallback iteration order; Cancel Order menu item absent →
  `cancel_option_missing`, not a click on a neighbouring item; the confirm step never
  fires when the matched row wasn't found.
- **Vitest**: `canCancel` unchanged; the action refuses a missing/invalid `orderId`; the
  failure path leaves status `submitted`; the fallback still produces the old bookkeeping
  event verbatim.
- **Live verification** (the only real proof): deploy to droplet + **restart `api_server`**,
  then cancel one real submitted order end-to-end and eyeball the proof frame. Until then
  the selectors for the Advanced Query opener, the account grid's OK, the Order tab, the
  "…" menu and the confirm dialog are assumptions pinned by the devtools probe, not by a run.

## Explicitly out of scope

- Cancelling `order_entered` / stranded orders (user's call: submitted only, for now).
- Any reason-field handling in the confirm dialog (user confirms it's plain OK/Yes).
- Batch cancel.
- Auto-cancelling on submit failure.

## Open questions for review

1. **"Latest account" ordering** — is the newest account the top row or the bottom row of
   the Active Subscribers grid? (The order-number match makes this non-fatal, but knowing
   saves fallback iterations.)
2. After OK on the account, does the Order tab need the "Show Terminated Subscribers" /
   any filter touched to show the provision order, or is it visible by default?
3. Should the proof screenshot also be emailed via the existing notification path, or is
   the timeline enough? (Spec assumes timeline only.)

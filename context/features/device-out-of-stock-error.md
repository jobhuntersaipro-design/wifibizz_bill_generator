# Fix: Device Out of Stock — classified error code + change-device prompt

## Status

Code complete, live-unverified.

## Problem

After the Customer Order Information stage the portal sometimes refuses the
order with its own dialog:

> **Error** — [40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.

Before this change the agent saw only:

> Order 2608000121374229 was created but the flow didn't finish: … Verify in the
> portal before retrying.

— which names neither the cause nor the field to change. Stock is validated on
this Next, not when the device is ticked, so the refusal lands well past
`capturing_order_no`: the portal has already minted a real order number and the
run strands it.

## What was built

**Scraper**

- `oe_errors.py` — new `DEVICE_OUT_OF_STOCK` code and rules (`out of stock`,
  `no stock`, `stock is not available`), plus `portal_code()` pulling the
  portal's bracketed `[40300338]`. Four digits minimum, so the RESERVELOGIN
  error's `[1]:LOGIN_ID` field marker isn't mistaken for a code.
- `oe_feasibility.py` — the dialog reader became the module constant
  `READ_ERROR_DIALOG_JS` (testable) and was **widened twice**, because the shape
  the stock dialog renders in is still unconfirmed: it now scans
  `.ui-dialog, .modal.in, .modal.show, .ant-modal, [role=dialog]` in **both**
  `#myIframe` and the top document, and treats a `[code]:` body prefix as a
  third way in alongside the class and title tests. It returns
  `{message, title, selector, container}`, so one live run answers "which shape
  was it?" instead of another round of guessing.
- `classify_dialog()` attaches `error` / `portal_code` / `dialog` to a failure.
  It **omits** `error` when nothing matched, so callers keep their own
  stage-specific fallback (`next_blocked`, `device_rejected`) rather than a
  blanket `unknown_error`.
- Out-of-stock deliberately does **not** join `select_device`'s auto-substitution
  whitelist — a silent substitution ships a customer the wrong hardware.
- `submit_new_connection` reports the failure against `selecting_device`, the
  step whose field the agent must change, not the page they never reached.
- `api_server.py` — `portal_code` and `dialog` added to the redaction whitelist,
  or they are silently dropped before reaching BizzFlow.

**Data** — nullable `error_code` on `orders` and `order_status_events`
(migration `20260818120000_order_error_code`, hand-authored + `migrate deploy`).
No backfill: existing rows failed before anything classified them, and inventing
a code would assert a diagnosis nobody made.

**Frontend** — `SUBMIT_ERROR_CODES` in `order-types.ts` maps a code to
`{title, subtext, fix}`; `portalCodeFrom()` derives the numeric code from the
stored message rather than keeping a second column that could drift. The new
`SubmitErrorBlock` renders three tiers: unclassified → the raw message exactly as
before; classified → title, the portal's verbatim sentence, the code as a
quotable chip, subtext explaining what the code means, and the fix; classified
with a minted order number → also that the order already exists and resubmitting
creates a second one. Used by `SubmitProgress`, the `OrderHistoryPanel` banner,
and both `OrdersTable` mounts; the failure toasts lead with the title and fix.

For a classified error the stored `errorMessage` stays the portal's **verbatim**
wording — the explanation lives in the copy map, so the two are never in two
voices and the sentence stays quotable at Unifi support.

## Testing

- `scraper/tests/test_error_dialog.py` — 22 checks, no portal: both candidate
  dialog shapes (in-iframe jQuery-UI, and the screenshot's classless shell modal
  in the top document), the hidden-dialog and Offer-picker skips, OK actually
  clicked, null on a clean page, and the regression that matters — a
  RESERVELOGIN collision must still map to `login_id_taken`, not to "change your
  device".
- Vitest: 9 cases over the copy map and code parser (166 passing overall).
- `npm run build` and lint clean on every touched file.

## Correction after the first live attempt

The first build wired the classification to the **wrong Next**. A real failure
(ORD-0012, order `2608000121428560`) recorded `stage: pay` and:

> Next #1 on the way to Pay did not advance — the portal said:
> '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.' Page state: {…}

So the portal validates device stock **on the way to Pay**, not on the Customer
Order Information Next and not when the device is ticked. That bail-out
([oe_feasibility.py](../../scraper/oe_feasibility.py), the pay-tail loop)
hardcoded `pay_tail_next_blocked` and buried the portal's sentence inside a
page-state dump, discarding a classification that existed one call up.

Fixed by extracting `blocked_next_error()` — pure, and therefore testable, which
is the point: this branch failed invisibly. Classified → the portal's verbatim
sentence as the message plus the code passed up, with the page-state dump moved
to the run log. Unclassified → the old debug-heavy message unchanged, because
then the dump is the most useful thing available.

Two consequences worth recording:

- The dialog **is** an in-iframe `.ui-dialog` — the pre-existing reader had
  already captured its text. The widened reader is a superset, so it still
  applies, but the shell-modal shape was not what happened here.
- Stage is no longer rewritten to `selecting_device` for a classified failure.
  Reporting the device step when the run actually died in the pay tail would
  make the checklist show the run going backwards; naming the field to change is
  the error copy's job.

Also learned the hard way: the Flask `api_server` holds its imports from
startup, so **scraper edits do nothing until it is restarted** — the Next.js dev
server restart does not cover it.

## Not verified

The live portal, still. Everything above is proven by fixtures and by the stored
failure that motivated it, not by a run that reached the new code.

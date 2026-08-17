# Order Entry — Step-by-Step Submit Progress

## Problem

Submitting an order drives ~14 distinct portal steps over several minutes, and the
agent sees one spinner labelled "Submitting…" for the whole run. When it fails,
the row turns red with a single message and no indication of *where* it stopped —
so the agent can't tell a bad address from a rejected device from a dead session.

A live stage stream already exists end-to-end and is being discarded:

- The scraper fires `on_stage(name)` at 8 milestones.
- `_set_stage` writes it onto the job record ([scraper/api_server.py:300](../../scraper/api_server.py#L300)).
- `GET /jobs/<id>` returns `stage` in its response ([scraper/api_server.py:204](../../scraper/api_server.py#L204)).
- `submitOrder` polls that every 2s — then collapses all 8 stages into **two** DB
  values, `submitting` and `order_entered`
  ([src/actions/order.ts:573-583](../../src/actions/order.ts#L573-L583)).

The browser never sees a stage at all: the client awaits `submitOrder` (one call
blocking up to ~620s) and separately polls `listOrders()` every 4s, reading only
`Order.status`.

Two further gaps:

1. **`feasibility` is one opaque stage covering five real steps** — open
   feasibility, select address, select plan, click Order, attach customer,
   capture order no. `run_feasibility` accepts `on_stage` and never calls it
   ([scraper/oe_feasibility.py:236-292](../../scraper/oe_feasibility.py#L236)).
2. **A 620s server action exceeds Vercel's default 300s function cap.** If
   submits ever appear to hang and then fail for no reason, this is the likely
   cause. Moving to job-id + client polling removes the long-running action.

## Goals

- The agent watches the submit advance through named steps in real time.
- A failure names the step it happened on, with the portal's own message.
- Closing the tab mid-submit cannot strand an order in `submitting` forever.
- No long-running server action.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Transport | Job-id + client polling | Real-time, no DB write per stage, removes the 620s action |
| Granularity | Flat list of ~14 steps | Every step visible; no expand needed to see where it is |
| UI surface | Inline in the order row | Batch submit stays watchable — several rows at once |
| Address re-check | No — trust the confirmed `addressId` | The form's Confirm already resolved it; `select_address` inside feasibility is the real verdict and is now its own reported step |

Stage payload stays a **bare string key**. `_set_stage` and the `safe_keys`
redaction in `_redact_order_result` already handle a plain string, so no Flask
serialization change is needed. The UI owns the human labels.

## Architecture

### Schema — new fields on `Order`

| Field | Purpose |
| --- | --- |
| `jobId` | Lets a later poll reconcile a run the browser stopped watching |
| `stage` | Last stage key seen (e.g. `checking_address`) |
| `stageAt` | Timestamp, for staleness detection |

Prisma migration via `migrate dev`. Note the known repo hazard: a pre-existing
unrelated migration breaks `migrate dev`'s shadow DB — if it fails, apply with
`migrate deploy` as the `20260811140000_dealer_registered_email` migration did.

### `submitOrder` splits in two

- **`startSubmit(id)`** — preflight checks, `POST /orders`, persist `jobId` and
  `status: "submitting"`, return `{ jobId }` immediately. No poll loop.
- **`GET /api/orders/[id]/progress`** — auth-scoped to the caller (superadmins may
  read any order, matching `submitOrder`'s existing rule), proxies Flask
  `GET /jobs/<jobId>`, writes `stage`/`stageAt`, and **finalizes idempotently**
  when the job reports `done` or `error`. The result-interpretation block at
  [src/actions/order.ts:594-641](../../src/actions/order.ts#L594-L641) moves here
  unchanged — including the critical rule that an `error` carrying an `order_id`
  becomes `warning` with the id persisted, so a partially-placed order can never
  be resubmitted as a duplicate.
- **Reconciliation** — `listOrders` finds orders stuck in `submitting` with a
  `jobId` and a stale `stageAt`, and runs the same finalize path. This is what
  makes closing the tab mid-submit safe; today finalization lives only inside the
  awaited action.

Client polls the progress route every 2s while any row is running.

### Scraper — new `on_stage` emissions

In `run_feasibility` ([scraper/oe_feasibility.py:236-292](../../scraper/oe_feasibility.py#L236)),
which currently receives `on_stage` and never calls it:

`checking_address` · `checking_plan` · `placing_order` · `attaching_customer` · `capturing_order_no`

Inside [`complete_new_connection`](../../scraper/oe_feasibility.py#L662),
[`fill_subproduct_tabs`](../../scraper/oe_feasibility.py#L802) and
[`fill_customer_order_info`](../../scraper/oe_feasibility.py#L1103) — these take no
`on_stage` today and need it threaded through from `submit_new_connection`:

`installation_contact` · `billing_account` · `winback_tagging` · `selecting_device` · `uploading_attachments` · `appointment` · `delivery_terms`

Existing stage keys (`creating_customer`, `order_entered`, `feasibility`,
`new_connection_page1`, `subproduct_tabs`, `customer_order_info`, `pay`,
`submitted`) are kept so an older scraper build still reports coarse progress
rather than nothing.

## The 14 steps

| # | Stage key | Label |
| --- | --- | --- |
| 1 | `validating_draft` | Checking draft… (BizzFlow, pre-portal) |
| 2 | `checking_session` | Verifying dealer session… |
| 3 | `creating_customer` | Creating customer profile… |
| 4 | `checking_address` | Checking installation address… |
| 5 | `checking_plan` | Checking package availability… |
| 6 | `placing_order` | Placing order… |
| 7 | `attaching_customer` | Attaching customer… |
| 8 | `capturing_order_no` | Capturing order number… |
| 9 | `installation_contact` | Setting installation contact… |
| 10 | `billing_account` | Setting billing account… |
| 11 | `winback_tagging` | Winback tagging… |
| 12 | `selecting_device` | Selecting device… |
| 13 | `uploading_attachments` | Uploading documents… |
| 14 | `appointment` | Booking appointment |
| 15 | `delivery_terms` | Delivery details |
| 16 | `pay` | Payment |

(16 rather than the 14 first sketched — appointment, delivery and pay are three
distinct portal stages and each can fail on its own, so each gets its own row.)

Terminal: **Submitted**, or **Ready to pay — RM x** when `do_pay=false`
(production never sets `ORDER_ENTRY_DO_PAY`, so this is the normal prod ending).

**Step 8 is the point of no return** and gets a visual divider. Before it, a
failure is retryable. After it, the order exists in the portal and `canSubmit`
correctly locks the row — the checklist must say so rather than showing a bare
red error.

Non-linear outcomes to render, not just pass/fail:

- Step 3 may resolve to *"Customer already exists — reusing"* (`customer_existed`),
  which is a **success** path, not a failure.
- `pay` may report an advance payment amount, shown as an amber note.

## UI

Expand the running row into a flat checklist. Steps come from a static ordered
array; anything before the current stage renders ✓, the current one spins, later
ones grey. On failure the failed step turns red and carries `errorMessage` —
which already holds the portal's own popup text via `_capture_dialog_message`
([scraper/oe_feasibility.py:314](../../scraper/oe_feasibility.py#L314)).

Warning states (customer reuse, advance payment) render amber inline rather than
replacing the row's status badge.

The two preflight steps are near-instant and will flash by. They are shown anyway
because they are the two that fail *before* anything is written to the portal, and
today both surface as a generic red toast.

Respect the global `prefers-reduced-motion` block added in the previous feature —
the step spinner needs a static fallback.

## Non-goals

- No change to what the scraper actually does in the portal. Stage emissions are
  additive and must not alter control flow.
- `do_pay` stays gated by `ORDER_ENTRY_DO_PAY`. This feature does not make any
  order more billable than it is today.
- No retry/resume from a failed step. The order still restarts from step 1, and
  step 8's lock still prevents duplicates.

## Acceptance criteria

1. Submitting a draft shows steps advancing live in the row, without a manual refresh.
2. A failure on a specific step marks *that* step red and shows the portal's message.
3. An order that reaches step 8 keeps its order id and locks resubmission, even if
   a later step fails.
4. Closing the tab mid-submit and reopening the page reconciles the order to its
   true final status rather than leaving it in `submitting`.
5. No server action runs longer than a few seconds.
6. A draft missing a confirmed address fails at step 1, before any portal call.

## Implementation notes

- `STAGE_ALIASES` in [src/lib/order-types.ts](../../src/lib/order-types.ts) maps the
  older coarse keys onto the step they begin, so a BizzFlow deploy that is ahead
  of the droplet still shows sensible progress. An unknown key yields index -1
  and renders as "Working…" instead of dropping progress.
- The old 4s `listOrders` poll was **removed**, not kept alongside the progress
  route: it would have raced the finer-grained stage writes and could overwrite a
  newer state with an older read. A pick-up effect now follows any `submitting`
  row this tab isn't already following, which also covers a submit started in
  another tab.
- `followingRef` is claimed *before* the row flips to `submitting`, otherwise the
  pick-up effect starts a second poll loop against the same order.
- One `eslint-disable` for `react-hooks/set-state-in-effect`: the rule can't see
  that `followProgress` awaits a 2s sleep before its first `setOrders`, so
  nothing renders synchronously.

## Risks

- **Reconciliation depends on the Flask job registry, which is in-memory.** If the
  scraper restarts mid-run, the job is gone and `GET /jobs/<id>` 404s. Treat a 404
  on a `submitting` order as a terminal unknown state and surface it as a warning
  telling the agent to verify in the portal — never as a silent failure that
  re-enables submit.
- **Stage keys are a contract between two deploys** (Vercel + the droplet). An
  unknown key must render as a generic "Working…" step, not crash the row.
- Live verification needs a real dealer session and will create a real customer
  profile and mint a real order id in the portal.

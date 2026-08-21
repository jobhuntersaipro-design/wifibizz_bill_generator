# Email Notifications (Resend) + Server-Side Batch Submit

Date: 2026-08-20
Status: Approved design, not yet implemented

## Overview

Two features for the Order Entry pipeline:

1. **Email notifications** — when an order submit reaches a terminal state
   (Submitted, Order Entered, or Failed), notify the user by email via
   Resend, to a destination email the user configures in Settings.
2. **Server-side batch submit** — batch submits move off the browser and
   onto the droplet scraper service. The selected orders run one by one,
   oldest created first; a failure never stops the batch. When the whole
   batch finishes, the user receives one summary email.

Email volume rule (decided): **one email per single submit, one summary
email per batch** — a 10-order batch produces exactly 1 email, with the
per-order results listed inside it.

## Why server-side batch

Today the batch loop lives in `OrdersList.tsx` (`handleSubmitSelected`):
the browser tab loops over the selected drafts, calls `startSubmit`, and
polls each job until terminal. If the tab closes or the connection drops
mid-batch, the remaining orders never submit and no one is told. It also
processes rows in filtered display order, not created time.

Moving the loop to the droplet — where each single submit already runs as
a background job — makes the batch survive tab close, and gives a single
place that knows "the whole workflow is done" and can trigger the summary
email.

## Architecture

```
Browser                Vercel (Next.js)                 Droplet (Flask scraper)
  |  startBatchSubmit(ids)  |                                  |
  |------------------------>|  build payloads, sort by         |
  |                         |  createdAt asc                   |
  |                         |--- POST /orders/batch ---------->|  run orders 1-by-1
  |  poll batch progress    |                                  |  (existing job machinery)
  |<----------------------->|--- GET /orders/batch/<id> ------>|
  |                         |                                  |
  |                         |<-- POST /api/hooks/scraper ------|  batch_finished /
  |                         |    (bearer secret, 3 retries)    |  order_finished
  |                         |  reconcile orders via existing   |
  |                         |  poll logic, send email (Resend) |
```

Decisions baked in:

- **All email sending lives on Vercel.** The droplet never holds the
  Resend key and never renders templates; it only reports completion via
  the webhook. Templates + Prisma bookkeeping stay in one codebase.
- **The webhook, not the browser poll, triggers emails.** Single-submit
  result emails and batch summaries both send from the webhook handler,
  so they send even when the tab is closed. The browser poll remains the
  UI's source of progress, unchanged.
- Rejected alternatives: droplet-sends-email (splits secrets/templates
  across codebases, droplet can't read order names from Prisma);
  Vercel-orchestrated batch (a serverless function cannot run a
  potentially hour-long sequential loop).

## Prerequisites (user setup, before the feature can send anything)

1. Resend account exists; **domain is NOT yet verified**. Verify a
   sending domain (e.g. `bizzflow.top`) — add the DNS records Resend
   shows (SPF + DKIM) and wait for verified status. Until then, Resend
   only delivers to the account owner's own email.
2. Create a Resend API key.
3. Env vars:

   | Variable | Where | Purpose |
   | --- | --- | --- |
   | `RESEND_API_KEY` | Vercel | Resend API auth |
   | `NOTIFY_FROM_EMAIL` | Vercel | e.g. `BizzFlow <notifications@bizzflow.top>` |
   | `SCRAPER_WEBHOOK_SECRET` | Vercel + droplet | bearer token the droplet presents to `/api/hooks/scraper` |
   | `BIZZFLOW_WEBHOOK_URL` | droplet | e.g. `https://<app>.vercel.app/api/hooks/scraper` |

## Data model

Hand-authored migration + `prisma migrate deploy` (NOT `migrate dev` —
its shadow DB fails in this repo; see project memory). Restart the dev
server after `prisma generate`.

- `User.notificationEmail String?` — nullable. At send time, recipient =
  `notificationEmail ?? user.email` (login email). One address per user.
- New model `BatchRun`:

  ```prisma
  model BatchRun {
    id         String    @id @default(cuid())
    userId     String
    orderIds   Json      // ordered array, oldest-created first
    results    Json?     // per-order: { orderId, outcome, errorCode?, portalOrderNo?, durationMs }
    status     String    @default("running") // running | finished
    scraperBatchId String?                   // droplet's batch job id
    startedAt  DateTime  @default(now())
    finishedAt DateTime?
    notifiedAt DateTime? // set exactly once, when the summary email sends
    user       User      @relation(fields: [userId], references: [id])
  }
  ```

  `notifiedAt` is the dedup guard: the webhook retries up to 3 times, and
  a retry that arrives after a success must not send a second summary.
  The handler sets `notifiedAt` with a conditional update
  (`WHERE notifiedAt IS NULL`) before sending, so two concurrent
  deliveries cannot both pass.
- `Order.notifiedAt DateTime?` — same exactly-once guard for
  single-submit result emails.

## Droplet: batch runner (`scraper/`)

- `POST /orders/batch` — body: `{ batchId, orders: [<same payload as POST
  /orders today>, ...] }`. The list arrives **already sorted by order
  created time, oldest first** (Vercel sorts; the droplet preserves
  order). Returns `{ batchJobId }`.
- Runs in a background thread. Each order goes through the **existing
  single-order job machinery** (`enter_full_order` etc.) sequentially —
  one dealer session cannot run concurrent flows, which is why the
  browser loop was sequential too.
- **Continue on failure**: any error result (including exceptions and
  stranded `order_entered` outcomes) is recorded and the runner moves to
  the next order. Nothing short-circuits the batch — matching the
  requirement "if the 1st order failed, move on to the 2nd."
  - Exception worth naming in implementation: if the dealer session
    itself is dead (login/session error, not an order error), every
    remaining order would fail identically. The runner still attempts
    each one (simple, honest per-order results) — revisit only if live
    use shows this wastes meaningful time.
- `GET /orders/batch/<id>` — `{ status, currentIndex, currentJobId,
  results[] }` for UI polling. Individual jobs stay pollable at their
  existing endpoint, so the current order's step-by-step progress UI
  keeps working unchanged.
- On batch completion: POST `{ event: "batch_finished", batchId,
  results }` to `BIZZFLOW_WEBHOOK_URL` with
  `Authorization: Bearer <SCRAPER_WEBHOOK_SECRET>`; retry 3 times with
  backoff; log and give up after that (the UI poll still shows results —
  only the email is lost, and `notifiedAt IS NULL` makes that visible).
- On **single** (non-batch) job completion: POST `{ event:
  "order_finished", jobId }` the same way. Batch member jobs do NOT fire
  `order_finished` — the summary covers them.
- Reminder from project memory: **scraper edits need an `api_server`
  restart** on the droplet, and a deploy — the droplet currently runs
  older code.

## Vercel: webhook + notifications

- `POST /api/hooks/scraper` (API route — needs a specific caller +
  bearer auth, so a Server Action is wrong here):
  1. Verify bearer token; 401 otherwise.
  2. `order_finished`: reconcile the order via the existing poll logic in
     `src/lib/order-submit.ts` (already safe to run twice), then send the
     single-result email if `Order.notifiedAt` is null (conditional
     update first).
  3. `batch_finished`: reconcile each member order, store `results` +
     `finishedAt` on `BatchRun`, then send the summary email if
     `notifiedAt` is null.
  4. Email failures are caught and logged — a notification must never
     fail a submit or the webhook response (return 200 so the droplet
     stops retrying delivery of an event that was processed).
- `src/lib/notifications/` — `resend.ts` (client + `sendEmail` wrapper
  that no-ops with a logged warning when `RESEND_API_KEY` is unset, so
  dev without keys still works), `templates.tsx` (the two emails),
  `recipient.ts` (`notificationEmail ?? user.email`).

### Email content

Both emails: plain, readable HTML on the app's Stripe palette; subject
lines lead with the outcome.

**Single submit result** — subject `✅ Order submitted — <customer name>`
/ `⚠️ Order entered but not completed — …` / `❌ Order failed — …`.
Body: customer name, ORD number, outcome, portal order number when one
exists, error title + the portal's verbatim message on failure (reusing
`submitErrorCopy`), link to the order's Details.

**Batch summary** — subject `Batch submit finished: <ok>/<total>
submitted`. Body: totals line (submitted / order entered / failed),
started + finished times and duration, then one row per order in run
order: customer name, ORD number, outcome, portal order number or error
title. Outcome vocabulary matches the app:
- **Submitted** — paid, e-RF captured.
- **Order Entered** — stranded: the portal minted an order number but the
  flow didn't finish; needs attention (resubmit or void).
- **Failed** — no portal order created (or see error).

## Vercel: batch server action

- `startBatchSubmit(ids: string[])` in `src/actions/order.ts`:
  1. Auth + ownership checks; filter to `canSubmit` rows only (same rule
     as today — stranded orders need per-order confirmation and are
     never batch-eligible).
  2. Load the orders, **sort by `createdAt` ascending**, build each
     payload with the existing payload builder.
  3. Create the `BatchRun` row, POST to the droplet `/orders/batch`
     (10s bound, like `startSubmit` — starting a batch is a
     thread-spawn), store `scraperBatchId`.
  4. Return `{ success, batchRunId }`.
- `pollBatch(batchRunId)` — proxies the droplet batch status (bounded
  fetch), reconciles finished member orders opportunistically (same as
  single-order polling), returns progress for the UI.

## UI changes

- **Settings** (`/dashboard/settings`): "Notification email" field —
  optional, validated as an email, helper text "Order submit results and
  batch summaries go here. Leave blank to use your login email."
- **Orders page** (`OrdersList.tsx`): `handleSubmitSelected` stops
  looping in the browser. It calls `startBatchSubmit` and then polls
  `pollBatch`; the confirmation dialog copy becomes "Submit N orders one
  by one, oldest first? You'll get a summary email at <recipient> when
  the batch finishes. You can close this tab — the batch keeps running."
- Batch progress UI: current order highlighted (existing per-order
  progress panel keeps working via the current job id), finished rows
  get their status pill updated as `pollBatch` reconciles them.
- On page load, an unfinished `BatchRun` for this user resumes the
  progress display (the batch survived the tab; the UI should too).

## Error handling summary

| Failure | Behaviour |
| --- | --- |
| One order fails mid-batch | Recorded, batch continues to the next |
| Droplet unreachable at batch start | `startBatchSubmit` returns a readable error (bounded fetch), nothing created on the droplet, `BatchRun` marked finished with an error note |
| Webhook delivery fails 3× | Batch results still visible via UI polling; email lost; `notifiedAt IS NULL` flags it |
| Resend send fails | Logged, webhook still returns 200, submit outcome unaffected |
| Duplicate webhook delivery | `notifiedAt` conditional update → exactly one email |
| `RESEND_API_KEY` unset (dev) | `sendEmail` no-ops with a warning |

## Testing

- **Vitest**: recipient resolution (`notificationEmail` vs fallback);
  batch summary aggregation (counts, outcome labels, ordering); webhook
  auth (missing/wrong bearer → 401); `notifiedAt` exactly-once guard;
  `startBatchSubmit` sorts by `createdAt` asc and filters non-`canSubmit`
  rows.
- **Scraper tests** (no portal): batch runner preserves input order,
  continues past a failing order, reports per-order results; webhook
  POST retries and gives up cleanly.
- **Live verification** (after deploy — droplet needs the new scraper
  code AND an `api_server` restart): one single submit → one result
  email; one batch of 2–3 drafts → orders run oldest-first, tab closed
  mid-batch, batch completes, exactly one summary email arrives.
  ⚠️ Live submits create real, chargeable portal orders — use
  deliberately, and void unintended ones.

## Non-goals

- No per-order emails inside a batch (decided: summary only).
- No multiple recipients, no CC/BCC (single address per user).
- No email preferences beyond the destination address (no opt-out
  granularity, no digest scheduling).
- No retry-the-failed-orders button on the summary (agents resubmit from
  the Orders page as today).

## Open items

- Resend domain verification is a manual prerequisite; until done,
  emails only deliver to the Resend account owner's address.
- Deploying this ships whatever else is undeployed on the droplet (see
  current-feature.md deploy state) — the deploy is a bigger event than
  this feature alone.

# Ops Alert — Email When an Order Entry Submit Does Not Go Through

**Status:** SPEC ONLY, nothing built. Vercel-only, one small migration.
**Asked:** 2026-09-22 — "when user trying to use order entry submission, and when it's not
submitted, send an email to jobhunter.ai.pro@gmail.com about the order detail and link."

---

## Check the address first

The ask names **`jobhunter.ai.pro@gmail.com`**. The account signed in to this session is
**`jobhunters.ai.pro@gmail.com`** — with an `s`. One letter apart, and a Gmail address that is one
letter off is a real, deliverable address belonging to somebody else, so nothing would bounce and
nobody would notice. **Confirm which one before this is built.** The spec assumes the `s` form and
puts the value in an env var, not in the code, so correcting it is a Vercel setting rather than a
deploy.

## What exists already, and what this adds

A failure email is **already sent today** — `notifyOrderResult` in
[src/lib/notifications/send.ts](../../src/lib/notifications/send.ts), fired from the
`order_finished` webhook, carrying the case details and a "Fix the draft" link. It goes to the
**agent who owns the order** (`resolveRecipient`: their Settings notification address, else their
login email).

So this is not a new notification system. It is a **second copy of the failure case, to one fixed
ops address**, with an admin link instead of an agent link. Three gaps make it more than a cc:

1. **Batch members get no individual email at all.** A batch sends one summary to the agent; an
   order that stranded inside a batch is one row in it. Ops wants the failure, per order.
2. **The agent email links to the draft.** Ops reads `/admin/orders/[id]` — captures, the stage
   timeline, every attempt.
3. **The recipient is not an agent.** `resolveRecipient` is per-user by design; the ops address is
   a constant and must not follow anyone's Settings.

## Rules

**"Not submitted" is the existing rule, not a new one.** `bucketOf` in
[outcomes.ts](../../src/lib/notifications/outcomes.ts) already says a submit either finished
(`status === "submitted"`) or it did not. `failed`, `warning` and `order_entered` are all failures
— including a run that minted a portal order number and stranded. Do not write a second definition.

**Nothing is sent while an automatic retry is owed.** The webhook already gates on
`maybeAutoRetry(...) === "no"`, and `notifyOrderResult` re-checks `order.autoRetryAt`. The ops alert
gets the same two guards: an order with three retries left would otherwise mail ops four times and
teach them to ignore it.

**Exactly once per attempt.** `Order.notifiedAt` is already claimed by the agent email, so the ops
send needs its own claim: a nullable `orders.ops_notified_at`, claimed with the same conditional
`updateMany(WHERE ops_notified_at IS NULL)` pattern, released on a failed send. Cleared alongside
`notifiedAt` in `startSubmitRun`, so each attempt is eligible again.
*Alternative, no migration:* send the ops copy inside `notifyOrderResult` under the existing claim.
Cheaper, but it cannot cover batch members (they never call that function) and a failed ops send
would either release the agent's claim or be silently dropped. The column is worth the migration.

**A failed ops send never changes an order's outcome.** `sendEmail` already returns
`{ sent: false }` rather than throwing; the ops call is awaited, logged and ignored. A 500 from this
route makes the droplet redeliver a job it already processed.

**Missing configuration is a no-op with a warning, never an error.** No `OPS_ALERT_EMAIL` → nothing
sent, one console line. Same posture as `ADMIN_ALERT_EMAIL` in the retry sweep.

## Built

- **`OPS_ALERT_EMAIL`** (Vercel env, all environments). Absent = feature off.
- **`notifyOpsOfFailure(orderId)`** in `src/lib/notifications/send.ts` — reads the order, returns
  early unless `bucketOf` says failed, `autoRetryAt` is null and the address is set; claims
  `opsNotifiedAt`; sends; releases on failure. Reuses `caseDetailsFrom`, `maskIdNumber` and
  `shortErrorMessage` so the ops mail and the agent mail cannot describe one order differently.
- **`opsFailureEmail(outcome)`** in `templates.ts`, on the existing `shell()` — same card, ops
  footer (not "change the destination in Settings", which ops cannot).
  - Subject: `❌ Submit failed — ORD-0042 · WOJAK LANG` — reference first, because ops scans a list.
  - Body: the failure line from `describeOutcome`, then the error code and
    `shortErrorMessage`, then the case block (masked ID, phone, email, installation address,
    package, device, installation date), then who and when: agent email, submitting staff code,
    attempt number, portal order number when one exists.
  - **The portal order number is the most important field on the page.** Its presence is the
    difference between "resubmit this" and "somebody has to void a real order at Unifi", and that
    sentence is already written in `describeOutcome`.
  - **The ID stays masked.** Ops is internal, but email is forwarded and indexed, and the last four
    digits are enough to tell two customers apart. The full number is in the app behind a login.
- **Links** (omitted individually when `appBaseUrl()` returns null — an email with a half-built href
  is worse than a bare reference number):
  - `{base}/admin/orders/{id}` — **primary**, the ops button.
  - `{base}/order-entry/orders/{id}` — the agent-facing detail page, for forwarding.
  - The portal order link, where a number exists, via the existing `portalOrderUrl` helper.
- **Call sites**, both in [/api/hooks/scraper](../../src/app/api/hooks/scraper/route.ts):
  - `order_finished`, beside `notifyOrderResult`, under the same `retry === "no"` gate.
  - `batch_finished`, after `finishBatch` and **after** `retryFailedMembers` has decided — one call
    per member whose result is a failure and which is not being retried.

## Not in scope

Per-agent or per-error routing, an ops digest, WhatsApp/Telegram, changing retry behaviour, changing
what the agent receives, and any UI. The ops address is one constant; if it ever needs to be a list
or a rota, that is a different feature with a table behind it.

## Prerequisites

`OPS_ALERT_EMAIL`, `BIZZFLOW_APP_URL` (or the links silently vanish), `RESEND_API_KEY` and
`NOTIFY_FROM_EMAIL` on Vercel; `SCRAPER_WEBHOOK_SECRET` on both sides and `BIZZFLOW_WEBHOOK_URL` on
the droplet. The webhook chain is live — a real notification was delivered 2026-08-29 — but every
one of these has broken the chain silently at least once, and the failure mode is always the same:
nothing arrives and nothing says why.

## Acceptance

1. A single submit that fails with no portal order → one email to the ops address, naming the
   reference, the customer, the error code and the admin link; the agent still gets their own.
2. A submit that strands with a portal order number → the email leads with that number and the
   "already recorded at the portal" sentence.
3. An order with retries left → **no ops email** until the last attempt settles.
4. A successful submit → no ops email.
5. A batch of 3 where 1 fails → the agent gets one summary; ops gets **one** email, for the failure.
6. Webhook redelivered → still exactly one ops email.
7. `OPS_ALERT_EMAIL` unset → nothing sent, no error, the agent email unaffected.
8. `BIZZFLOW_APP_URL` unset → the email sends with the links omitted, not with broken ones.

## Tests

Pure first: `bucketOf`/`describeOutcome` already carry the verdict, so the new tests are about
routing and exactly-once — the ops recipient never reads `resolveRecipient`; the retry gate; the
conditional claim winning once under two concurrent deliveries; the release on a failed send; a
batch emitting one call per failed member and none for the successes; and the link builders
returning null rather than a relative href with no base. A full render of the failure email,
inspected as an image, the way the other two templates were.

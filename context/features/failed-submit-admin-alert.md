# Failed Order Submit → Alert Email to an Admin Address

**Ask (2026-09-22).** When an agent submits an order through Order Entry and it does **not** get
submitted, email `jobhunter.ai.pro@gmail.com` with the order detail and a link to it.

## Read the code first: most of this already exists

`notifyOrderResult` (`src/lib/notifications/send.ts`) already renders a failure email carrying the
customer's ID, phone, email, installation address, package, device and installation date
(`caseDetailsFrom`), the portal's verbatim error sentence, the error code, and two links — **Fix the
draft** (`/new-order?draft=<id>&focus=<section>`) and **Open the Orders page**. The template
(`singleResultEmail`), the Resend client (`sendEmail`, never throws), the base-URL helper
(`appBaseUrl`) and the idempotent send claim (`orders.notified_at`) are all built and shipped.

So this is **not a new notification system**. It is three deltas.

## The three deltas

| # | Today | Wanted |
|---|-------|--------|
| 1 | Recipient is the **agent** (`resolveRecipient` = `notificationEmail` ?? login email) | A **fixed admin address**, in addition to the agent's |
| 2 | Links point at the draft editor and the Orders list | A link to the **order itself** |
| 3 | Fires **only** from the droplet webhook | Fires on **every** way a submit ends un-submitted |

Delta 3 is the one that matters. The other two are a recipient and an `<a href>`.

## Delta 3 is the real gap — six failure paths, one notifies

`notifyOrderResult` has exactly one caller: `src/app/api/hooks/scraper/route.ts:73`, the droplet's
`order_finished` webhook. Every other way an order lands on `failed` writes the row and tells nobody:

| Where | When |
|---|---|
| `order-start.ts:170` | droplet refused the start — busy, bad payload, unreachable |
| `order-start.ts:252` | dealer session expired at the gate |
| `order-submit.ts:581` | the poll found the job lost on the droplet |
| `actions/order.ts:893` / `:903` | manual stop / lost-job finalize |
| `actions/order.ts:1081` | batch start failed |

And per the 2026-08-22 entry in `CLAUDE.md`, `BIZZFLOW_WEBHOOK_URL` may still be unset on the droplet —
in which case the one path that *does* notify does not fire either. **"Not submitted" in the ask covers
all six.** Wiring an alert into the webhook alone would silently miss most of them, and a monitoring
email you believe is watching and isn't is worse than none.

## Build

### 1. The chokepoint is `recordEvent`, not the six call sites

All six write their failure through `recordEvent` (`src/lib/order-history.ts`) — 17 call sites, 5 files,
and it already swallows its own errors so a diagnostic can never fail the submit it describes. One guard
there beats a call bolted onto every caller, and it cannot be forgotten by a seventh path added later.

```ts
// src/lib/order-history.ts — end of recordEvent(), after the insert
if (e.status === "failed" || e.status === "warning") void alertAdminFailure(e.orderId);
```

The status check is in memory, so the ~90% of calls that are stage milestones cost nothing. `void`, not
`await`: the alert is the last thing that happens and must not be able to change an outcome.

### 2. `alertAdminFailure(orderId)` — new, in `src/lib/notifications/send.ts`

```
ADMIN_ALERT_EMAIL unset                  → return (feature off, no crash)
re-read the order                        → autoRetryAt set? return   (a retry is owed; not news yet)
build the same OrderOutcome as notifyOrderResult
singleResultEmail(outcome) + the order link
sendEmail({ to: ADMIN_ALERT_EMAIL, ... })
```

- **Reuses `singleResultEmail`.** One template means the admin copy and the agent copy cannot drift into
  saying different things about the same failure. No second template, no second style.
- **`autoRetryAt` gate, same rule `notifyOrderResult` already applies.** An order with a retry owed is not
  finished. Without this an order that fails three times and then succeeds emits three false alarms.
- **No new idempotency column.** The `autoRetryAt` gate means only the *last* attempt of a run alerts, and
  a later resubmit that fails again is genuinely new news that should alert again. `orders.notified_at` is
  left alone — it belongs to the agent's email and must keep meaning exactly that.
- **`ADMIN_ALERT_EMAIL`, not a hardcoded address.** The env var already exists
  (`src/app/api/cron/retry-sweep/route.ts:61`, stuck-lock alerting) and is currently unset. Reusing it costs
  nothing and means the address can be changed without a deploy. Unset → no alert, which is the shipped
  behaviour today.

### 3. The link — `/admin/orders/<id>`, not `/order-entry/orders/<id>`

Both pages exist. The admin one wins for an oversight alert: it is cross-agent by design, and it carries
the capture thumbnails and the per-attempt timeline, which is what "why did this fail" actually needs. The
agent route is owner-scoped in `getOrderDetail` (`actions/order.ts:550`) — a plain (non-superadmin) session
opening another agent's order gets *Order not found*.

One line in `templates.ts` beside the existing `fixDraftUrl` / `ordersUrl`:

```ts
const adminOrderUrl = (id: string) => { const b = appBaseUrl(); return b ? `${b}/admin/orders/${id}` : null; };
```

Rendered as a second button under **Fix the draft**, only when `appBaseUrl()` resolves — the existing rule,
so a missing `BIZZFLOW_APP_URL` omits the link rather than emitting a 404.

## Not built

- **A separate admin template.** The agent's failure email already carries every field asked for.
- **A digest / hourly roll-up.** Alert per failure until the volume argues otherwise.
- **Admin alerts for `submitted`.** The ask is failures; a success is not an alert.
- **Wiring the droplet webhook.** Out of scope here — but note the alert now fires without it, which is
  most of the value.

## Testing

One vitest file, `src/lib/__tests__/admin-failure-alert.test.ts`:

- a `failed` event with no retry owed → one send to `ADMIN_ALERT_EMAIL`
- the same event with `autoRetryAt` set → **no** send (the false-alarm case)
- a `submitted` / stage-milestone event → no send, and no order read
- `ADMIN_ALERT_EMAIL` unset → no send, no throw
- the rendered html contains `/admin/orders/<id>`

Then `npm run build` and `npm run lint`.

## Verification

Stage one dev order to `failed` with `autoRetryAt` null, call the path, confirm delivery and that the
link opens the right order. Restore the row afterwards.

## ⚠ Check the address before building

The ask says **`jobhunter.ai.pro@gmail.com`**. The account on file is
**`jobhunters.ai.pro@gmail.com`** — with an `s`. Resend accepts either; a typo'd address is dropped
silently and for ever, which is the one failure mode a monitoring alert cannot afford. Confirm the
spelling before setting `ADMIN_ALERT_EMAIL`.

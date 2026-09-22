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

## Built (revised 2026-09-22 — the first cut was a parallel email; this is a CC)

The first build sent a SECOND email from a new `alertAdminFailure`, which duplicated
`notifyOrderResult`'s select and outcome-building and read the order twice per failure.
Collapsed to a **copy on the existing email**: one read, one send, one body — so the agent and the
admin can never be told different things about one order. `alertAdminFailure`, `adminOrderUrl`, the
`adminLink` option and the `footerNote` parameter are all gone (net −63 lines).

### 1. The chokepoint is `recordEvent`, not the six call sites

All six write their failure through `recordEvent` (`src/lib/order-history.ts`) — 17 call sites, 5 files,
and it already swallows its own errors so a diagnostic can never fail the submit it describes. One guard
there beats a call bolted onto every caller, and it cannot be forgotten by a seventh path added later.

```ts
// src/lib/order-history.ts — end of recordEvent(), after the insert
if (e.status === "failed" || e.status === "warning") {
  await notifyOrderResult(e.orderId).catch(...);
}
```

The status check is in memory, so the ~90% of calls that are stage milestones cost nothing. Awaited
rather than floated — a promise left running after a serverless function returns may never finish.

Calling `notifyOrderResult` rather than a parallel notifier is what makes this safe to run beside the
webhook: it already claims the send on `notified_at`, so the two race and exactly one wins.
**It also fixes a bug for free** — those five paths emailed nobody at all, the agent included.

### 2. The admin is copied in, not sent to separately

`sendEmail` gains an optional `cc`. `notifyOrderResult` sets it to `ADMIN_ALERT_EMAIL` when the
outcome is a failure, and to nothing on a success — copying every submit is how an address gets
filtered into a folder nobody reads.

- **`ADMIN_ALERT_EMAIL`, not a hardcoded address.** The env var already exists
  (`src/app/api/cron/retry-sweep/route.ts:61`, stuck-lock alerting). Unset → no copy, which is the
  behaviour that shipped.
- **The `autoRetryAt` gate is `notifyOrderResult`'s own, already there.** An order with a retry owed
  is not finished; without it a run that fails twice then succeeds sends two false alarms.

### 3. The link — `/order-entry/orders/<id>`

One email now has two readers, so there is one link rather than a per-recipient variant. The agent
owns the order and `getOrderDetail` also admits a superadmin, which is what the copied-in address is.
The admin route was dropped with the second email: it is behind the separate admin JWT, and one body
cannot carry a door only one reader can open.

**This improves the agent's email too** — it previously linked only to the draft editor (and only for
`fix_field` codes) and the Orders list, never to the order itself.

## Not built

- **A separate admin email or template.** The agent's failure email already carries every field
  asked for, and one body cannot disagree with itself.
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

## The address

Confirmed by the user, 2026-09-22: **`jobhunters.ai.pro@gmail.com`** (with the `s`). Set it as
`ADMIN_ALERT_EMAIL` on Vercel; until then the copy is off and the agent's email is unchanged.

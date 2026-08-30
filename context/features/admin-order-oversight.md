# Admin Order Oversight

**Status:** SPEC — approved in design 2026-08-30, implementation starting.
**Surface:** a third sub-page under `/admin`, beside Users and Plan Settings.
**Needs a migration** (`orders.deleted_at`, plus an index on `order_status_events`).

---

## The ask

> Admin can see and check every order — draft, running, submitted, **and deleted** — across all agents.
> Show the daily usage trend per agent, and what the failures are actually caused by. The main function
> is to know each agent's usage, their main error, and to be able to open an order's details.

---

## Decisions taken with the user

| Question | Answer |
|---|---|
| What does Delete mean now? | **Soft delete.** A `deleted_at` column; the agent's Delete hides rather than destroys |
| What is one unit of "usage"? | **Orders successfully submitted** — output, not effort |
| Which failures does the error breakdown count? | **Every failed attempt in history**, not just orders sitting failed now |
| Can admin act? | **View + restore + permanently purge** |
| Documents in the admin detail view? | **Listed but not viewable** in v1 (see Known limits) |

The usage unit and the error source were chosen as a pair, and they work because of it: the trend measures
**output** while the error breakdown measures **struggle**. Counting successes alone would have hidden an
agent failing twenty times; the error half is what stops that.

---

## What the data actually looks like

Measured on the dev database, 2026-08-30 — these numbers drive three design decisions.

- **4 orders → 140 events.** 134 of them are `status: "submitting"`: per-stage milestones, several dozen
  per run. **So attempts must never be counted by counting rows** — that overcounts ~35×. Failed attempts
  are `DISTINCT (order_id, attempt)` among terminal events only.
- **Unclassified errors are the MAJORITY.** Two of three `warning` events carry `error_code = null`. A
  breakdown that filtered nulls out would report one error where three happened — understating exactly
  what the page exists to surface. They bucket as **Unclassified** and keep their `message`.
- **Events grow ~35× faster than orders**, so the aggregation queries need an index that does not exist
  today (the only one is `(orderId, createdAt)`).

---

## Data model

```
orders.deleted_at  TIMESTAMP NULL          -- indexed
order_status_events(status, created_at)    -- new index for the aggregations
```

Hand-authored migration applied with `migrate deploy` — `migrate dev`'s shadow database fails in this repo.

### Soft delete, and the expensive bug it would otherwise cause

`deleteOrder` becomes an update setting `deletedAt`. **It must also clear `autoRetryAt` and `jobId` in the
same write.**

`sweepPendingRetries` selects purely on `autoRetryAt`, `status` and `autoRetries`
([order-retry.ts:155-164](../../src/lib/order-retry.ts#L155-L164)) — deletion does not enter that query. A
soft-deleted order with a retry owed would be **picked up by the cron and submitted to the live Unifi
portal**, minting a real billable order for a draft the agent deleted, with no row in their list to show
it happened.

Both halves are done: the delete clears the retry state, AND the retry queries gain the filter. Either
alone is a single point of failure for an expensive mistake.

### One filter, not fifteen

There are ~15 real `prisma.order.*` call sites across `actions/order.ts`, `lib/order-retry.ts`,
`lib/order-start.ts` and the API routes. A shared `ACTIVE_ORDER` where-fragment is applied at each, so
"which queries exclude deleted orders" has one grep and one answer. **Admin queries deliberately omit
it** — that is the only place that sees everything.

---

## The page

`/admin/orders`, with detail at `/admin/orders/[id]`. Both under `src/app/admin/(dashboard)/`, inheriting
the existing env-based admin JWT gate — no new auth.

Four bands under a shared date-range / agent / status filter:

1. **KPIs** — submitted in range, failed attempts, active agents, deleted count.
2. **Daily trend** — successful submits per day, from `submitted` events, dated by the event's own
   `createdAt` (`Order.updatedAt` moves for unrelated reasons and would put submits on the wrong day).
3. **By agent** — the spine, since this is the main function. Agent · submitted · failed attempts ·
   success rate · **top error**. One table answering "usage of each agent" and "main error of agent".
4. **All orders** — every agent, every status, deleted included and marked. Its own filters. Row → detail.

A global error breakdown renders beside the trend rather than as a fifth band: it is the agent query
without the grouping, and one answer should live in one place.

### Detail reuse

`OrderDetailHero`, `OrderDetailsTab` and `OrderAttemptHistory` already exist and are presentational. The
single coupling is `OrderAttemptHistory` calling `getOrderHistory` (NextAuth-gated). It gains an optional
injected-history prop, so the admin route fetches server-side under admin auth and passes it down while
the agent page keeps calling the action exactly as today. No duplicate detail view, and no NextAuth
dependency inside `/admin`.

---

## Queries

`$queryRaw` with `date_trunc`, not JavaScript bucketing — pulling events into Node works at 140 rows and
stops working quietly.

**Daily buckets are Malaysia time:** `date_trunc('day', created_at AT TIME ZONE 'Asia/Kuala_Lumpur')`.
UTC would split a Malaysian working day at 8am local, putting evening submits on the next day's bar. Same
class of bug as the appointment lead time, where the container's UTC clock made a 12-hour lead behave
as 4.

## Actions

`src/actions/admin-orders.ts`, following `admin-users.ts` (the admin JWT gate, not `auth()`):

- `adminListOrders(filters)` · `adminOrderStats(range)` · `adminGetOrderDetail(id)`
- `adminRestoreOrder(id)` — clears `deletedAt`
- `adminPurgeOrder(id, typedPhrase)` — the real delete, cascading the history away

**Purge requires the caller to have typed a confirmation phrase, checked server-side.** `reference` is
nullable and bulk-created drafts have none — exactly the orders most likely to be junk — so the phrase is
`reference ?? fullName`, derived by one pure function used by both the dialog and the server check so
they cannot disagree about what the user was asked to type.

---

## Error handling

- Actions return `{ success, data, error }`; the admin gate redirects to `/admin/login` as the other
  admin pages do.
- Empty range → an empty chart with a message, not an axis with no bars.
- Agents with no activity in range are omitted from By-agent; a table of mostly-zeros hides the signal.
- `to < from` refused client-side, clamped server-side.

---

## Testing

The logic lives in pure functions and they take the unit tests — day bucketing, top-error selection, the
Unclassified bucket, attempt de-duplication, the purge phrase. Three matter most:

1. **A soft-deleted order is not picked up by `sweepPendingRetries`** — the guard against submitting a
   deleted order to the live portal. Must fail without the fix.
2. **`listOrders` excludes deleted; `adminListOrders` includes them** — the one asymmetry the feature
   rests on.
3. **Attempt counting does not inflate** — fed one attempt with ~35 `submitting` events and one terminal
   event, it reports 1.

Then browser verification against the dev database on the real admin login.

---

## Known limits, stated up front

- **Documents and capture frames will not render for admin.** `/api/orders/document` resolves R2 keys
  against the *caller's* namespace and admin has none. The detail view says N documents are attached but
  not viewable here, rather than showing a broken thumbnail. Making them work needs an admin-scoped
  document route — and a deliberate decision about whether admin should see customers' MyKad scans.
- **The database now retains customer PII for orders people believe they deleted.** That is the direct
  cost of the feature. Purge is the release valve, and it is manual.
- **Nothing already deleted comes back.** This works from the migration forward; earlier history is gone.

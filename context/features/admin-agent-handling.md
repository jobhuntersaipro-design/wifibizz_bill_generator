# Admin Agent Handling

**Status:** SPEC — approved in design 2026-08-30. Nothing implemented.
**Depends on:** Admin Order Oversight (merged, deployed 2026-08-30) — this extends that page.
**No migration.** Every phase reads columns and endpoints that already exist.

---

## The ask

> Make it easy to handle the agents from the admin page: more filters on the daily charts, and the
> functions I'm missing.

Chosen from a menu of twelve candidates (user, 2026-08-30): **connection state per agent, a live jobs
panel with force-release, per-agent chart filters with day/week/month granularity, and an agent detail
page.** Search, stuck-order sweep, bulk purge and CSV export were offered and not picked.

**Guarding decision:** actions that touch a possibly-live run (force-release) get a **confirm dialog
naming the agent and the order** — the same weight as the existing cancel dialog, not a typed phrase.

---

## Why these four

The oversight page shows **history**. It says nothing about what is true *right now*: whether an agent
can submit at all, or who is holding a submit slot this minute. Both gaps cost time on 2026-08-30 —
a stuck lock was only diagnosable by `curl`, and "session expired" appears in the error breakdown only
after it has already failed a run.

Two admin surfaces already exist and do not talk to each other: **Users** (create, edit, access toggle,
case limit) and **Orders** (history, statistics). An agent's picture is split across them. The detail
page is where they meet.

---

## Decisions made without asking

- **Week buckets are Monday-start, Malaysia time**, matching the day buckets already shipped.
- **No new "edit agent" form.** Users already has one; a second copy is how two forms drift. The detail
  page links to it.
- **Only the live panel auto-refreshes.** A table that reshuffles under the cursor is worse than a
  stale one; the rest reloads on the existing date-range change.
- **No schema change.** `DealerAccount` already carries everything Phase 1 needs, and `GET /jobs`
  already answers everything Phase 2 needs.

---

## Phase 1 — Connection state per agent

### What admin sees

| State | Text | Tone |
|---|---|---|
| `sessionExpiresAt` in the future | *Connected · expires in 4h 12m* | green |
| `sessionExpiresAt` in the past | *Expired 2d ago* | amber |
| no `DealerAccount` or no `sessionExpiresAt` | *Never connected* | grey |
| expires within 30 minutes | *Connected · expires in 12m* | amber — the run about to be started would outlive the session |

Rendered as a **Connection** column in the By-agent table and in the Users list, and a KPI tile
*Agents connected* on the oversight page.

### How

**No droplet call.** `dealerSessionLive()` in `order-start.ts` already decides "can this agent submit"
purely from `sessionExpiresAt`; admin reads the same column, so the two cannot disagree about who is
connected.

Pure `describeConnection(dealer, now)` in `src/lib/agent-connection.ts` returns `{ state, label,
tone }`. One rule, so the words and the colour come from one place. `now` is injected for the tests.

`adminOrderStats` and `getUsers` each gain a `connection` field per agent from a single
`dealerAccount.findMany` — one extra query, not one per agent.

### Tests

The four states, the 30-minute amber threshold at both sides of the boundary, and the label's
duration wording (`4h 12m`, `12m`, `2d ago`) reusing `formatDuration`.

---

## Phase 2 — Live jobs panel with force-release

### What admin sees

A **Running now** card at the top of `/admin/orders`, polled every 10s. Per job:

- agent (by `user_key` → email), the BizzFlow order it belongs to, stage, elapsed
- **Stuck** in red once elapsed exceeds the server's `max_job_runtime_s` — the same rule the agent-side
  hover text already applies, so the two surfaces cannot disagree about what "stuck" means
- a **Release** button

Empty state: *No submits running.* Unreachable droplet: *Could not reach the order service* — never
an empty panel, because empty means idle and unreachable does not.

### The order match

`GET /jobs` carries `job_id` and `user_key`, not the BizzFlow order. The panel resolves the order by
`Order.jobId` — the same column the progress poll already uses. A job with no matching order (the row
was deleted mid-run, or the id was never written) is shown as *unknown order* rather than dropped: a
slot held by something nobody can name is precisely the case an admin needs to see.

### Release

`adminReleaseJob(jobId)` in `admin-orders.ts` → `POST /jobs/<id>/cancel?force=1` with the token,
server-side. The confirm dialog names agent + order and **repeats what the endpoint honestly reports**:

> *This frees the slot so other agents can submit. It does **not** stop the run — if a browser is still
> working on the portal it will carry on, and this order may still receive a result.*

A `not_cancellable`/`unknown_job`/`not_running` answer is shown verbatim as a toast; the panel refreshes
either way.

**Ordinary cancel is tried first.** Force is the fallback: the route answers `202 cancelling` when a live
task handle exists, which actually stops the run and is the better outcome. Only on `409 not_cancellable`
does the action retry with `?force=1`. So "Release" does the most it can, and the dialog copy covers
the weaker case because that is the one the admin cannot predict.

### Where the data comes from

`scraperBusy()` already fetches `GET /jobs` server-side with `ORDER_ENTRY_API_TOKEN`. A new
`adminLiveJobs()` does the same call under the **admin** gate (`verifyAdminSession`, not `auth()`) and
returns the rows joined to orders. No new public endpoint; the token never reaches the browser.

### Tests

The stuck rule against the cap; the unknown-order row surviving rather than being dropped; the
cancel-then-force sequence (ordinary cancel accepted → no force call; `not_cancellable` → force
called; `unknown_job` → reported, no force). Browser: against a stub droplet — a running job, a stuck
job, release confirmed, release cancelled, droplet unreachable.

---

## Phase 3 — Chart filters: agent, and day / week / month

### What admin sees

Above the trend and the error breakdown, sharing the existing date range:

- **Agent** select (all / one). The By-agent table stays global — it is the thing you use to *pick* an
  agent.
- **Granularity** segmented control: Day · Week · Month. Auto-default from the range — ≤31 days → day,
  ≤180 → week, else month — and overridable.

### How

No new queries. The same terminal events are grouped differently in the pure layer:

- `bucketKey(date, granularity)` beside `dayKeyMYT`. Week = the Monday of that MYT week, as an ISO
  date; month = `YYYY-MM`. All in Malaysia time.
- `fillDays` generalises to `fillBuckets(rows, from, to, granularity)`.
- `submitsPerDay` → `submitsPerBucket(events, granularity)`.
- The agent filter is a `userId` predicate applied before bucketing, in `adminOrderStats` — so the
  KPI tiles, the trend and the errors all narrow together and cannot disagree.

### Tests

Bucketing at the MYT boundary for each granularity: a **Sunday 23:30 MYT** submit must land in that
week, not the next (it is Sunday 15:30 UTC, and a UTC Monday-start week would agree here — so the test
also uses **Sunday 20:00 UTC**, which is Monday 04:00 MYT and must land in the *next* week). Month
boundary likewise. The auto-granularity thresholds at 31/32 and 180/181 days. `fillBuckets` producing
zero-weeks and zero-months, and terminating on a reversed range.

---

## Phase 4 — Agent detail page

`/admin/agents/[id]`, linked from three places: the Users row, the By-agent row, and the agent name on
every order row. It **composes** Phases 1–3 rather than adding queries.

### Layout

1. **Header** — email, name, notes, case limit, `Connection` (Phase 1), and the **order-entry access
   toggle** (the existing `setOrderEntryAccess` action). *Edit* links to the Users page rather than
   duplicating its form.
2. **Running now** — this agent's job, if any, with Release (Phase 2, filtered to one agent).
3. **Trend and errors** — Phase 3's components with the agent filter pinned to this agent and the
   granularity control kept.
4. **Orders** — the oversight table filtered to this agent, deleted included, Restore/Purge intact.

### How

One server component reads under the admin gate and passes plain data down. `adminOrderStats` and
`adminListOrders` already accept an `agentId`; the page calls them with it. The only new action is
`adminGetAgent(id)` — user + dealer account, `notFound()` on an unknown id.

### Tests

Nothing new in the pure layer — it composes. Browser: the page on a real agent, the three inbound
links, the access toggle flipping and surviving a reload, and the 404 on an unknown id.

---

## Sequencing

1 → 2 → 3 → 4, each shippable alone. Phase 4 is last because it is mostly assembly and needs the other
three to exist. Phases 1 and 3 are pure and low-risk; Phase 2 is the one with a live-run action and gets
the most browser time.

---

## Known limits, stated up front

- **"Connected" means the stored expiry is in the future.** The portal can invalidate a session early
  — a password change, a second login — and the app only learns that when a run fails. A green row is
  "should be able to submit", not a guarantee.
- **Release does not stop a run when no task handle exists**, and the dialog says so. The genuinely
  stuck case is the one where the handle is gone.
- **Force-release has never been exercised against a real running portal job**, only against Flask's
  test client and a stub — the same caveat the underlying endpoint carries.
- **Elapsed on the live panel is the droplet's clock**, not the browser's; a 10s poll means it can lag
  by up to 10s.

# Phase 7 — Admin Tools: Search, Alerting, Bulk Purge, CSV

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 7 of 9 — the four
tools offered and deferred when the oversight page was built.
**Scope:** Vercel-only. **No migration.** One new env var (`ADMIN_ALERT_EMAIL`).

---

## A. Search across all orders

A text box beside the oversight filters, matching **name, IC number, reference (ORD-xxxx), and the
portal order number** — the four things somebody arrives holding.

Client-side over the already-loaded rows, deliberately: the list is unpaginated by an earlier explicit
decision ("a filter that silently truncates is worse than a long page"), so the rows are already in
hand and a server round-trip per keystroke buys nothing. The predicate is a pure
`matchesOrderSearch(row, query)` — case-insensitive, IC matched with separators stripped so
`940811-03-4224` finds `940811034224` — with tests, because a search that silently misses is worse
than none.

## B. Alerting — the stuck lock reaches a human

Today the cron sweep logs a stuck submit lock to the console, where nobody reads it. It will now
**e-mail `ADMIN_ALERT_EMAIL`** (new env var; unset = today's behaviour, log only) through the existing
Resend sender: which job, which agent, held how long, and the one-line remedy (the Release button on
/admin/orders).

**Deduplication is stateless, by window:** the cron runs every 5 minutes; the mail is sent only when
the lock's age is between the cap and cap + 6 minutes — the one sweep tick where it first crosses. No
table, no marker, nothing to migrate; a lock that stays stuck mails ONCE. The trade: if that single
tick's send fails, no retry — accepted, because the admin Orders page still shows the stuck row and
this is a nudge, not the system of record.

Only the stuck lock in v1. Per-agent failure-rate alerts were considered and parked: choosing a
threshold nobody has data for yet produces either silence or spam.

## C. Bulk purge of old deleted orders

The PII release valve, currently one order at a time. A **"Purge deleted orders older than…"** control
on the oversight page: pick 30 / 90 / 180 days, see the exact count and the list of references that
would go, then **type the count** to confirm — the same guards-against-haste rule as the single purge,
adapted because there is no single name to type. Server-side the action recomputes the set (the dialog's
list could be stale), purges only rows already soft-deleted longer than the cutoff, and writes ONE
audit row naming the count and cutoff.

## D. CSV export

**Export CSV** beside the order filters, exporting exactly the FILTERED rows — what you see is what
you get, because an export that ignores the filters exports something the screen never showed. Built
client-side (Blob + download, no server route, nothing logged as an endpoint): reference, name, IC,
agent, status, error code, portal number, package, created, deleted-at. Proper CSV quoting via a pure
`toCsv(rows)` with tests — commas and quotes in names are certain at 50 agents.

## Tests

- `matchesOrderSearch`: each of the four fields; separator-insensitive IC; case; no cross-field false
  positives on short queries.
- The alert window: fires only in `(cap, cap+6min]`; never below cap; never twice (age beyond window).
- Bulk purge: recomputes server-side; refuses a mismatched typed count; touches only soft-deleted rows
  older than the cutoff; one audit row.
- `toCsv`: quoting of commas, quotes, newlines; header row; empty set.

Browser: search narrowing by IC fragment; the export downloading and re-parsing to the filtered count;
the bulk-purge dialog against the dev database's deleted orders (there are currently none — the dialog's
empty state is the verifiable part; a real purge is staged on a throwaway soft-deleted row).

## Not in scope

Per-agent failure alerts (no threshold data yet); scheduled/emailed exports; purge of non-deleted
orders (a live order is never bulk-destroyable, same as the single purge).

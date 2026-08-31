# Phase 5 — People Audit Trail

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 5 of 9 (shrunk by
the roles decision: no roles, so this is the trail alone).
**Scope:** Vercel-only. **Needs a migration** (`admin_audit_log` table).

Orders have an append-only history; people do not. Who enabled order entry for whom, who topped up
whose limit, who restored or purged a deleted order, who released a stuck job — none of it is recorded
anywhere except `CaseLimitChangeLog`, which covers exactly one of these.

---

## The honest limit, stated first

**The admin JWT carries `role: "admin"` and nothing else** — one shared identity from env credentials.
So the trail's `actor` for admin actions is the constant `admin`: it can say WHAT happened, WHEN, and
TO WHOM, but if two people ever share the admin password it cannot tell them apart. That is a
consequence of declining roles (2026-08-31), recorded rather than papered over. Self-service events
carry the real user id, because those run under NextAuth.

## The table

```
admin_audit_log (
  id          TEXT PK,
  actor       TEXT      -- "admin", or a user id for self-service events
  action      TEXT      -- fixed vocabulary below
  target_user  TEXT NULL,   -- whom it was done to
  target_order TEXT NULL,   -- which order, when order-shaped
  detail      TEXT NULL,    -- one human sentence, never JSON to parse later
  created_at  TIMESTAMP
)
```

Append-only by convention AND by code: the module exposes `recordAudit()` and a read query, nothing
else. No update, no delete. Foreign keys deliberately ABSENT: purging a user or an order must not
destroy the record that says who purged it.

## What gets recorded

| Action | Where it hooks | Detail sentence |
|---|---|---|
| `user_created` / `user_updated` / `user_deleted` | `admin-users.ts` | what changed, never the values of secrets ("password changed", not the password) |
| `order_entry_enabled` / `order_entry_disabled` | `setOrderEntryAccess` | — |
| `case_limit_topup` | `topupUserCaseLimit` | amount + reason (mirrors `CaseLimitChangeLog`, which STAYS — it is billing's immutable record; this is the people view) |
| `order_restored` / `order_purged` | `admin-orders.ts` | reference/name |
| `job_released` | `adminReleaseJob` | job id + whether the run was actually stopped |
| `password_changed` / `password_reset` | `account.ts` | actor = the user themselves; no admin involved |

**Failures are not recorded** — a refused purge changed nothing. The trail answers "what happened",
not "what was attempted"; mixing the two makes every reader filter.

**Recording never blocks the action.** `recordAudit` catches and logs its own failure — an audit
outage must not make user management fall over. The trade (an action could succeed unrecorded) is
accepted and stated; the alternative couples every admin operation to one table's availability.

## The view

A read-only **Activity** section on the existing `/admin` Users page (below the table, collapsed to
the latest 20 with "show more"), not a fourth sidebar page — it is one list, and it belongs where the
people are. Each row: when · actor · sentence. No filters in v1; the list is young and small.

## Tests

- Every named action writes exactly one row with the right shape (mocked prisma).
- Secrets never reach `detail` — a `user_updated` for a password change must not contain the password.
- A failing `recordAudit` does not fail the action it records.
- Self-service events carry the user id, admin events the constant.

Browser: flip order-entry access on a test user, watch the row appear; restore.

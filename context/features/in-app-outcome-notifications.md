# Phase 2 — In-App Outcome Notifications

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 2 of 9.
**Scope:** Vercel-only. No scraper change. **Needs a migration** (`orders.outcome_seen_at`).

A submit takes minutes and an agent closes the tab. Today the only signal that reaches them afterwards
is e-mail. This gives the app itself a memory of what finished while they were not looking.

---

## The one concept: an unseen outcome

An order whose run reached a terminal state (`submitted` / `failed` / `warning`) **that no signed-in
eye has seen yet**. One nullable column carries it:

```
orders.outcome_seen_at  TIMESTAMP NULL     -- NULL on a terminal order = unseen
```

### When it is SET (the outcome was seen)

1. **The agent watched it finish.** The progress poll (`/api/orders/[id]/progress`) runs from the
   watching browser under the agent's session — when it delivers a terminal state, that delivery IS
   the seeing, and the route stamps it. The webhook path stamps nothing: it fires with the tab closed,
   which is exactly the case this feature exists for.
2. **The agent opens the order's detail page.**
3. **The agent dismisses it from the "while you were away" list** (per order, or Dismiss all).

### When it is CLEARED

In `startSubmitRun` — the one place every submit begins, single, batch and retry alike — so a new run
always produces a fresh outcome, and the rule cannot be forgotten by a new caller.

### Backfill, and why it matters

The migration marks **every existing terminal order as seen** (`outcome_seen_at = updated_at`).
Without that, the day this deploys every agent gets a badge counting their entire history — a wall of
"unseen" that trains them to ignore the badge in its first minute.

---

## Surfaces

### 1. Badge on the Orders tab

A count chip on the **Orders** tab in `OrderEntryShell`, and the same on the dashboard sidebar's
**Order Entry** link. Capped display at `9+`. Polled by a tiny `unseenOutcomes()` server action every
30s from the shell — the count only, no rows, so the poll stays cheap.

### 2. "While you were away" — the list

A dismissable card at the top of the Orders list, shown only when unseen outcomes exist: one row per
order — reference, name, outcome pill, and **the Phase 1 action button** (Fix the draft / Check at
Unifi / …), because the point of telling an agent something failed is what they do next. Per-row
dismiss and Dismiss all.

### 3. No separate "toast on return"

The plan named one; it is dropped, deliberately. The badge says *that*, the card says *what and do
this* — a toast repeating the card that is already on screen is noise, and it would fire on every
visit until the card is dismissed. (If the card proves too easy to miss, a toast is a five-line
follow-up.)

---

## Ownership

Unseen outcomes belong to the **draft's owner** (`userId`), not to whoever pressed Submit — a
superadmin submitting another agent's draft is acting for that agent, and the outcome is the agent's
to act on. Superadmins see only their own orders' outcomes in the badge, exactly as `listOrders`
scopes rows.

---

## Pieces

| Piece | What |
|---|---|
| Migration `…_order_outcome_seen` | column + backfill of existing terminal orders |
| `unseenOutcomes()` in `actions/order.ts` | `{ count, orders: [...] }`, ACTIVE_ORDER-scoped, owner-scoped |
| `markOutcomeSeen(ids)` | conditional update, owner-scoped |
| progress route | stamps `outcome_seen_at` when it reports a terminal state |
| `startSubmitRun` | clears it |
| `UnseenOutcomes` component | the card, reusing `SubmitErrorBlock`'s action row |
| `OrderEntryShell` + dashboard sidebar | the badge |

## Tests

- The stamp: a terminal poll marks seen; a non-terminal one does not.
- The clear: `startSubmitRun` nulls it on every path (person, batch, auto-retry).
- Scoping: an agent never counts another agent's outcomes; a superadmin's badge counts their OWN, not
  everyone's.
- The backfill rule (pure): existing terminal orders seen, in-flight and drafts untouched.
- Dismiss-all only touches terminal, unseen, owned rows.

Browser: finish a run with the tab closed (stub droplet), return → badge, card, action button;
dismiss → badge falls; watch a run live → no badge afterwards.

## Known limits

- The badge is 30s stale at worst, same trade as the busy poll.
- "Seen" is per-account, not per-device: seeing it on the phone clears it on the laptop. At 50 agents
  each with one account that is correct; on a SHARED login one person's seeing clears it for everyone —
  one more cost of shared logins, already documented as such.

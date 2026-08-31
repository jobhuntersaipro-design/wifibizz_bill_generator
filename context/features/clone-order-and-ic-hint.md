# Phase 8 — Clone Order, and a Duplicate-IC Hint

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 8 of 9.
**Scope:** Vercel-only. No scraper change, no migration.

Two small agent-side tools with one shared theme: the app already knows this customer, and today it
says nothing until the portal does.

---

## A. Clone order

A **Clone** entry in the order row's `⋯` menu (every status — cloning a submitted order is the
"second line for the same customer" case, and cloning a failed one is "start clean"). It opens New
Order prefilled from the source: customer, contact, address, package, device, remarks, appointment
lead hours.

**Deliberately NOT cloned:**

- **Run state** — status, attempts, portal number, errors, history: a clone is a new draft, full stop.
- **Reference** — a fresh ORD-xxxx is assigned at save, as for any draft.
- **Documents.** Two reasons, the second decisive: the paperwork may genuinely differ per order, and
  the R2 key scheme is `orders/{userId}/{idNumber}_{slug}_{n}` — the documented trap where two orders
  for one customer mint the SAME key and the second upload silently replaces the first. Sharing
  document entries across clones turns that latent trap into a certainty. The clone's Documents card
  starts empty; the generators are one click ("Generate all N" exists), and the hint card (below)
  reminds the agent why.

**Mechanics:** `?clone=<id>` on the New Order page. The form loads the source through the existing
`getOrder` (owner-scoped; a superadmin may clone any order — same visibility rule as everywhere),
copies the fields above into fresh state, and keeps `draftId` null so saving CREATES. The address
`addressId` is carried — it is the portal's own unit id and exactly what a same-address clone wants.

## B. Duplicate-IC hint

When the ID Number field holds a complete IC, the form quietly asks the server whether that IC already
appears on other orders, and shows a small informational card under the Customer section:

> **This IC already has orders.** ORD-0042 (Submitted) · ORD-0051 (Draft) — and 1 more by another
> agent. The portal will attach the existing customer record rather than creating a new one.

- **Non-blocking, informational.** The portal handles duplicate customers correctly (the
  `multiple_customer_records` reuse path); the hint's job is stopping the *unintentional* duplicate
  draft, not forbidding the intentional second line.
- **Scoping:** the agent sees **their own** matching orders by reference and status, plus a bare COUNT
  of other agents' matches — another agent's customer list is not theirs to browse, but "someone else
  is already working this IC" is exactly the collision worth surfacing.
- Debounced (500ms), fires only on a structurally complete IC, excludes the order being edited, and a
  lookup failure shows nothing — a hint must never block typing.
- New action `ordersForIc(idNumber, excludeId?)` → `{ mine: [{id, reference, status}], othersCount }`,
  matching separator-insensitively (the same rule the admin search uses, from `admin-search.ts`).

## Tests

- The clone field-set: everything copied, everything excluded — pinned as a LIST in one pure function
  (`cloneOrderInput(order)`), so a new Order column cannot silently join or miss the clone.
- `ordersForIc`: separator-insensitive match; own-vs-others split; excludes self; owner scoping.
- Hint gating: fires only on complete ICs; silent on failure.

Browser: clone ORD-0002 → form prefilled, Documents empty, saving creates a NEW draft (then delete
it); the hint card appearing when typing an IC that exists (WOJAK LANG's), naming the agent's own
orders; 375px.

## Not in scope

Cloning documents (above); a portal-side duplicate check (the scraper already handles attach-existing);
blocking saves on duplicate ICs — two live orders per customer is a legitimate business case.

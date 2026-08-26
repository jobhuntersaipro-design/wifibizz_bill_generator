# Order Entry — Orders Detail Page (replace slide-in with /{orderId})

## Status

Spec — not started

## Problem

Order details currently open in `OrderHistoryPanel.tsx`, a right-side `Sheet` triggered by client-only state (`historyId` in `OrdersList.tsx`). Nothing about which order is open lives in the URL: a refresh, a shared link, or opening in a new tab all lose it. The panel is also capped to `sm:max-w-[30rem]` — cramped for the amount of content it now holds (hero, 3 stat tiles, 3 tabs, capture carousel launcher).

## Goal

Clicking an order (row click, or the `⋯` menu's "Details") **opens a new tab** at a dedicated URL:

```
/dashboard/order-entry/orders/[orderId]
```

instead of the slide-in Sheet. The Orders list page keeps its current URL/behavior otherwise.

## Route & Data

- New page: `src/app/dashboard/order-entry/orders/[orderId]/page.tsx`.
  - Follows the `params: Promise<{ orderId: string }>` App Router pattern already used in `src/app/api/orders/[id]/progress/route.ts`.
  - **Async server component** (not a client-page-that-delegates, unlike `drafts/page.tsx`/`new-order/page.tsx`) — this page has one clear initial data need (the order), so it can do the auth-scoped fetch server-side and hand the result to a client component for the interactive parts (tabs, polling, carousel). Not-found / access-denied are handled with `notFound()` from `next/navigation`.
  - Needs its own `layout.tsx`? No — it inherits `src/app/dashboard/order-entry/layout.tsx`'s existing access gate (superadmin check, `hasOrderEntryAccess`), so no new gating logic. Confirm the layout's nav/shell still renders sensibly for a page one level deeper than `drafts`/`new-order` (the "Orders" tab should still show active — check `OrderEntryShell.tsx`'s active-tab matching logic covers a path prefix, not just exact match).
- **New server action**: `getOrderDetail(id: string)` in `src/actions/order.ts`, returning the order already shaped as `OrderListItem` (same shape `listOrders()` produces per-row: formatted phone, `docCount`, `createdByEmail` for superadmins, `installationDate` backfilled from e-RF, stale-submit reconciliation) plus `{ success, data }`/`{ success: false, error }`. Implementation: extract the existing per-row mapping logic out of `listOrders()` into a shared helper (e.g. `toOrderListItem(order, opts)`), call it from both `listOrders()` (loop) and `getOrderDetail()` (single row) — do not duplicate the mapping logic. Auth-scoped identically to `getOrder()`/`getOrderHistory()`: `superAdmin ? {id} : {id, userId}`.
  - `getOrder(id)` (raw Prisma row, no shaping) stays as-is — it's used elsewhere (e.g. edit-mode load in `OrderForm`) and is out of scope to change.
  - `getOrderHistory(id)` stays as-is — the new page's History/Progress tabs call it exactly as `OrderHistoryPanel` does today, including the 4s poll while `status === "submitting"`.

## Page Layout

Reuse the **content** of `OrderHistoryPanel.tsx` (header, hero card, voiding warning, 3 stat tiles, 3 tabs: Progress/History/Order) but laid out as a full page rather than a 30rem-wide Sheet:

- Header: back link (`← Orders`, `router.back()` — see Back Navigation below) instead of a Sheet close (X) button. Same avatar-initials, name, reference badge, ID badges.
- Hero, voiding warning, stat tiles: same content, given breathing room at page width (e.g. `max-w-3xl` or `max-w-4xl` container, centered) instead of being squeezed into 30rem.
- Tabs: same three (Progress/History/Order), same default-tab logic (`"progress"` if live else `"history"`).
- **Extract, don't fork**: pull the tab content (`Attempt`, `ShotRow`, `CapturesStrip`, `OrderDetails`/`DetailRow`/`SectionCard`, the polling `useEffect` for `getOrderHistory`) out of `OrderHistoryPanel.tsx` into shared components/hooks importable by both the old panel and the new page — do NOT copy-paste ~900 lines into a second file. Suggested split: `src/components/order-entry/order-detail/` holding `OrderDetailHero.tsx`, `OrderAttemptHistory.tsx` (the `Attempt`/`ShotRow`/`CapturesStrip` group + history-fetch hook), `OrderDetailsTab.tsx` (the read-only `OrderDetails` view). `OrderHistoryPanel.tsx` (Sheet chrome) and the new page (full-page chrome) both compose from these.
- **`CaptureCarousel`**: stays exactly as-is, client-only Dialog overlay, opened the same way from inside the extracted `Attempt` component — no URL/query-param change (per your answer). It portals above whatever page it's opened from, so this works unchanged on the full page.

## What Happens to `OrderHistoryPanel.tsx`

Per your requirement ("no longer have the slide-in modal... open in a new tab"), the Sheet-based panel is **removed as the click target** for viewing an order:

- `OrdersList.tsx` / `OrderRow.tsx` / `OrderCard.tsx`: the "Details"/history trigger changes from `setHistoryId(o.id)` to a real navigation that opens a new tab — `<Link href={`/dashboard/order-entry/orders/${o.id}`} target="_blank" rel="noopener noreferrer">` (or `window.open` if the row's click handler isn't already an anchor). Confirm with a real click in the browser that this doesn't fight with the row's other click handlers (row expansion, checkbox selection) — `OrderRow.tsx` currently has multiple interactive regions in one row.
- `OrderHistoryPanel.tsx` and its `historyId` state in `OrdersList.tsx` are deleted once the extraction above is done and the new page is verified working — not kept around as dead code "just in case."
- Everything else that currently reads `historyOrder` (derived via `orders.find(...)` against the already-loaded list) goes away with it; the new page fetches its own data via `getOrderDetail`, independent of the list's in-memory state — which is also what makes "open in a new tab" correct (a new tab has no access to the list page's React state).

## Back Navigation

Per your answer: clicking into an order should feel like drilling down, and returning to the list should restore prior filters/scroll. Since the click **opens a new tab**, "back" isn't quite the browser back button on the *same* tab — clarify actual behavior:

- The detail page's back link/back-arrow does `router.back()` if there's browser history in that tab (i.e. the user navigated within the same tab after the new-tab was opened, or opened it via the new tab but then a same-tab flow exists), else falls back to `router.push('/dashboard/order-entry/drafts')` (a plain list link) if the tab has no meaningful history (which will be the common case, since "open in new tab" means the *new tab* has no prior entry).
- Because it's a **new tab**, the original Orders list tab is untouched — its filters/scroll are preserved for free (nothing navigated away from it). The "restore list state" requirement is satisfied structurally by opening in a new tab rather than needing router-level state restoration.

## Superadmin Fields

`getOrderDetail` includes `createdByEmail` the same way `listOrders()` does today (superadmin-only), and the page's "Other" section (Order tab) renders it exactly as `OrderDetails` does now.

## Not In Scope

- Redesigning the Edit flow — "Edit" still routes to `/dashboard/order-entry/drafts?draft=<id>` (existing `OrderForm` edit mode), unchanged.
- Deep-linkable Capture Carousel state.
- Any visual/style-system pass beyond fitting the existing panel content to a full-page width (no new color palette, no new component library) — this is a layout/routing change, not a redesign of the detail content itself.
- Changing `/drafts` as the Orders list URL segment (still out of scope per existing history note; not part of this feature).

## Acceptance Criteria

1. Clicking an order row's Details / the `⋯` menu's Details opens `/dashboard/order-entry/orders/{orderId}` in a **new browser tab**.
2. The new page shows the same content the Sheet showed: header, hero, voiding warning (if applicable), 3 stat tiles, Progress/History/Order tabs — laid out for full page width, not cramped.
3. Refreshing the new tab, or opening the URL directly (e.g. pasted from elsewhere), loads the same order detail — proves it's real server data, not client state.
4. History tab still polls every 4s while the order is submitting, and stops once it isn't.
5. Capture Carousel still opens over the detail page and behaves identically (arrow keys, thumbnail rail, swipe, no wrap, "Open original").
6. An order ID that doesn't exist, or belongs to another user (non-superadmin), 404s via `notFound()` rather than leaking data or crashing.
7. The original Orders list tab's filters/search/scroll position are untouched after opening a detail tab (verified by opening a detail tab, closing it, and confirming the list tab is exactly as left).
8. `OrderHistoryPanel.tsx`'s Sheet-based trigger path is fully removed — no remaining `historyId` state or Sheet-open UI in `OrdersList.tsx`.
9. `npm run build` and `npm run lint` clean; the extracted shared components render identically (byte-for-byte content, not necessarily byte-for-byte layout) whether composed inside the (if kept) old panel or the new page — though per this spec the old panel is removed, not kept.

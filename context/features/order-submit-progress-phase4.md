# Order Entry — Submit Progress Phase 4: Capture Carousel + Drafts Table Redesign

## Status

Spec — not started. Follows
[order-submit-progress-phase3.md](order-submit-progress-phase3.md) (branch
`feature/order-submit-progress-phase3`, commits `12fa534`, `2abb7ca`).

Four changes, two of them cosmetic-looking but load-bearing:

- **A. Captures open in a carousel**, not a raw browser tab.
- **B. A resubmit path** for orders the portal stranded.
- **C. `Customer` → `Full Name`**, ID number gets its own column.
- **D. The Drafts table redesigned** — Apple's spacing restraint, the existing
  Stripe palette.

---

## Context

### A. Nine frames, and every one of them is a tab

Phase 3 made a submit capture up to nine screens. Both ways into a frame —
[the thumbnail strip](../../src/components/order-entry/OrderHistoryPanel.tsx#L190-L233)
and [the inline shot row](../../src/components/order-entry/OrderHistoryPanel.tsx#L291-L312) —
end at `<a href={src} target="_blank">`, which hands the agent a bare JPEG on a
browser-chrome background.

Checking "was the right device picked?" against "was the right slot taken?"
therefore costs: click → new tab → read → close tab → find the panel again →
scroll → click the next one. Nine frames is eight of those round trips, and the
browser tab has no caption, so once it's open the agent no longer knows which
slot they're looking at.

The frames are already an ordered sequence with labels and timestamps. They
should be navigable as one.

### B. A stranded order has no button

`canSubmit` is
[deliberately strict](../../src/components/order-entry/OrdersList.tsx#L38-L39):

```ts
const canSubmit = (o) => !o.orderId && o.status !== "submitting";
```

Once the portal mints an order number the Submit button disappears — correct as
the default, because a second run would create a genuine duplicate order in the
live Unifi portal.

But the portal mints that number *before the device is even selectable*, so
every mid-flow failure strands a real order with `orderId` set and status
`failed` or `warning` — exactly what
[`needsVoiding`](../../src/lib/order-types.ts#L314-L318) already flags. Today
that row is a dead end: the agent voids it in the portal by hand, then has no
way to run it again except editing the draft, which doesn't clear `orderId`
either.

### C. `Customer` is two facts in one column

The Customer cell stacks the name over `idType · idNumber`. The header says
"Customer", the cell says three things, and the ID line's `tabular-nums`
competes with the name for the eye. The column is doing two jobs.

### D. The table is a wall

Ten columns (eleven for superadmins), every one bordered, `13px` throughout,
`py-3` rows, and an Actions column holding **three same-weight buttons**
(Edit / Submit / Delete) where two are destructive-or-slow and one is the thing
the agent actually came to do. Delete sits directly beside Submit at the same
size, differing only in colour.

Density is not the problem — agents scan many drafts. Undifferentiated density
is: nothing in a row is louder than anything else, so every row must be read
rather than scanned.

---

## Current State

| Piece | Where | Today |
|---|---|---|
| Capture strip | `OrderHistoryPanel.tsx:190` | thumbnails scroll the timeline into view |
| Capture frame | `OrderHistoryPanel.tsx:242` | `<a target="_blank">` → raw JPEG |
| Capture stream | `/api/orders/screenshot?key=` | auth-gated R2 proxy, unchanged |
| Drafts table | `OrdersList.tsx:445-678` | hand-rolled `<table>`, no shadcn |
| Submit gating | `OrdersList.tsx:38` | `!orderId && status !== "submitting"` |
| Customer column | `OrdersList.tsx:504-507` | name + `idType · idNumber` |
| shadcn installed | `src/components/ui/` | avatar, badge, button, card, collapsible, input, label, progress, separator, sheet, skeleton, sonner, tabs |

---

## Proposed Change

### 1. Capture carousel

A new `CaptureCarousel` component in `src/components/order-entry/`, built on the
shadcn `dialog` primitive (added in this phase) so it inherits the focus trap,
focus restore, Escape handling and scroll lock — the same reason Phase 2 moved
the history panel onto `Sheet`. It must render **above** the open history Sheet,
since that is what launches it.

**Scope: one attempt.** Opening any frame of attempt 3 gives a carousel over
attempt 3's frames only. Mixing runs would put "device page, attempt 1" next to
"customer page, attempt 2" with nothing but a caption to separate them, and the
question an agent is asking is always about one run.

Contents, top to bottom:

- **Header** — slot label (`captureLabel`), capture time, `n of 9`, close button.
- **Stage** — the frame, `object-contain` on a near-black scrim, sized to fit the
  viewport with no scroll. Previous/next chevrons flank it, hidden at the ends.
- **Caption** — `captureCaption(slot)`, plus the expiry line
  (`expiryLabel`) already computed by `expiryFor`.
- **Footer rail** — every frame of the attempt as a thumbnail, current one
  ringed, click to jump. This replaces nothing: `CapturesStrip` stays in the
  panel as the *index*, and now opens the carousel instead of scrolling.
- **Open original** — the existing `target="_blank"` link, kept inside the
  carousel. Removing it would lose the only way to get true pixel size.

Behaviour:

- `←` / `→` navigate, `Esc` closes, focus returns to the trigger.
- Navigation does **not** wrap. At frame 9 the right chevron is disabled — wrap
  makes "am I at the end?" unanswerable in a nine-item set.
- Adjacent frames are prefetched (`new Image().src`) so stepping is instant.
- Expired frames (past `CAPTURE_RETENTION_DAYS`) render the existing "deleted"
  message in place of the image; they stay in the sequence rather than being
  skipped, because their absence is itself information.
- Swipe left/right on touch.
- `prefers-reduced-motion` drops the slide transition to an opacity cut.

Both existing entry points — thumbnail strip and inline `ShotRow` — become
buttons that open the carousel at that frame's index.

### 2. Resubmit

`canSubmit` gains a sibling rather than being loosened:

```ts
// A stranded order: the portal minted a number, the run then failed. Runnable
// again ONLY after the agent voids the old order in the portal.
const canResubmit = (o) => needsVoiding(o) && o.status !== "submitting";
```

Fully-submitted rows stay locked. `submitting` rows stay locked.

The row's primary action becomes **Resubmit** (same handler, `runSubmit`) with a
distinct treatment: outline rather than filled, so it never reads as the routine
Submit. Clicking it opens a confirmation dialog that states the risk in the
portal's own terms:

> **Resubmit this order?**
> Order `<orderId>` already exists in the Unifi portal from attempt `<n>`.
> Running again creates a **second order**. Void the existing one in the portal
> first.
> [ Cancel ] [ I've voided it — resubmit ]

Confirmation is required every time, not remembered. This is the one action in
the app that can create real, chargeable duplicate work in a third-party system.

Batch selection is **not** extended to resubmittable rows — a bulk confirm would
defeat the point of the dialog.

### 3. Full Name + ID Number

- `Customer` header → `Full Name`; the cell renders only `o.fullName`.
- New `ID Number` column: `idNumber` in `tabular-nums`, with `idType` as a small
  muted prefix badge (`MyKad` / `Passport`) rather than an inline `·` string.
- Hidden below `lg` in the responsive rules below. Search keeps matching both
  fields, unchanged.

### 4. Table redesign

**Design language: Apple's spacing and hierarchy, Stripe's palette.** The rest
of the dashboard is Stripe-styled (Phase 14); a table that changes colour as
well as rhythm would read as a different product. What we take from Apple is
restraint, not hue.

| Principle | Applied |
|---|---|
| Air over borders | drop vertical cell borders entirely; one hairline `#E3E8EF` between rows; `py-4` rows |
| One voice per row | full name at `14px/600 #0A2540`; everything else `12–13px #697386` |
| One primary action | Submit (or Resubmit) is the only visible button; Edit + Delete move into a `⋯` menu |
| Quiet chrome | header row loses its `#F6F9FC` fill and uppercase tracking; becomes plain `11px` muted text over a hairline |
| Destructive is deliberate | Delete lives in the menu, styled `#DF1B41`, and keeps a confirm |
| Content sets the pace | address clamps to 2 lines as now; package/device stay 2-line-safe |

Components to add (`npx shadcn@latest add …`): `table`, `checkbox`,
`dropdown-menu`, `dialog`, `select`, `tooltip`. Existing hand-rolled `<input
type="checkbox">` and `<select>` are replaced by their shadcn equivalents so
focus rings and disabled states come from one place.

**Column order and responsive behaviour:**

| Column | ≥1280 | ≥1024 | ≥768 | <768 |
|---|:--:|:--:|:--:|:--:|
| select | ● | ● | ● | ● |
| Full Name | ● | ● | ● | ● |
| BizzFlow ID | ● | ● | ● | stacked under name |
| ID Number | ● | ● | — | — |
| Made By *(superadmin)* | ● | ● | — | — |
| Package | ● | ● | ● | stacked |
| Device | ● | ● | — | — |
| Address | ● | — | — | — |
| Status | ● | ● | ● | ● |
| Order No. | ● | ● | ● | stacked |
| Actions | ● | ● | ● | ● |

Below `768px` the table becomes a stacked card list — the current
`overflow-x-auto` shifts the whole grid sideways, which loses the name column
that anchors every row.

**Preserved exactly:** all polling and follow logic, `stageDetails` merge
semantics, the batch runner's sequential guarantee, the `loadError`-before-empty
ordering, the "Verified on Unifi" whisper, "Needs voiding", the Details button,
and every `aria-*` attribute currently present.

### 5. Bottom-of-tab captures (added 2026-08-17, scraper scope)

Added after the carousel made the problem visible: **every frame comes back
1192×716, identical for all five slots**, and the scraper's own log explains why —
`portal frame 716px in a 716px box — shot <body>` on every capture. The element
screenshot succeeds; the iframe's document genuinely reports 716px. The portal
scrolls its content in an inner container whose overflow never reaches
`body.scrollHeight`, so `<body>` photographs the box and everything below the
fold is cut.

What is cut is not decoration. On a sub-product tab it is **Select Offer** —
which discount and which device the portal actually attached, and at what
charge — plus Order Information. That is the half that gets disputed, and the
device is the field Phase 3 existed to photograph in the first place.

Each sub-product tab is therefore captured **twice**: as it opens, and again
scrolled to its end (`broadband_bottom`, `voice_bottom`, `tv_bottom`).

Deliberately **scroll-only**. Expanding the scroller (`height:auto`) would give
one full-height image, but it mutates the CSS of a live order form mid-submit,
and a restore that lost a race would leave the form altered while the submit
continued. Scrolling a container cannot change a field; a capture must never
cost an order.

The container is found by heuristic (largest element whose `scrollHeight`
exceeds its `clientHeight`), which **fails silently** — the same class of risk as
Phase 3's `_longest_title`. Every outcome is therefore logged: the container it
picked and how far it scrolled, `fits in Npx` when no second frame was needed,
or `no inner scroller found`.

### 6. Decomposition

`OrdersList.tsx` is 687 lines and this adds to it. Split along the seam that
already exists — data/orchestration vs. presentation:

```
OrdersList.tsx        state, polling, submit orchestration, filters  (~350)
OrdersTable.tsx       table shell, columns, responsive rules         (~200)
OrderRow.tsx          one row + its action menu                      (~180)
OrdersToolbar.tsx     search, status filter, bulk bar                (~110)
ResubmitDialog.tsx    the confirmation                               (~60)
CaptureCarousel.tsx   the viewer                                     (~220)
```

No behaviour moves during the split; the polling loops stay in `OrdersList`.

---

## Acceptance Criteria

1. Clicking any capture thumbnail or inline frame opens the carousel at that
   frame — no new browser tab.
2. `←`/`→` and the footer rail move between that attempt's frames; the chevron
   is disabled at each end.
3. `Esc` closes the carousel and focus returns to the element that opened it.
4. An expired frame shows the retention message inside the carousel and remains
   in the sequence.
5. "Open original" inside the carousel still opens the raw JPEG in a new tab.
6. A row with `needsVoiding` true shows **Resubmit**; a fully-submitted row shows
   no submit action at all.
7. Resubmit always opens the confirmation naming the existing order number, and
   cancelling runs nothing.
8. Resubmittable rows are not batch-selectable.
9. The header reads **Full Name** and the cell contains only the name.
10. **ID Number** is its own column; search still matches name *and* ID.
11. Each row shows exactly one visible action button; Edit and Delete are in the
    `⋯` menu.
12. At 375 / 768 / 1024 / 1440 px the table never scrolls the page horizontally,
    and the name is visible at every width.
13. Every interactive element has a visible focus ring and a ≥44px touch target
    on mobile.
14. `prefers-reduced-motion` suppresses the carousel slide and row animations.
15. `npm run build` and `npm run lint` pass; existing unit tests pass.

---

## Testing Plan

**Unit** (Vitest) — `canResubmit` truth table across the six statuses × `orderId`
present/absent; carousel index clamping at both ends; expiry classification
(fresh / soon / expired) at the boundaries.

**Browser** (Playwright, against a seeded local order):

1. Open a completed attempt with ≥2 captures → carousel opens at the clicked
   frame, arrows and rail navigate, Escape restores focus.
2. Force `CAPTURE_RETENTION_DAYS` low → expired frame renders the message.
3. Seed a `failed` order with an `orderId` → Resubmit appears, dialog names the
   order number, Cancel is a no-op.
4. Seed a `submitted` order → no submit action.
5. Resize to 375 / 768 / 1024 / 1440 → no horizontal page scroll; card list
   below 768.
6. Keyboard-only pass through toolbar → checkbox → row menu → dialog.

**Live** — one real submit on the droplet, checking the carousel against genuine
nine-frame output. The resubmit *path* is exercised with the confirmation
cancelled; an actual duplicate order is **not** created for testing.

---

## Rollback Plan

Each change is independently revertable:

- Carousel — `ShotRow`/`CapturesStrip` revert to `<a target="_blank">`; the
  carousel file is deleted. No data or API change.
- Resubmit — delete `canResubmit` and the dialog; gating returns to `canSubmit`
  alone.
- Columns and redesign — presentational only.

Nothing here touches the scraper, the database, R2, or any API route.

---

## Effort Estimate

| Item | Est. |
|---|---|
| shadcn primitives + decomposition | 1.5h |
| CaptureCarousel | 2.5h |
| Resubmit + dialog | 1h |
| Full Name / ID Number columns | 0.5h |
| Table redesign + responsive card list | 3h |
| Tests + browser verification | 2h |
| **Total** | **~10.5h** |

---

## Files Reference

| File | Change |
|---|---|
| `src/components/order-entry/CaptureCarousel.tsx` | new |
| `src/components/order-entry/OrdersTable.tsx` | new |
| `src/components/order-entry/OrderRow.tsx` | new |
| `src/components/order-entry/OrdersToolbar.tsx` | new |
| `src/components/order-entry/ResubmitDialog.tsx` | new |
| `src/components/order-entry/OrdersList.tsx` | shrinks to state + orchestration |
| `src/components/order-entry/OrderHistoryPanel.tsx` | strip + shot row open the carousel |
| `src/lib/order-types.ts` | add `canResubmit` |
| `src/components/ui/` | + table, checkbox, dropdown-menu, dialog, select, tooltip |

---

## Out of Scope

- Voiding an order from BizzFlow — the agent still voids in the Unifi portal.
  Automating it needs a portal flow we haven't mapped.
- Batch resubmit.
- Zoom / pan inside the carousel — "Open original" covers pixel-level reading.
- Rolling the Apple spacing out to the rest of the dashboard.
- Column visibility as a user preference.
- Any scraper, database, R2 or API change.

---

## Decisions Taken (2026-08-17)

| Question | Decision |
|---|---|
| Resubmit scope | failed/warning rows with an `orderId` only — never fully-submitted |
| Carousel scope | one attempt's frames, not all attempts |
| ID number | its own column, not dropped and not merged |
| Design language | Apple spacing and hierarchy, Stripe palette retained |

---

## Open Question

Whether the `⋯` menu should also carry "Open in portal" for rows with an
`orderId`, duplicating the link already on the Order No. cell. Leaning no — the
number itself being the link is the clearer affordance — but it means the portal
is reachable from two visually different places depending on the row's state.

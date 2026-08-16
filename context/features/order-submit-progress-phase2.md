# Order Entry — Submit Progress Phase 2: Detail Panel Redesign

## Status

Spec — not started. Follows
[order-submit-progress-phase1.md](order-submit-progress-phase1.md) (committed as
`ff5c8e8`, live-unverified).

Phase 1 made the panel say *what the portal did*. Phase 2 makes it readable.

---

## Context

The panel now carries real information — resolved address, resolved offer, order
number, contact, winback, a portal screenshot, a per-attempt timeline. It renders
that as a flat vertical stack of 11px grey text with no hierarchy: every line
weighs the same, so the order number and a debug timestamp compete for attention.

The reference screenshot (EasyStaff dispatcher panel) solves exactly this problem
for exactly this shape of content. Its lesson is not decoration — it is
**hierarchy through scale and containment**.

---

## What the Reference Screenshot Actually Does

Read structurally, top to bottom:

| # | Element | The move |
|---|---|---|
| 1 | Avatar circle + name + ID chips + close | Identity is a *block*, not a line. Initials give an instant visual anchor; the IDs become chips, not prose. |
| 2 | **Solid blue hero card** with one giant number, a sub-line, and 2 outline actions | Exactly one number is the answer to "how is this doing?". Everything else is context. Actions live where the number is. |
| 3 | 3-up stat grid, bordered, `ICON + SMALL CAPS LABEL` over a large value over a subtext | Secondary metrics, all identical shape, scannable in one sweep. |
| 4 | Segmented tabs — `Performance` \| `History · 1` | Two modes, count baked into the label so you know before you click. |
| 5 | Bordered section cards, each with an `ICON + SMALL CAPS` header | Containment. A card boundary tells you where one idea stops. |
| 6 | Stacked bar + legend rows (dot, label, value right, % right) | Composition shown as a bar, read as a table. Numbers right-aligned and tabular. |
| 7 | 2-up mini cards with a value and a thin progress bar underneath | Ratios get a bar; the bar is thin so it supports the number rather than shouting. |

**The transferable rules:**

1. Labels are tiny, uppercase, letterspaced, grey, and **always paired with an icon**.
2. Values are large, semibold, tabular-nums.
3. Exactly **one** saturated surface per panel. Everything else is white on a
   hairline border.
4. Ratios get a thin progress bar. Compositions get a stacked bar plus a legend.
5. Right-align every number in a list so digits line up.

### What we deliberately do NOT copy

- **The blue.** This app has a settled palette (`#635BFF` brand, `#0A2540` text,
  `#E3E8EF` hairline) applied across 20+ phases. The hero card uses **our**
  brand, not EasyStaff's blue.
- **The metric framing.** EasyStaff's hero is money. An order has no money — see
  D2 below for what the hero should carry.
- The `ui-ux-pro-max` skill's `--design-system` output recommended a "Horizontal
  Scroll Journey" landing pattern, Fira Code/Fira Sans, and `#3B82F6`. All three
  are wrong here: this is a detail panel, not a landing page, and the app's fonts
  and palette are already established. Only its **"Data-Dense Dashboard"** style
  guidance is adopted.

---

## Current State

Verified 2026-08-16.

| Thing | Where | State |
|---|---|---|
| Order panel | [OrderHistoryPanel.tsx:243](../../src/components/order-entry/OrderHistoryPanel.tsx#L243) | hand-rolled `<aside>`, `z-[70]`, `animate-fade-in-right`, scrim rendered by the caller in `OrdersList` |
| Case panel | [CaseManagementSection.tsx:66](../../src/components/dashboard/CaseManagementSection.tsx#L66) | separate hand-rolled panel, `z-50`, its own scrim |
| shadcn | `components.json`, style `base-nova`, `lucide` icons | installed: `avatar`, `badge`, `button`, `card`, `input`, `label`, `separator`, `sonner` |
| Missing primitives | — | `sheet`, `tabs`, `progress`, `tooltip`, `skeleton`, `scroll-area`, `collapsible` |
| Motion | [globals.css:613](../../src/app/globals.css#L613) | global `prefers-reduced-motion` block already exists |

Neither panel traps focus, restores focus on close, or closes on `Escape`. Both
are `role="dialog" aria-modal="true"` with no focus management behind it — which
is a stronger claim than the markup delivers.

---

## Proposed Change

### 1. shadcn `Sheet` replaces both hand-rolled panels

`Sheet` (Radix Dialog underneath) brings focus trap, focus restore, `Escape`,
scroll lock, scrim and `aria` wiring for free — all four of which the current
panels are missing. It also removes the caller-rendered scrim and the
`z-[70]`/`z-50` hand-tuning.

**Known hazard, from this branch's own history:** the Full Address + Confirm
phase hit a bug where an entrance animation left a retained transform
(`fill-mode: both` resolves even `transform: none` to an identity matrix), making
every animated card a stacking context that painted over an open dropdown.
Ending the keyframes at `none` was **not** sufficient. Any animated container in
this redesign must be checked against an open dropdown/tooltip before it ships.

### 2. Panel structure

```
┌─────────────────────────────────────────────┐
│ (AK)  WOJAK LANG                        [X] │  Avatar + name
│       [ORD-0042] · [MyKad 970815125312]     │  Badge chips
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ⚡ SUBMIT STATUS          [Portal ↗]    │ │  HERO — brand #635BFF
│ │ 2608000121177971                        │ │  the order number
│ │ Submitted · attempt 2 · 4m 12s          │ │
│ └─────────────────────────────────────────┘ │
│ ┌────────┐ ┌────────┐ ┌────────┐            │
│ │▣ STEPS │ │◷ TIME  │ │↻ TRIES │            │  3-up stat grid
│ │ 16/16  │ │ 4m 12s │ │   2    │            │
│ └────────┘ └────────┘ └────────┘            │
│ ┌─ Progress ─┬─ History · 2 ─┬─ Capture ─┐  │  Tabs
│ └────────────┴───────────────┴───────────┘  │
│  …tab content in bordered section cards…    │
└─────────────────────────────────────────────┘
```

- **Hero** carries the Customer Order Number, because that is the one value an
  agent copies out of this panel. Status, attempt and elapsed sit under it. When
  no order number exists yet, the hero shows the status word instead and the
  action button is suppressed. Hero tint follows status: brand while running,
  green submitted, amber needs-checking, red failed.
- **Needs-voiding** stays as its own amber alert directly under the hero — it is
  the most urgent thing on the panel and must not hide inside a tab.
- **Tabs** replace today's stacked sections. `History · N` carries its count in
  the label, exactly as the screenshot does. The screenshot section from Phase 1
  becomes its own **Capture** tab, and the tab is disabled with a tooltip when no
  attempt captured a frame.

### 3. Section cards + label treatment

Every section header becomes `<Lucide icon 12px/> LABEL` in 10px uppercase
`tracking-wide` `#8792A2`, inside a `Card` with a `#E3E8EF` hairline — replacing
today's bare `<h3>`. Applied to Current run, each Attempt, Portal screenshot.

### 4. Step checklist, restyled

`SubmitProgress` keeps its logic untouched (Phase 1 shipped it and it is
correct); only presentation changes:

- step label 11px → **12px medium**, detail line 10px → **11px**, both above the
  16px-on-mobile floor concern since this is a dense data panel on desktop
- the `done/total` counter becomes a shadcn `Progress`
- the point-of-no-return divider becomes a labelled `Separator`
- resolved values get a monospace/tabular treatment when they are an order
  number, and wrap when they are an address

### 5. Motion

The user asked for "every animation you can think of". The `ui-ux-pro-max` UX
database flags the opposite as **High severity**: *"Excessive Motion — animate
1-2 key elements per view maximum; don't animate everything that moves."* Both
things can be true — the answer is **many animations, choreographed**, not many
animations firing at once. Ship this set:

| # | Animation | Trigger | Spec |
|---|---|---|---|
| 1 | Sheet slide-in | open | `translateX(100%)→0`, 260ms `ease-out` |
| 2 | Scrim fade | open | opacity 0→1, 200ms |
| 3 | Header stagger | open | avatar, name, chips at 0/40/80ms |
| 4 | Hero count-up | open | order number ticks up, 500ms, once |
| 5 | Stat card rise | open | 3 cards, 60ms stagger, 8px translateY |
| 6 | Tab underline slide | tab change | 200ms, shared layout |
| 7 | Tab content cross-fade | tab change | 150ms |
| 8 | Step row cascade | mount | existing `step-row-in`, 25ms stagger, capped at 12 |
| 9 | Rail draw | step completes | existing `rail-draw` |
| 10 | Marker pop | step completes | scale 0.6→1, 180ms `ease-out` |
| 11 | Live pulse | running step | existing `step-live` |
| 12 | Progress fill | step completes | width transition 700ms (already present) |
| 13 | Detail line fade-up | detail arrives | 200ms — the value *appearing* is the event |
| 14 | Attempt expand | click | `Collapsible`, height 200ms |
| 15 | Screenshot skeleton→fade | image load | `Skeleton` then 300ms fade |
| 16 | Screenshot hover lift | hover | 2px translateY + shadow, 150ms |
| 17 | Close button rotate | hover | 90°, 150ms |
| 18 | Chip hover | hover | background 150ms |
| 19 | Alert slide-down | mount | needs-voiding banner, 250ms |
| 20 | Sheet slide-out | close | reverse, 200ms `ease-in` |

Rules that make this safe rather than noisy:
- **transform + opacity only.** Never `width`/`height`/`top` (the one exception,
  the progress bar, is already `transition-[width]` and is 1px tall).
- **One-shot, never looping** — except the live-step pulse, which is a status
  indicator.
- **Entrance animations must end at `animation-fill-mode` values that leave no
  retained transform**, and every animated container must be verified against an
  open dropdown (see the hazard above).
- Everything inherits the existing global `prefers-reduced-motion` block.

---

## Acceptance Criteria

1. Both slide-in panels use shadcn `Sheet`; no hand-rolled `fixed inset-y-0`
   panel or caller-rendered scrim remains.
2. `Escape` closes the panel, focus is trapped inside it while open, and focus
   returns to the trigger on close.
3. The panel header shows an avatar with initials, the full name, and the
   reference + ID as `Badge` chips.
4. The hero card shows the Customer Order Number when one exists, and the status
   word when it does not; its tint matches the run's outcome.
5. The 3-up stat grid shows steps completed, elapsed time and attempt count.
6. `Progress` / `History · N` / `Capture` render as `Tabs`; `Capture` is disabled
   with an explanatory tooltip when no screenshot exists.
7. The needs-voiding alert is visible without opening a tab.
8. All 20 animations above are present, and **all** are suppressed under
   `prefers-reduced-motion: reduce`.
9. No animated container creates a stacking context that paints over an open
   dropdown, tooltip or the Sheet's own overlay.
10. Every interactive element has `cursor-pointer`, a visible focus ring, and a
    ≥44×44px hit area (or an explicit exception noted for dense table rows).
11. Text contrast ≥4.5:1 throughout; no value text lighter than `#425466`.
12. The panel is usable at 375px: full-width Sheet, stats wrap 3→1, no
    horizontal scroll.
13. `SubmitProgress`'s step/detail/outcome LOGIC is unchanged — presentation only.
14. Build, lint and the existing 101 unit tests stay clean.

---

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | hero value selection (order no vs status word), tint per status | +3 |
| Unit | stat grid derivations (steps done, elapsed, attempts) from an AttemptView | +3 |
| Unit | Capture tab disabled when no attempt has a screenshot key | +2 |
| Manual | Escape / focus trap / focus restore | — |
| Manual | reduced-motion on: every animation suppressed | — |
| Manual | dropdown-over-animated-card regression (the Phase-prior bug) | — |
| Manual | 375 / 768 / 1024 / 1440 | — |

---

## Rollback Plan

Presentation-only. Revert the commit; Phase 1's data pipeline is untouched by it.

---

## Effort Estimate

| Component | Effort |
|---|---|
| Install + theme 7 shadcn primitives to the Stripe palette | 1.5h |
| Sheet migration, both panels (incl. focus/scrim removal) | 2.5h |
| Header + hero + stat grid | 2h |
| Tabs + section cards | 2h |
| SubmitProgress restyle | 1.5h |
| Motion system (20 animations) + reduced-motion audit | 3h |
| Tests + responsive + a11y pass | 2.5h |
| **Total** | **~15h** |

---

## Files Reference

| File | Change |
|---|---|
| `src/components/ui/{sheet,tabs,progress,tooltip,skeleton,scroll-area,collapsible}.tsx` | **new** — shadcn add, themed to the Stripe palette |
| `src/components/order-entry/OrderHistoryPanel.tsx` | Sheet + header + hero + stats + tabs |
| `src/components/order-entry/SubmitProgress.tsx` | presentation only |
| `src/components/order-entry/OrdersList.tsx` | drop the hand-rolled scrim; Sheet owns it |
| `src/components/dashboard/CaseManagementSection.tsx` | case panel → Sheet |
| `src/app/globals.css` | panel keyframes; verify the reduced-motion block covers them |
| `src/lib/order-types.ts` | derivations for the stat grid |

---

## Out of Scope

- Any change to Phase 1's data pipeline, stage details or screenshot capture.
- Restyling the drafts table itself, the order form, or the admin panels.
- Dark mode (the app has never had one).
- Changing the app's palette or fonts.

---

## Decisions Taken (2026-08-16)

1. **Both panels.** `OrderHistoryPanel` and the `CaseManagementSection` case
   panel both move to shadcn `Sheet` with the same header / hero / tabs language.
   The migration is the same work twice, and both gain the focus trap, focus
   restore and `Escape` handling their `aria-modal="true"` currently claims but
   does not implement.
2. **Hero = Customer Order Number**, with `status · attempt · elapsed` beneath.
   It is the one value an agent copies out of this panel. Before an order number
   exists the hero shows the status word instead and the portal action is
   suppressed.
3. **20 choreographed animations** — the full table above, sequenced so no more
   than ~2 things move at any instant. Not the maximal set: the UX database rates
   "animate everything" High severity, and this branch has already lost a day to
   a retained-transform stacking-context bug.
4. **Brand purple `#635BFF`**, tinted by outcome (purple running, green
   submitted, amber needs-checking, red failed). We copy the reference's
   structure, not its palette — the layout is what makes it good.

## Revisions After First Review (2026-08-16)

### 1. Step numbers in Progress

The checklist showed a bar and `11/16` but never named where the run *was*. It
now leads with **"Step 11 of 16"** (or "All 16 steps complete") plus a percentage,
and every row carries a zero-padded ordinal — `04`, `14` — in a fixed-width
column so the labels stay optically aligned.

### 2. Screenshots moved under their attempt

The Capture tab is **gone**. It was a second, disconnected home for evidence that
already belongs to an attempt, it sat disabled on most orders, and it forced the
agent to correlate a gallery back to a run by attempt number.

Each screenshot is now the **final entry in its attempt's timeline** — which is
also where it happens chronologically, right after Winback Tagging. It reads as
"…and here is what the screen looked like at that point" instead of as an
appendix. To keep it discoverable while the attempt is collapsed, an attempt that
captured a frame shows a small **Capture** chip in its header row.

### 3. Drafts table

Column order is now: `BizzFlow Order ID` (renamed from `Ref`), `Customer`,
[`Made By`], `Package`, `Device`, `Installation Address`, `Status`,
`Order No. (Unifi)`, `Actions`.

- **Package and Device are separate columns.** They were stacked in one cell,
  which made the device look like a footnote of the package rather than a
  separately-chosen line item. Remarks stay under Package.
- **"Verified on Unifi" is now a quiet inline check**, not a filled green pill.
  Verification is the normal state for a confirmed address; a pill on nearly
  every row trains the eye to skip it, and then the rows *missing* it stop
  standing out — which is the only thing the mark exists to do.
- **`Order No.` is labelled `Unifi`** in the header and its value links out with
  an external-link glyph, so it is never mistaken for the BizzFlow reference in
  the first column. An order with none reads **"Not yet issued"** rather than a
  dash: the portal has not minted a number yet, which is different from unknown.

## Remaining Open Question

- Nothing blocking. `npx shadcn add` needs network access; if it is unavailable
  the seven primitives get hand-written against the existing `base-nova` /
  `neutral` config instead.

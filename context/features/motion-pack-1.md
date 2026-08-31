# Phase 3 — Motion Pack 1

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 3 of 9 (trimmed by
the decisions: no confetti, no mascot).
**Scope:** Vercel-only. No scraper change, no migration.

---

## The constraint that shapes it

The app owns exactly **five** Lottie assets (`processing`, `success`, `empty-orders`, `otp-reading`,
`dropzone`), exported from the user's LottieFiles account. **New illustrations cannot be minted here.**
So the pack is two honest ingredients:

1. **Reusing the five spots** where they are semantically right — never where they merely fill space.
2. **Code-authored micro-motion** — CSS/SVG written in the repo, which needs no assets at all.

The absolute rule carried from the existing spots: **every animation has a static fallback under
`prefers-reduced-motion`**, and SSR paints the fallback. `LottieSpot` already enforces this; the new
CSS motion gets the same treatment via the existing global reduced-motion block.

---

## A. State spots (reuse only)

| Where | Today | Change |
|---|---|---|
| Case list, nothing crawled | grey icon + text | `empty-orders` spot (the illustration is a generic empty-tray, not order-specific) |
| Crawl page, crawl running | spinner | `processing` spot beside the progress text |
| Admin **Running now**, idle | text | *no spot* — an admin panel that says "No submits running" in plain text is calm, which is the message; motion here would imply activity |
| Admin error breakdown, none | text | `success` spot at small size, played once — "nothing failed" is a genuine all-clear |

Two placements from the analysis are **dropped for honesty**: a per-failure `error` animation (a red
box that moves is not more informative, just more alarming) and `disconnected`/`merged` (no fitting
asset; a wrong illustration is worse than text).

## B. Count-ups on KPI tiles

`useCountUp(value)` — a shared hook. On mount and on a value change the number animates over ~500ms
with ease-out; under reduced motion (and on the server) it renders the final value instantly.

Applied to: the admin oversight's five tiles, and the dashboard's KPI row. **Tabular numerals are the
prerequisite already met** — the tiles use `tabular-nums`, so a counting number does not jitter in
width.

The rule that makes it informative rather than decorative: the count-up runs **only when the value
changes for a reason the user caused** (load, range change, filter). It never loops, never replays on
unrelated re-renders — a number that dances is a number nobody trusts.

## C. Row and pill transitions

- **Filter/search changes** on the Orders table and admin table: rows get a one-shot `animate-fade-in-up`
  (the app's existing keyframe) staggered ~20ms per row, capped at the first 15 rows — beyond that the
  stagger reads as slowness.
- **A status pill whose status CHANGED since the last render** (submitting → failed, etc.) flashes its
  background once (~600ms). Detected by a `usePrevious` on the status per row. This is the one place
  motion carries real information: "this row is what just changed".
- **The Connection badge** pulses once when it turns green (agent page / By-agent table) — same
  mechanism, same one-shot rule.

## Not in scope

- The submit-button-becomes-progress-bar morph from the analysis — a real design task on the live
  submit path, not a pack item.
- Any new Lottie/GIF/video asset.
- Confetti, mascot (decided out).

## Tests

- `useCountUp`: reaches the target exactly (never rests on a rounding neighbour), renders the final
  value under reduced motion, re-animates on value change only.
- `usePrevious`-based pill flash: flashes on a status change, not on an unrelated re-render.

Browser: each placement looked at; reduced-motion emulated (`emulateMedia`) to confirm every fallback;
375px unchanged.

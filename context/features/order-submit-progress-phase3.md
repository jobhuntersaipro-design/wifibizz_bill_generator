# Order Entry — Submit Progress Phase 3: Full Capture Trail + Live Verification

## Status

Spec — not started. Follows
[order-submit-progress-phase2.md](order-submit-progress-phase2.md) (committed as
`b8e83e0`).

Two strands:

- **A. Close out Phase 1's real risk** — deploy the scraper to the droplet and
  run one real submit. Everything verified so far read data written by the *old*
  scraper build.
- **B. Capture every detail screen**, not just page 1, and show the agent how
  long each frame will survive.

---

## Context

### A. The scraper half has never run

Phase 1 rewrote six `stage()` closures, added detail payloads to five steps, and
added `capture_page1_screenshot`. Phase 2 verified the *UI* against a live order
— but the screenshot and stage details it displayed were written by the scraper
build that was already on the droplet. **Not one line of the Phase 1 scraper
change has executed.**

Two assumptions in it are selector-shaped and only a live run can settle them:

| Assumption | Where | Fails how |
|---|---|---|
| The address column is the longest `td[title]` in the row | `_longest_title` ([oe_feasibility.py](../../scraper/oe_feasibility.py)) | picks a service category or state instead, and the agent sees the wrong "matched address" |
| The contact name is the leading cell of the grid row | `_contact_name` | shows a phone number where a name belongs |

Neither throws. Both silently display the wrong thing, which is worse than a
crash — the whole point of Phase 1 was to be able to trust these values.

### B. One frame is not the whole submission

The page-1 capture proves the Bundle tab: order number, address, contact, main
offer, account, winback. It proves nothing about the rest of the submission,
which is where most of the *typing* happens:

```
New Connection page 1  ← page1_captured (exists)
  ├─ Unifi Home 500Mbps (Broadband)   install contact + service number + DEVICE
  ├─ Residential Voice Basic (Voice)  install contact + picked voice number
  └─ NEW UNIFI TV (Unifi TV)          install contact + service number
Customer Order Information            contact no, email, contactless flag, remarks
  ├─ attachments (ID copy, IM conversation)
  ├─ appointment slot
  └─ delivery terms + T&C
Pay
```

A dispute about which device was ordered, which appointment slot was taken, or
which number the voice line got has **no evidence today**. The device in
particular is picked from a 126-row dialog whose contents the portal filters per
package — exactly the field most worth a picture.

### C. The 90-day clock is invisible, and currently fictional

Phase 1 decided 90-day retention. Two problems:

1. The agent has no idea a frame expires, so evidence disappears without warning.
2. **The R2 lifecycle rule was never applied.** Nothing deletes anything today,
   so a countdown rendered right now would be describing a policy that does not
   exist. See D3 — this has to be resolved, not just displayed.

---

## Current State

Verified 2026-08-16 against `b8e83e0`.

| Thing | State |
|---|---|
| Capture points | exactly one — `capture_page1_screenshot` at [oe_feasibility.py](../../scraper/oe_feasibility.py), called from `complete_new_connection` after winback |
| Key shape | `order-screenshots/<userId>/<orderId>/submit-<attempt>-page1.png` |
| Upload | `scraper/r2_upload.py` → `screenshot_key()` + `upload_bytes()` |
| Reporting | one `page1_captured` stage detail carrying the key |
| Storage | `Order.screenshotUrl` (latest only) + one `page1_captured` `OrderStatusEvent` per attempt |
| Panel | `screenshotFor(attempt)` finds **the single** frame; `ShotRow` renders it as the last timeline entry |
| Retention | **no lifecycle rule applied** — nothing expires |
| Droplet | running the pre-Phase-1 build |

Every one of those is singular. Phase 3 makes the trail plural.

---

## Proposed Change

### 1. Capture points

`capture_page1_screenshot` generalises to `capture_screen(page, payload, slot)`.
Each call reports its own stage detail, so each frame lands on the timeline at
the moment it was taken.

| Slot | Taken after | Proves |
|---|---|---|
| `page1` | Winback Tagging *(exists)* | order no, address, contact, offer, account, winback |
| `broadband` | Broadband tab filled | service number **and the device that was actually selected** |
| `voice` | Voice tab filled | the voice number the portal assigned |
| `tv` | TV tab filled | TV service number |
| `order_info` | Customer Order Information filled | contact no, email, contactless flag, remarks |
| `attachments` | documents uploaded | which files the portal accepted |
| `appointment` | slot booked | the installation date and time taken |
| `delivery` | delivery terms + T&C | the terms the order was placed under |
| `pay` | the Pay screen, before clicking | the amount and any advance payment |

Sub-tab slots are driven by the tab text the portal reports
(`_subproduct_tabs` already returns it), not hardcoded — an offer with no Voice
or TV component simply produces no frame for it, the same way a missing field
produces no stage detail.

Key shape gains the slot:

```
order-screenshots/<userId>/<orderId>/submit-<attempt>-<slot>.png
```

**Failure stays non-fatal, per capture.** A slot that fails to shoot or upload
reports `outcome: "failed"` and the run carries on. Evidence must never cost an
order — that rule does not weaken just because there are now nine chances to
break it.

### 2. Reporting

One stage key per slot (`capture_broadband`, `capture_voice`, …) rather than
overloading `page1_captured`. Each is:

- excluded from `SUBMIT_STEPS` (artefacts, not milestones)
- filtered out of the step timeline and rendered as its own `ShotRow`
- recognised by the panel via a `CAPTURE_STAGES` set, replacing today's single
  `PAGE1_SCREENSHOT_STAGE` constant

`Order.screenshotUrl` keeps holding **the page-1 key of the latest attempt** —
it exists so a collapsed row can show that evidence exists, and the page-1 frame
remains the most representative single image.

### 3. Panel presentation

Each frame stays a timeline row at its own chronological position — the Phase 2
decision, applied nine times instead of once. That keeps every picture next to
the step it documents, which is the only thing that makes nine pictures
readable rather than a wall.

Two additions:

- The attempt header's **Capture** chip shows the count (`Capture · 6`).
- A **Captures** summary strip at the top of an expanded attempt: small
  thumbnails in order, each scrolling to its timeline row. For an attempt with
  nine frames, scrolling the whole timeline to find the device shot is the
  obvious friction.

### 4. Retention countdown

Beside each frame, the time it has left:

```
Portal screenshot            01:04:24 AM     Expires in 87 days      Full size ↗
```

- Derived from the capture event's `createdAt` + 90 days. No new column.
- **Under 14 days** turns amber; **expired** reads "Expired" in grey with the
  thumbnail replaced by a short note, because the object is gone from R2 and the
  `<img>` would otherwise be broken.
- The countdown is only honest if something actually deletes. See D3.

---

## Acceptance Criteria

1. A full submit produces a frame for every applicable slot; an offer without a
   Voice or TV tab produces no frame for those, and no error.
2. Each frame appears as its own timeline row, in the order it was taken, next
   to the step it documents.
3. The Broadband frame shows the **selected device**, and the Voice frame shows
   the **assigned voice number**.
4. A failed capture or upload does **not** fail the submit; the run continues
   and the slot reports its reason.
5. The attempt header chip reads `Capture · N` with the true count.
6. The Captures strip jumps to the matching timeline row when a thumbnail is
   clicked.
7. Each frame shows days remaining; under 14 days is amber; past 90 days reads
   "Expired" with no broken image.
8. Keys follow `order-screenshots/<userId>/<orderId>/submit-<attempt>-<slot>.png`
   and stay scoped to the owning user (cross-user still 404s).
9. **Deleting actually happens** — whichever mechanism D3 settles on.
10. The scraper is deployed to the droplet and **one real submit** runs end to
    end, with `_longest_title` and `_contact_name` confirmed against the live
    portal.
11. Build, lint and the 117 unit tests stay clean.

---

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit (Py) | slot → key shape; unknown/odd tab text sanitised into a safe slug | +4 |
| Unit (Py) | capture failure returns a detail and never raises | +2 |
| Unit (TS) | `CAPTURE_STAGES` partition: captures out of the step list, into rows | +3 |
| Unit (TS) | countdown: 90/87/13 (amber)/0 (expired)/negative | +5 |
| Integration | several capture events on one attempt → ordered rows + correct chip count | +2 |
| **Live** | one real submit: every slot fires, frames land in R2, panel renders them | manual |
| **Live** | `_longest_title` picks the address; `_contact_name` picks the name | manual |

---

## Rollback Plan

- `OE_CAPTURE_PAGE1` generalises to `OE_CAPTURE` (`false` disables all capture).
  Per-slot opt-out via `OE_CAPTURE_SLOTS=page1,broadband`.
- Panel changes are presentation-only; revert the commit.
- Redeploy the previous droplet revision — BizzFlow tolerates missing capture
  stages exactly as it tolerates missing detail.

---

## Effort Estimate

| Component | Effort |
|---|---|
| `capture_screen()` generalisation + 8 new call sites | 3h |
| Slot slugging from portal tab text + env gating | 1h |
| `CAPTURE_STAGES` plumbing (types, drain, panel partition) | 1.5h |
| Multiple `ShotRow`s + Captures strip + scroll-to | 2.5h |
| Countdown + expiry states | 1.5h |
| Retention mechanism (per D3) | 1–3h |
| Tests | 3h |
| Droplet deploy + live submit + fixing what it finds | 3h |
| **Total** | **~17–19h** |

---

## Files Reference

| File | Change |
|---|---|
| `scraper/oe_feasibility.py` | `capture_screen()`; call sites in `fill_subproduct_tabs`, `fill_customer_order_info`, `pay_and_submit` |
| `scraper/r2_upload.py` | `screenshot_key(user, order, attempt, slot)` |
| `src/lib/order-types.ts` | `CAPTURE_STAGES`, slot labels, `daysUntilExpiry()` |
| `src/lib/order-submit.ts` | drain every capture stage, not just `page1_captured` |
| `src/components/order-entry/OrderHistoryPanel.tsx` | many `ShotRow`s, Captures strip, countdown |
| `src/app/api/orders/screenshot/route.ts` | unchanged (prefix rule already covers slots) |

---

## Out of Scope

- Video/trace capture of the run.
- Diffing frames between attempts.
- Backfilling captures for orders already submitted.
- Flipping `do_pay` to TRUE.
- Any change to the drafts table.

---

## Decisions Taken (2026-08-16)

1. **All 9 detail screens.** page1, broadband, voice, tv, order_info,
   attachments, appointment, delivery, pay. "Every submission of the details"
   read literally — and the two most disputed fields, the device and the
   appointment slot, are both outside the sub-tabs.
2. **JPEG quality 80**, not PNG. Portal UI is flat colour and compresses ~70%
   smaller with no loss that matters on text nobody zooms into. Nine PNGs per
   attempt would be ~4.5MB; nine JPEGs are ~1.4MB.
   - `screenshot_key()` gains a `.jpg` extension.
   - Playwright: `page.screenshot(type="jpeg", quality=80, full_page=True)`.
   - **The screenshot route's guard must be widened** — it currently hard-rejects
     anything not ending `.png` and hard-codes `Content-Type: image/png`. Both
     become an extension→type allowlist (`png`, `jpg`, `jpeg`), matching how the
     document route already works. Missing this makes every new capture 404.
3. **Cloudflare R2 lifecycle rule**, applied by hand, not an in-app sweep. The
   countdown must describe something real before it ships.

### The rule to apply (blocking for the countdown)

Cloudflare dashboard → R2 → the bucket → **Settings** → *Object lifecycle rules*
→ **Add rule**:

```
Rule name : expire-order-screenshots
Prefix    : order-screenshots/
Action    : Delete objects   —   90 days after upload
```

The prefix matters: `orders/` holds customer ID copies and utility bills, which
must **not** expire. That separation is exactly why Phase 1 put captures under
their own top-level prefix instead of alongside the documents.

**Until this rule exists, the countdown ships hidden** behind
`NEXT_PUBLIC_CAPTURE_RETENTION_DAYS`. Unset means no countdown is rendered —
better silence than a UI asserting a policy nobody implemented. Set it to `90`
once the rule is live.

## Remaining Open Question

- Nothing blocking. Confirm during implementation that this R2 plan exposes
  lifecycle rules; if it does not, fall back to the in-app sweep and say so
  rather than leaving the countdown fictional.

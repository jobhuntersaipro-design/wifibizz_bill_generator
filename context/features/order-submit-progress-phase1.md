# Order Entry — Submit Progress Phase 1: Step Detail + Page-1 Screenshot

## Status

Spec — not started. Branch `feature/order-submit-progress` (continues the
step-by-step submit progress work already merged as `cceedc6`).

Prior art: [order-submit-progress.md](order-submit-progress.md) built the stream
(job id + client polling + 16-step checklist). This phase makes each step say
*what it actually did*, and captures visual proof of the New Connection page.

---

## Context

The submit checklist already streams. What it streams is a bare step name.

An agent watching a real submit sees `Checking installation address` tick green
and has no idea *which* address the portal matched — the portal's ranked search
can resolve a typed address to a neighbouring unit. Same for the package: the
agent picked "Unifi Home 500Mbps Premium Value With Device (36M)" in BizzFlow,
the portal resolved *something*, and the checklist says only `Checking package
availability ✓`. When the order later turns out wrong, there is no record of
what the portal actually chose, and no way to tell a mis-pick from a mis-type.

Two of these steps are the ones that cost money to get wrong. Installation
Contact decides who the installer calls. Winback Tagging is a mandatory portal
field (red asterisk) that the flow can silently leave at `---Please select---`,
which is exactly what the reference screenshot shows.

So: keep the same 16 steps, attach the resolved value to each of the first five,
and take one full-page screenshot of the New Connection page once step 5 is done
— stored in R2, viewable from the order row. That screenshot is the audit
artefact: it shows Customer Order Number, Installation Address, Installation
Contact, Main Offer, Account and Winback Tagging in one frame, as the portal
rendered them.

**Why now:** the flow reaches Pay but `do_pay` is still FALSE pending the first
real payment. Before real money moves through it, every submit needs a record of
what the portal was actually showing at the point of no return.

---

## Current State

Verified 2026-08-16 against the working tree on `feature/order-submit-progress`.

### The stage stream exists end to end

| Layer | Where | What it carries today |
|---|---|---|
| Scraper emit | [scraper/oe_feasibility.py:346-2043](../../scraper/oe_feasibility.py#L346) — 21 `stage("...")` calls | **name only** |
| Job record | [scraper/api_server.py:311-316](../../scraper/api_server.py#L311) `_set_stage(name)` | overwrites `job["stage"]` — **no history** |
| Job read | `GET /jobs/<id>` | current `stage` string |
| Poll + finalize | [src/lib/order-submit.ts](../../src/lib/order-submit.ts) `JobSnapshot.stage` | current stage string |
| Persist | `Order.stage` / `Order.stageAt`, `OrderStatusEvent` | stage key + message |
| Render | [src/components/order-entry/SubmitProgress.tsx](../../src/components/order-entry/SubmitProgress.tsx) | label + tick/spinner/cross |

`SUBMIT_STEPS` ([src/lib/order-types.ts:50-67](../../src/lib/order-types.ts#L50))
is 16 steps. The five this phase targets:

| # | Step key | Label today | Emitted at |
|---|---|---|---|
| 4 | `checking_address` | Checking installation address | `oe_feasibility.py:346` |
| 5 | `checking_plan` | Checking package availability | `oe_feasibility.py:351` |
| 6 | `placing_order` | Placing order | `oe_feasibility.py:356` |
| 9 | `installation_contact` | Setting installation contact | `oe_feasibility.py:785` |
| 11 | `winback_tagging` | Winback tagging | `oe_feasibility.py:791` |

Note the portal's real order is address → plan → order → **contact → account →
winback**; `billing_account` (step 10) sits between 9 and 11. The user's Step 4
and Step 5 are steps 9 and 11 in the existing list. No renumbering is proposed —
see Out of Scope.

### R2 is already set up (no setup work needed)

Both sides are wired and in production use:

| Side | File | Uses |
|---|---|---|
| Next.js | [src/lib/r2.ts](../../src/lib/r2.ts) | `@aws-sdk/client-s3` — `uploadToR2`, `getFromR2`, `deleteFromR2` |
| Python (droplet) | [scraper/r2_download.py](../../scraper/r2_download.py) | `boto3==1.43.56`, same endpoint + creds, `download_r2_object` |

Env (already in `.env.example` and on the droplet): `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.

Existing per-user key convention: `orders/<userId>/<filename>`, served by the
auth-gated [src/app/api/orders/document/route.ts](../../src/app/api/orders/document/route.ts),
which scopes reads to `orders/<session.user.id>/`, allowlists extensions
(`png` included) and forces `Content-Disposition: attachment` + `nosniff`.

**The only missing piece is an upload helper on the Python side.** `r2_download.py`
has the client; it has no `put_object` path.

### What is NOT captured today

- No screenshot is taken on the success path. `_screenshot()`
  ([scraper/order_entry.py:61](../../scraper/order_entry.py#L61)) fires only on
  error, writes to the droplet's local `logs/` dir, and returns a **local path**
  that no browser can reach.
- The job record keeps only the *current* stage, so a fast step is overwritten
  before a 2s poll ever sees it. Steps currently go green by inference
  (`index < current`), not by observation.

---

## Proposed Change

Three additive changes. None alters what the portal flow does.

```
scraper                          Flask job                Next.js               UI
─────────                        ──────────               ────────              ──
stage("checking_address",        job["stages"] = [        progress route        step row:
      detail={...})        ──▶     {name, detail,   ──▶   • new stages    ──▶   label
                                    at}, ...  ]            → OrderStatusEvent    └ detail
                                  job["stage"] = last      • screenshot key
                                                             → Order.screenshotUrl
r2_upload.put_screenshot()  ──▶  R2 orders/<u>/<o>/...  ──▶ /api/orders/document ──▶ thumbnail
```

### 1. Stage detail payload

Widen the callback signature, keeping positional compatibility so an older
scraper/newer BizzFlow pair (they deploy separately) cannot break:

```python
# oe_feasibility.py — inside each `def stage(n)` closure
def stage(n, detail=None):
    if on_stage:
        try: on_stage(n, detail)
        except TypeError: on_stage(n)   # older callback, name only
        except Exception: pass
```

`detail` is a small JSON-safe dict, never free prose:

```python
{
  "value":   str,          # what to show the agent, portal's own wording
  "outcome": "ok" | "failed" | "skipped",
  "note":    str | None,   # portal message when outcome != ok
}
```

Emission points and the value each carries:

| Step | `value` is | Source |
|---|---|---|
| `checking_address` | the portal's `concatAddress` for the matched unit | already read during feasibility (`select_address`) |
| `checking_plan` | the Main Offer name exactly as the portal listed it | `select_main_offer` option text |
| `placing_order` | `"Order clicked"`, then the Customer Order Number once captured | `click_order` result / `capturing_order_no` |
| `installation_contact` | the name written into Installation Contact | `set_installation_contact` return |
| `winback_tagging` | the option selected, or `"Not selected"` | `set_winback_tagging` return |

`outcome: "failed"` on step 4 is the user's "Success or Failed on Unifi Portal"
— an address the portal refuses must show a red step with the portal's own
message, not a generic stall.

**Winback caveat (visible in the reference screenshot):** Winback Tagging renders
`---Please select---` there, i.e. mandatory and unset. When
`set_winback_tagging` returns `skipped`, the step must render as a **warning**,
not a tick. `SubmitProgress` already has a `warning` state and an amber marker.

### 2. Job record keeps a stage history

`api_server.py:311` becomes:

```python
def _set_stage(name, detail=None):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return
        job["stage"] = name                       # unchanged, back-compat
        job.setdefault("stages", []).append({
            "name": name,
            "detail": detail,
            "at": datetime.utcnow().isoformat(),
        })
        JOBS[job_id] = job
```

`GET /jobs/<id>` returns `stages` alongside `stage`. `_redact_order_result`'s
`safe_keys` allowlist ([api_server.py:274](../../scraper/api_server.py#L274))
governs what is *logged*; stage details carry customer name and address, so they
must stay out of the log line and live only in the auth-gated job record — same
rule the result already follows.

### 3. Screenshot after step 5 → R2

New `scraper/r2_upload.py`, mirroring `r2_download.py`'s client construction:

```python
def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    """Put an object into R2 and return its key (not a public URL —
    reads go through BizzFlow's auth-gated route)."""
```

In `complete_new_connection` ([oe_feasibility.py:768](../../scraper/oe_feasibility.py#L768)),
after `stage("winback_tagging")` resolves:

```python
shot = await page.screenshot(full_page=True)
key  = f"orders/{user_id}/{order_id}/submit-{attempt}-page1.png"
upload_bytes(key, shot, "image/png")
stage("page1_captured", {"value": key, "outcome": "ok"})
```

`user_id` / `order_id` / `attempt` are **not** in the payload today. Add an
`order_ref` block to the payload built by
[scraper/order_to_payload.py](../../scraper/order_to_payload.py) and its caller
in [src/actions/order.ts](../../src/actions/order.ts):

```json
"order_ref": { "user_id": "...", "order_id": "...", "attempt": 1 }
```

Screenshot failure is **non-fatal**: log it, emit
`{"outcome": "failed", "note": ...}`, keep submitting. A screenshot must never
cost an order.

### 4. Persist + render

- **New column** `Order.screenshotUrl` (`screenshot_url TEXT`). Per
  [prisma-migrate-dev-shadow-db-fails](memory) the shadow DB is broken in this
  repo — hand-author the migration SQL and apply with `prisma migrate deploy`,
  then restart the dev server so the cached client picks up the new field.
- The progress route diffs `stages` against events already recorded and writes
  each new one to the existing `OrderStatusEvent` table (`stage`, `status:
  "info"`, `message: detail.value`). The table already exists — no migration.
  Dedupe on `(orderId, attempt, stage)` because two polls can overlap.
- `SubmitProgress` renders `detail.value` as a second line under the step label.

### 5. Screenshot section in the slide-in detail panel

The screenshot is the artefact the agent actually wants to look at after the
fact, so it gets a real section in the order detail panel — not just a link on
the row.

**Where:** [src/components/order-entry/OrderHistoryPanel.tsx](../../src/components/order-entry/OrderHistoryPanel.tsx),
the existing slide-in that already renders `SubmitProgress` plus a vertical
timeline per attempt (`AttemptView`).

**Per-attempt, not per-order.** The key is
`submit-<attempt>-page1.png`, and a retried order has one frame per attempt.
Each attempt block in the panel shows its own screenshot, directly under that
attempt's timeline. An attempt that captured nothing (failed before step 11,
capture disabled, upload failed) shows no section at all — never a broken image
or an empty placeholder.

**Storage:** the key is recorded as a `page1_captured` `OrderStatusEvent` on
that attempt (`message` = the R2 key), which is how every other stage detail
already persists. `Order.screenshotUrl` mirrors the **latest** attempt's key so
the collapsed row can show a small indicator without loading history.

**Section shape:**

```
─────────────────────────────────────────
 Portal screenshot                 Open ↗
─────────────────────────────────────────
 ┌───────────────────────────┐
 │  [ thumbnail, max-h-64,   │   Captured 14:32:07
 │    object-top, rounded,   │   after Winback Tagging
 │    border #E3E8EF ]       │
 └───────────────────────────┘
 New Connection page as the portal rendered
 it — order no, address, contact, offer,
 account and winback tagging.
```

- Thumbnail is `<img>` against the auth-gated route, lazy-loaded, capped height
  with `object-top` so the top of the form (order number + address) is what
  shows without opening it.
- **Open ↗** opens the full-resolution PNG in a new tab. No lightbox — the
  image is a tall full-page capture and the browser's own viewer zooms and pans
  better than anything worth building here.
- Section respects the existing panel styling (Stripe palette, `#E3E8EF`
  borders) and the global `prefers-reduced-motion` block.
- On mobile the panel is already full-width; the thumbnail scales with
  `max-w-full`.

**Route caveat:** the existing document route forces
`Content-Disposition: attachment`, so an `<img src>` against it downloads
rather than renders. Screenshots therefore get their own route (see Decisions
Taken) serving PNG `inline` with `nosniff`.

---

## Acceptance Criteria

1. A submit shows the matched **installation address string** under step 4, as
   the portal's `concatAddress`, within one poll of the step completing.
2. An address the portal refuses renders step 4 **red** with the portal's own
   message, and no later step goes green.
3. Step 5 shows the **Main Offer name the portal resolved**, not the name
   BizzFlow sent.
4. Step 6 shows the **Customer Order Number** once captured.
5. Step 9 shows the **Installation Contact name** actually written into the field.
6. Step 11 shows the **Winback Tagging option selected**; when the portal leaves
   it at `---Please select---`, the step renders **amber/warning**, never a tick.
7. A full-page PNG of the New Connection page is in R2 under
   `order-screenshots/<userId>/<orderId>/submit-<attempt>-page1.png` after step
   11, and renders inline from the order row for that order's owner.
8. A different signed-in user requesting that key gets **404**.
9. The slide-in detail panel shows a **Portal screenshot** section inside the
   attempt that captured it, with an inline thumbnail and an Open ↗ link to the
   full-resolution PNG.
10. An order retried twice shows **two** screenshot sections, one per attempt,
    each with that attempt's own frame.
11. An attempt with no screenshot (failed before step 11, capture disabled,
    upload failed) shows **no section** — no broken image, no placeholder.
12. A screenshot object older than 90 days is gone from the bucket.
13. A screenshot or R2 failure does **not** fail the submit — the order still
    completes and the step shows the failure note.
14. Stage details never appear in `logs/<job_id>.log`.
15. An older scraper (name-only `on_stage`) still drives the checklist with no
    detail lines and no crash.
16. `npm run build` and `npm run lint` clean; existing 64 unit tests still pass.

---

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit (TS) | stage-history diff → events (dedupe, out-of-order, duplicate poll) | +4 |
| Unit (TS) | `SubmitProgress` renders detail; winback `skipped` → warning | +3 |
| Unit (TS) | panel screenshot section: renders per attempt, absent when no key, two attempts → two sections | +3 |
| Unit (Py) | `stage()` back-compat shim (2-arg vs 1-arg callback) | +2 |
| Unit (Py) | `upload_bytes` key shape + failure is swallowed | +2 |
| Integration | progress route: job with `stages` → events + `screenshotUrl` | +2 |
| Integration | `/api/orders/document` cross-user 404 on a screenshot key | +1 |
| Live | one real dry-run submit against the dealer portal, all 5 details + screenshot | manual |

---

## Rollback Plan

- **Scraper:** redeploy the previous droplet revision. Detail emission is
  additive; BizzFlow tolerates its absence (criterion 11).
- **Screenshot:** an env flag `OE_CAPTURE_PAGE1=false` disables capture without
  a redeploy.
- **DB:** `screenshotUrl` is nullable and additive — no down migration needed.
- **R2:** objects are per-order keys; delete by prefix if needed.

---

## Effort Estimate

| Component | Effort |
|---|---|
| `stage(name, detail)` + 5 emission points | 2h |
| `_set_stage` history + `/jobs` response | 1h |
| `r2_upload.py` + capture + `order_ref` plumbing | 2h |
| Migration + progress-route persistence | 1.5h |
| `SubmitProgress` detail lines | 1.5h |
| Screenshot section in the detail panel (+ `AttemptView` key) | 1.5h |
| Tests | 3h |
| Live verification | 1h |
| **Total** | **~13.5h** |

---

## Files Reference

| File | Change |
|---|---|
| `scraper/oe_feasibility.py:325-2043` | widen `stage()`; attach detail at 5 points; capture screenshot after winback |
| `scraper/api_server.py:311` | `_set_stage(name, detail)` + `stages` history; expose in `GET /jobs/<id>` |
| `scraper/r2_upload.py` | **new** — `upload_bytes` via boto3 |
| `scraper/order_to_payload.py` | add `order_ref` block |
| `src/actions/order.ts` | pass `order_ref` when starting the job |
| `src/lib/order-submit.ts` | `JobSnapshot.stages`; diff → `OrderStatusEvent`; set `screenshotUrl` |
| `src/lib/order-types.ts` | `StageDetail` type; step-detail lookup |
| `src/components/order-entry/SubmitProgress.tsx` | detail line per step |
| `src/components/order-entry/OrderHistoryPanel.tsx` | **Portal screenshot** section per attempt — thumbnail + Open ↗ |
| `src/lib/order-history.ts` | surface the `page1_captured` key on `AttemptView` |
| `src/app/api/orders/screenshot/route.ts` | **new** — auth-gated, scoped to `order-screenshots/<userId>/`, serves PNG `inline` + `nosniff` |
| `prisma/schema.prisma` + new migration | `Order.screenshotUrl` |

---

## Out of Scope

- Renumbering or relabelling `SUBMIT_STEPS`. The list stays 16 steps in portal
  order; only detail is added.
- Detail on steps 12-16 (device, attachments, appointment, delivery, pay).
- A screenshot per step, or screenshots after step 11.
- Flipping `do_pay` to TRUE.
- Replacing polling with SSE.
- Backfilling screenshots for orders already submitted.

---

## Decisions Taken (2026-08-16)

1. **One screenshot per submit**, after step 11 (`winback_tagging`). Not one per
   step. The single New Connection frame already carries all five values.
2. **The droplet uploads direct via boto3** (`scraper/r2_upload.py`). No base64
   round-trip through the job JSON — the screenshot lands whether or not the
   browser is still polling.
3. **90-day retention.** An R2 lifecycle rule expires
   `orders/*/submit-*.png` after 90 days. These frames carry full name,
   installation address, mobile, email and the order number; the window covers
   installation plus the first bill cycle and no longer.
4. **Full-page capture**, matching the reference screenshot.

### Retention — configuration note

The lifecycle rule is bucket config, not code, so it must be applied once by
hand and recorded here. The bucket also holds bills (`bills/...`) and order
documents (`orders/<userId>/<filename>`), which are **not** in scope for
expiry — the rule must match the screenshot key shape only:

```
prefix: orders/
filter: suffix/key pattern submit-*-page1.png
action: expire after 90 days
```

R2 lifecycle rules filter by **prefix only**, not suffix. So the screenshot key
must live under its own prefix to be expirable independently:

```
order-screenshots/<userId>/<orderId>/submit-<attempt>-page1.png
```

This supersedes the `orders/<userId>/<orderId>/...` key in the Proposed Change
section above. The document route's prefix check
(`orders/${session.user.id}/`) does **not** cover this new prefix, so screenshot
reads need their own auth-gated route scoped to
`order-screenshots/${session.user.id}/` — which also resolves open question 4:
a separate route, serving PNG `inline` with `nosniff`, leaving the existing
document route untouched.

## Remaining Open Question

- Nothing blocking. Confirm during implementation that the R2 plan in use
  supports lifecycle rules; if not, fall back to a scheduled deletion pass
  keyed off `Order.submittedAt` older than 90 days.

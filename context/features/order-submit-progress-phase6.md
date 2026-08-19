# Order Submit Progress — Phase 6: Finish the Post-Pay Tail and Capture the e-RF

## Status

**Code complete, live-unverified.** Built on `feature/order-submit-progress-phase6`.
Verified by build, lint, 79 scraper tests and 209 unit tests — and by nothing
else, because every line of it runs only after a real charge. Open questions 1,
2 and 4 below are answered by the first live run, not by this branch.

## Problem

The submit flow stops thinking one Next after Pay. `pay_and_submit`
([scraper/oe_feasibility.py:3136](../../scraper/oe_feasibility.py#L3136)) clicks
Pay, then loops at most three times looking for the words **"Submit
Successfully"** and gives up with `submit_result_not_found` if it never sees
them. The portal does not end there. After Pay there are several more **Next**
clicks, and the run finishes on a **New Connection** confirmation page carrying:

- `New Connection / Customer Order Number 2608000121575083` as its heading
- the bundle and its service numbers — `BUNDLE37849267`, voice `60322016321`,
  broadband `2312@unifi`, TV `2312@iptv` — each with its offer name and
  Accept Date
- a **Print e-RF** button, which downloads the electronic Registration Form PDF

That PDF is the single document a dealer is asked for when an order is
disputed, and today it is never fetched. The page it sits on is also the only
screen that lists the assigned service numbers together with what each one
bought — the Pay capture, which is currently the last frame of a run, is taken
*before* the click and therefore before any of those numbers exist.

There is a second, quieter problem in the same loop. `_find_submit_result`
([oe_feasibility.py:3094](../../scraper/oe_feasibility.py#L3094)) gates on
`/submit\s*success/i` in the page body. Nothing in the confirmation page above
matches that. The order number is right there in the heading, so a run can
complete a real payment and still return `submit_result_not_found`, writing no
order id — the failure mode that is worst of all, because the money has moved.

## Scope

This runs **only when `do_pay=TRUE`**. With the gate closed a run stops at
`ready_to_pay` and none of this code is reachable, which is why it has to be
built defensively: by the time it executes, the customer has been charged.

### 1. Scraper — walk the post-Pay chain to the e-RF page

Replace the three-iteration "look for Submit Successfully" loop with an
explicit advance loop, bounded (proposed `max_post_pay_next = 6`), that after
each Next asks three questions in order:

1. **Is this the e-RF page?** — a visible `Print e-RF` control, matched on the
   button text rather than a class, since we have never inspected its markup.
   This is the terminal condition.
2. **Is this a "Submit Successfully" page?** — keep `_find_submit_result` as it
   stands. If the portal shows that screen on the way, it is still the cheapest
   confirmation we have, and old runs read the same way.
3. **Did Next advance?** — reuse `click_next_newconn`, which already classifies
   a blocked Next and carries the portal's own wording (Phase 5's
   `blocked_next_error`). A blocked Next here must **not** be reported the way a
   pre-Pay block is: the order is paid. See "Failure after payment" below.

Each successful Next emits `page_break` exactly as the rest of the flow does, so
the post-Pay pages read as pages on the timeline rather than as one silent gap
between Pay and Done.

**Order number, read twice.** Take the id from the confirmation heading
(`Customer Order Number <digits>`) as well as from `_find_submit_result`. If
both are present and disagree, the heading wins and the disagreement is logged —
the heading is on the page the customer's order actually landed on. Run it
through `isPortalOrderNumber()`'s scraper-side equivalent before it is allowed
near `Order.orderId`, the same guard Phase 5 added after a failure sentence was
once persisted as an order number.

### 2. Scraper — capture the confirmation page, then the PDF

Two artefacts, in this order, both non-fatal:

- **`erf_page`** — a JPEG frame of the confirmation page through the existing
  `capture_and_report(page, payload, "erf_page", stage)`. Taken **before** the
  Print e-RF click, because a click that navigates or opens a window can take
  the page with it. `_scroll_to_heading` may be needed: the service breakdown is
  a list that runs below the fold in the same inner scroller every other page
  uses, so a second `erf_page_bottom` frame follows the established pattern if
  the first frame proves to be cut.
- **`erf`** — the PDF itself. Click Print e-RF inside a Playwright
  `expect_download`, save the bytes, upload to R2, report the key as a capture
  stage.

`screenshot_key()` ([scraper/r2_upload.py](../../scraper/r2_upload.py)) hardcodes
`.jpg` and the `submit-<attempt>-<slot>` shape. The e-RF gets its own key
function so it can be named after the order it documents:

```
order-screenshots/<userId>/<orderId>/<portalOrderNumber>_erf.pdf
```

Named by the **portal's** order number rather than by attempt, because that is
the number on the document itself and the number a dispute will quote — a file
called `submit-3-erf.pdf` is unidentifiable once it has been downloaded to
someone's desktop, and the download route serves the key's own basename as the
filename. The portal mints a fresh number per attempt, so this stays unique
across resubmits without an attempt counter. The number is sanitised to
`[A-Za-z0-9]` before it reaches a key.

**Same prefix as the frames, deliberately.** The 90-day lifecycle rule filters
by prefix, and the decision here is that the e-RF expires with the evidence it
belongs to rather than living forever beside customer ID documents under
`orders/`. One consequence is worth stating plainly: **the e-RF is not a
permanent record.** If it ever needs to be, it moves prefix — which is a
migration, not a config change.

**Download, not print.** The click produces a file download. If a live run shows
otherwise (a popup tab, or `window.print()`), that is a finding, not a bug to
paper over — the loop should log which of the three fired and return a
classified failure rather than guessing. See "Open questions".

### 3. Types — let a capture be a PDF

`isScreenshotKey()` ([src/lib/order-types.ts:216](../../src/lib/order-types.ts#L216))
accepts `.png|.jpe?g` only, so a `.pdf` key would be treated as a *failure
reason* and rendered as a text row saying "order-screenshots/…/erf.pdf". The
extension test widens to include `pdf`, and a companion predicate —
`isPdfCapture(key)` — tells the renderers which of the two shapes they are
holding. Every call site that today assumes "capture ⇒ `<img>`" must consult it:
`ShotRow` ([OrderHistoryPanel.tsx:233](../../src/components/order-entry/OrderHistoryPanel.tsx#L233)),
the thumbnail strip, and `CaptureCarousel`'s preloader
([CaptureCarousel.tsx:100](../../src/components/order-entry/CaptureCarousel.tsx#L100)),
which constructs an `Image()` per frame and would silently fail on a PDF.

New `CAPTURE_SLOTS` entries:

| slot | label | caption |
| --- | --- | --- |
| `erf_page` | Order confirmation | The service numbers the portal assigned, with the offer and accept date for each. |
| `erf` | e-RF (Registration Form) | The registration form the portal generated for this order. |

### 4. Route — serve the PDF

`/api/orders/screenshot` ([route.ts](../../src/app/api/orders/screenshot/route.ts))
allowlists `png|jpg|jpeg`. Add `pdf → application/pdf`. It already serves
`Content-Disposition: inline` with `X-Content-Type-Options: nosniff` and scopes
every read to `order-screenshots/<callerId>/`, which is exactly what an inline
preview needs and exactly the isolation a document carrying the customer's name,
address and IC requires. No new route: a second route would be a second copy of
that tenant check.

### 5. UI — a document row, and an inline preview

- **Timeline.** `ShotRow` renders a PDF capture with a file icon instead of the
  camera and a thumbnail-shaped tile reading "e-RF (Registration Form) · PDF",
  clickable into the carousel like any other frame. The existing expiry chip
  applies unchanged — it is the same prefix and the same rule.
- **Carousel.** The PDF is a slide in the same sequence, at its chronological
  position, rendered in an `<iframe src={captureSrc(key)}>` rather than an
  `<img>`. Arrow keys, the thumbnail rail and "Open original" keep working;
  the rail shows the file tile in place of an image thumbnail.

An inline preview is the whole point of storing it — a download-only link makes
the agent leave the page to answer "did the e-RF come out right?".

**Browsers that will not render a PDF inline** (some mobile Safari
configurations) fall back to the "Open original" link the carousel already
carries. The iframe gets a visible fallback body rather than an empty grey box.

### Failure after payment

Everything from the Pay click onward is instrumented so that **no failure in
this phase can be reported as a failed order.** The money has moved; an order
that reads "failed" in BizzFlow after a real charge is worse than one that reads
"paid, e-RF not captured".

Concretely: if the post-Pay chain blocks, or the e-RF page is never reached, or
the download times out, the result stays `status: "submitted"` when an order
number was read, and carries a `warning` naming what was missed. Only the case
where the chain blocks **and** no order number was recovered from either source
is an error — and that error says explicitly that a payment was made.

## Decisions

- **Terminal condition is the Print e-RF button, not a page title.** The
  heading is `New Connection`, the same words as page 1; a title match would
  end the loop on the wrong page. The button exists on exactly one screen.
- **The e-RF expires with the screenshots.** Chosen over permanent storage.
  Stated above as a consequence, not buried.
- **Capture the confirmation page before clicking.** A click that navigates
  destroys the only screen showing the assigned service numbers.
- **Reuse `/api/orders/screenshot`.** One tenant check, not two.
- **Read the order number from the heading.** The current gate can miss a real,
  paid order entirely.

## Open questions

1. **How many Next clicks separate Pay from the e-RF page?** "A few" — the bound
   of 6 is a guess with room in it. One live run settles it, and the run log
   should print the count so it is settled from evidence.
2. **Does a "Submit Successfully" screen appear at all in this flow?** The
   confirmation page in hand shows no such text. If it never appears,
   `_find_submit_result` is dead code on this path and should be retired
   rather than left as a phantom check.
3. **What is the portal's own downloaded filename?** Ours is named for the
   order number regardless; the portal's is logged on download so we learn it.
4. **Is Print e-RF ever disabled or absent** — for some offer types, or before
   some back-office step completes? If so, absence is a normal outcome, not a
   failure, and the copy must say so.

## Acceptance criteria

1. With `do_pay=TRUE`, a real submit advances past Pay to the e-RF page and
   returns `status: "submitted"` with the order number read from the heading.
2. Each post-Pay Next emits a `page_break`; the timeline shows the post-Pay
   pages rather than a gap.
3. `erf_page` JPEG lands in R2 and appears on the timeline at its chronological
   position, showing the assigned service numbers.
4. `erf` PDF lands at `order-screenshots/<userId>/<orderId>/submit-<n>-erf.pdf`
   and is served inline by `/api/orders/screenshot` with `application/pdf`.
5. The PDF renders inside the carousel; arrows, rail and Escape are unaffected
   by its presence in the sequence.
6. A cross-tenant key request for the PDF 404s, same as for a frame.
7. A forced download failure leaves the order `submitted` with a warning, never
   `failed`.
8. `npm run build`, lint clean on touched files, and unit tests for
   `isScreenshotKey` / `isPdfCapture` over `.pdf`, `.jpg`, `.png` and a failure
   sentence.

## Risks

- **Everything here executes only after a real charge.** It cannot be exercised
  without spending money, so the first run is both the test and a live order.
  It should be a real order someone intends to place anyway.
- Phase 5's live-unverified work sits upstream of this: no submit has yet
  reached Pay with the new appointment reader. This phase is behind that gate.
- The R2 lifecycle rule is still unapplied, so `NEXT_PUBLIC_CAPTURE_RETENTION_DAYS`
  stays unset and the expiry chip stays dark for the PDF exactly as it does for
  the frames.

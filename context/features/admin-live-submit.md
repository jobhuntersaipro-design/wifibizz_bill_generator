# Admin Live Submit — submit an order as admin and watch the browser as it runs

**Date:** 2026-09-16
**Status:** SPEC APPROVED, NOT BUILT
**Touches:** scraper (droplet, container recreated) + Vercel. No migration.

## Problem

Diagnosing a failed submit today means reading a stage list polled every 2 s, a dozen JPEG captures
taken at fixed slots, and the droplet job log. Short-lived things — a dialog that flashed for a second,
a button that was disabled at the moment it was clicked, a tab that had not finished loading — leave no
trace unless a capture slot happened to fire at that instant. Every one of the last ten scraper fixes
was diagnosed from a single failure frame and the log, and several took two live runs to pin down.

Admin also cannot submit an order at all. The nearest tool is Clone & retry, which hands a draft to an
agent to submit from their own tab.

## Decisions (taken with the user, 2026-09-16)

1. **Dealer session:** admin picks an Order Entry account and the run submits under that agent's session
   and staff code. Admin gets no dealer login of its own.
2. **Live view:** a watch-only screen stream of the droplet's headless Chromium, with the step log
   alongside. No clicking into the portal, no remote desktop.
3. **Real submit, plus a Stop before Pay switch.** Default is a real, billable run. The switch maps to the
   droplet's existing `do_pay: false`, which stops at the Pay gate.
4. **Transport:** the admin's browser connects directly to the droplet over Server-Sent Events with a
   short-lived signed viewer token. Vercel does not relay the stream.
5. **Scope:** only runs that admin starts have a live view. Attaching to a run an agent started is a
   follow-up, not this version.

## Goals

- `/admin/orders/[id]` has **Submit as…**: pick an account, optionally tick Stop before Pay, confirm
- Confirming opens a new tab at `/admin/orders/[id]/live` and starts the run
- The live tab shows the browser's screen as it changes, the current step of 17, the stage list, and
  the job log tail, and it says when the run has finished and how
- The live tab has a Stop button
- Agent-started runs are byte-identical to today: no screencast, no new traffic, no behaviour change
- Nothing is recorded: frames are streamed and discarded. The capture slots and failure frame stay
  the durable record

## Non-goals

- Watching a run an agent started
- Recording frames for replay
- Interacting with the portal from the live tab
- A dealer login for admin

## Design

### 1. Admin submit dialog (Vercel)

`SubmitAsAdminButton` on the admin order detail page, beside Clone & retry. Opens a dialog:

- **Account list** from a new `adminSubmitTargets()`: Order Entry users with `id`, `email`, `name`,
  `isSuperAdmin`, `staffCode`, and the dealer session's `ConnectionView` from `describeConnection()`,
  so a dead session shows as such before the click. Superadmins first, then by email, same as
  `adminCloneTargets()`. Rows whose state is `expired` or `never` are shown but disabled.
- **Stop before Pay** checkbox, default off. Its helper text: *"The run stops on the Pay screen. The
  portal will already hold an unpaid order number for this customer, which must be paid or voided by
  hand."*
- **Warning block** naming what the run does: a real order is minted at Unifi under the chosen staff
  code. For a `warning` order the block adds the same second-order text `ResubmitDialog` carries, with
  the existing portal order number linked.
- A line reading *"Automatic retry is switched off for this order from now on."*

Eligible statuses: `draft`, `failed`, `warning`. Refused with a sentence in the dialog for
`submitting` (*"A run is already in flight"*), `submitted`, `cancelled`, deleted, and when
`isRetryPending(order)` is true. The button itself is hidden for `submitted`, `cancelled` and deleted.

**Opening the tab.** The confirm handler calls `window.open("", "_blank")` synchronously (inside the
click, so popup blockers allow it), then awaits `adminSubmitOrder`. On success it sets the new window's
`location` to `/admin/orders/<id>/live?job=<jobId>`. On failure it closes the window and shows the
error inline. If `window.open` returned null (blocked anyway), the dialog shows a link to the live page
instead.

### 2. `adminSubmitOrder(orderId, targetUserId, { stopBeforePay })` (Vercel)

In a new `src/actions/admin-submit.ts` (with `adminSubmitTargets`, `adminLiveViewToken` and `adminStopJob`); `requireAdmin()` moves to `src/lib/admin-gate.ts` so both action files share it.

1. Load the order (not deleted). Apply the refusals above. Load the target user; refuse if not
   `orderEntryEnabled`.
2. Refuse if `dealerSessionLive(targetUserId)` is false: *"That account's dealer session has expired —
   reconnect it from Order Entry first."* (`startSubmitRun` checks this too, but its check writes the
   order as `failed`; the dialog's refusal must leave the order untouched.)
3. Set `autoRetryDisabled: true` on the order. Precedent: clones. An admin watching a run does not want
   three silent retries after it, and a Stop-before-Pay run retried automatically would mint more
   unpaid orders.
4. Call `startSubmitRun(order, { userKey: targetUserId, doPay: !stopBeforePay, liveView: true,
   startedBy: "admin" })`.
5. On `ok`, write `recordAudit({ action: "order_admin_submitted", targetOrder: orderId, detail:
   "Submitted <reference> as <target email> (<staff code>)<, stopping before Pay> — job <jobId>." })`
   and return `{ success, jobId, viewerToken, expiresAt }`. On refusal, return the error;
   `startSubmitRun` has already filed the order as it does for any refused start.

`startSubmitRun` gains three optional opts. `doPay?: boolean` — when omitted the env var decides,
exactly as today. `liveView?: boolean` — sent to the droplet as `live_view`. `startedBy?: "admin"` —
changes the history event's message to *"Submit started by admin under <staff code>."* and nothing
else. Every existing caller passes none of them and is unchanged; a test pins the request body for the
existing call shape.

### 3. Viewer token

`src/lib/live-view-token.ts` and the same rule in `scraper/live_view.py`.

- Key: `sha256("bizzflow-live-view:" + ORDER_ENTRY_API_TOKEN)`. The droplet already holds that token,
  so no new secret is shared or configured.
- Token: `<jobId>.<expUnixSeconds>.<hex hmac-sha256(key, jobId + "." + exp)>`.
- Expiry: 30 minutes from mint. The page asks for a new one on reconnect (section 6).
- Verification refuses a malformed token, a bad signature, an expired token, and a token whose job id
  is not the job being opened. Comparison is constant-time.
- A shared test vector (fixed token, fixed job id, fixed exp) is asserted in both vitest and pytest so
  the two implementations cannot drift.

`adminLiveViewToken(orderId)`: admin-gated; reads `order.jobId`; refuses when null; mints a token for
that job. Used by the live page on load and on reconnect. The token is never written to the database.

### 4. Screencast in the run (scraper)

`POST /orders` accepts `live_view: bool` (default false) and stores it on the job record as
`live_view`. `_run_order_job(..., live_view=False)` carries it to the run; the batch runner passes
nothing and is unchanged.

`enter_full_order` gains a keyword argument `live_view_job_id: str | None = None`; the runner passes
the job id only when `live_view` is set. Right after `open_context_from_session` returns the page and
before `ensure_on_order_entry`, it calls `live_view.attach(page, live_view_job_id)`. A plain argument
rather than a `ContextVar`: the runner already knows the job id, and an explicit parameter is easier
to test than ambient state. `attach` is best-effort: any exception is printed to the run log and the run continues —
the live view must never cost an order.

`scraper/live_view.py`:

- `attach(page, job_id)`: `session = await page.context.new_cdp_session(page)`, then
  `Page.startScreencast` with `format: "jpeg"`, `quality: 50`, `maxWidth: 1280`, `maxHeight: 800`,
  `everyNthFrame: 1`. On each `Page.screencastFrame` event: store the frame, then
  `Page.screencastFrameAck` with the frame's `sessionId`. The ack is what lets Chromium send the next
  frame; it is sent whether or not the frame is forwarded.
- `FrameStore` (one per job, in a module dict guarded by a lock): `latest` (bytes + timestamp),
  `subscribers` (bounded queues), `last_sent_at`. `publish_frame` forwards a frame to subscribers only
  when at least `MIN_FRAME_INTERVAL_S = 0.25` has passed since the last forwarded one; otherwise it
  only replaces `latest`. So a burst of repaints costs subscribers at most 4 frames a second, and the
  latest frame is always what a new subscriber sees first.
- `publish_stage(job_id, stage)` and `publish_log(job_id, line)` push to every subscriber
  unthrottled. `_set_stage` in the job runner calls `publish_stage`. Log lines come from the SSE
  route tailing the job's log file (section 5), not from `job_logging`, so the print path is untouched.
- Subscriber queues hold 64 items. When full, the OLDEST `frame` item is dropped; a `stage` or `log`
  item is never dropped. A viewer that is too slow sees fewer frames, never a gap in the story.
- `detach(job_id)` stops the screencast, closes every subscriber queue, and keeps only `latest` for
  `LIVE_VIEW_LINGER_S = 120` seconds so a viewer who opens the page just after the run ends still sees
  the final screen. The store is evicted by the next `attach` or route call that finds it past its
  linger. Called from the run's `finally`. A closed page ends the screencast on its own, so detach
  failing is harmless.
- Memory: one 1280×800 JPEG at quality 50 is roughly 40 to 80 KB. One `latest` plus 64 queued frames
  per viewer, at most 3 viewers, is under 20 MB in the worst case on a box that budgets 700 MB per
  browser.

### 5. `GET /jobs/<job_id>/live?token=…` (scraper)

- 401 `{"error": "unauthorized"}` for a missing, malformed, expired, mismatched or tampered token.
- 404 `{"error": "unknown_job"}` for a job not in `JOBS`.
- 404 `{"error": "no_live_view"}` for a job whose record has no `live_view` — the "agent's run" case;
  the page renders that as a sentence, not a blank panel.
- 429 `{"error": "too_many_viewers"}` when `LIVE_VIEW_MAX_VIEWERS = 3` streams are already open across
  the process. Each open stream holds one gunicorn thread; the Dockerfile's `--threads` goes from 8 to
  16 so three viewers cannot starve the API.
- With `&probe=1` the same checks answer `200 {"ok": true}` as JSON and no stream — the browser cannot
  read an EventSource's status code, so the page probes first and turns 401/404/429 into sentences.
- Otherwise `text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, and
  `Access-Control-Allow-Origin: <LIVE_VIEW_ORIGIN>` — a new droplet env var (`https://bizzflow.top`
  in production). The header is set on this route only; nothing else on the droplet gains CORS.
  EventSource sends a plain GET, so no preflight route is needed.

Events, each as `event: <name>` + `data: <json>`:

| event | data | when |
|---|---|---|
| `hello` | `{ job_id, status, stage, started_at, live_view: true }` | first, always |
| `frame` | `{ jpeg: <base64>, at }` | the latest frame immediately on connect, then each forwarded frame |
| `stage` | `{ name, detail, at }` | every stage already in the job record on connect (so a late joiner has the full list), then each new one |
| `log` | `{ line }` | the last 4 KB of the log file on connect, then each appended line, polled every 250 ms |
| `status` | `{ status, error?, error_kind?, order_id? }` | when the job reaches `done` or `error`; the stream closes after it |
| `ping` | `{}` | every 15 s while idle, so proxies do not close the connection |

The route loop: register a subscriber, send `hello` + latest frame + stages + log tail, then block on
the queue with a 250 ms timeout; on each wake it drains the queue, checks the log file for new bytes,
checks the job's terminal state, and emits `ping` when 15 s have passed with nothing sent. Client
disconnects raise on write and unregister the subscriber. The subscriber is always unregistered in a
`finally`, so a dropped viewer frees its slot.

Caddy streams `text/event-stream` responses unbuffered by default; no Caddyfile change.

### 6. The live page (Vercel)

`src/app/admin/(dashboard)/orders/[id]/live/page.tsx`, admin-gated by the existing proxy matcher on
`/admin`. It reads `?job=`; when absent it uses the order's current `jobId`. The server component
mints a token through `adminLiveViewToken` and renders `LiveRunViewer` with the order's reference,
customer name, job id, token, expiry, and the droplet's public URL from `NEXT_PUBLIC_SCRAPER_API_URL`
(new; `https://scraper.bizzflow.top` in production, `http://localhost:5000` locally). The topbar uses
`adminNavContext` — the page is mapped as **Live run** with a back chevron to the order.

`LiveRunViewer` (client): two columns, stacking at narrow widths.

- **Left — the screen.** One `<img>` whose `src` is replaced per frame from a Blob URL (the previous
  URL is revoked). A timestamp under it reads *"frame 2 s ago"* and turns amber past 10 s so a stalled
  stream is visible. Before the first frame: *"Waiting for the browser…"*.
- **Right — what is happening.** The `SUBMIT_STEPS` list with `progressReading()` for the current
  step ("Step 6 of 17 · Filling Broadband tab"), the stage list with times and details, and the log
  tail in a monospace box that autoscrolls unless the pointer is over it. A connection chip:
  Connecting / Live / Reconnecting / Finished / Could not reach the order service.
- **Stop.** A button opening a confirm dialog with the same portal-order warning `StopSubmitDialog`
  carries, then calling a new `adminStopJob(orderId)`: admin-gated, calls the droplet's existing
  `POST /jobs/<id>/cancel` (no force), and audits `job_released`. The order's own finalization
  (`finalizeMissingJob` / the webhook) files the outcome exactly as an agent's Stop does today; this
  action does not touch the order row.
- **Finished.** On `status`, the chip reads Finished with the outcome and a link back to the order
  page. The last frame stays on screen.

Reconnect: `EventSource` reconnects on its own after a drop. Before it does, the component checks the
token expiry; within 2 minutes of it, it calls `adminLiveViewToken` and opens the new URL instead. A
401 on connect (token already dead) triggers the same refresh once; a second 401 shows a sentence with
a Reload button. A 404 `no_live_view` renders *"Live view was not enabled for this run."* A 429
renders *"Three viewers are already watching runs on the order service — close one and reload."*

The admin order detail page gets a **Watch live** link beside the status while the order is
`submitting` and `jobId` is set. For an agent's run the live page answers with the no-live-view
sentence, which is the honest state.

### 7. Environment and deploy

- Vercel: `NEXT_PUBLIC_SCRAPER_API_URL`.
- Droplet `.env`: `LIVE_VIEW_ORIGIN`.
- Dockerfile: `--threads 16`.
- Droplet deploy with the container recreated (new route, new module, gunicorn flag). Deploy the
  droplet first: an older droplet ignores `live_view` and the page reports no live view, which
  degrades cleanly; an older Vercel never sends it.

## Error handling

| Situation | Behaviour |
|---|---|
| Target session dead | Dialog refuses before any write |
| Droplet busy / unreachable at start | `startSubmitRun` files the order as today (busy defers, unreachable fails); the dialog shows the message; the opened tab is closed |
| Screencast attach fails | Printed to the run log; the run continues; the page shows "Waiting for the browser…" and the stage list still moves |
| Viewer disconnects | Subscriber freed; run unaffected |
| Viewer slow | Frames dropped from its queue, stages and log kept |
| Token expires mid-run | Page refreshes it and reconnects; last frame stays on screen |
| Job finishes while viewer connected | `status` event, stream closes, page shows outcome |
| Job finishes before viewer connects | `hello` carries the terminal status; page shows outcome and the last frame while the store is within its 120 s linger, else "Waiting for the browser…" is replaced by the outcome alone |
| Run stopped from the page | Same path as the agent's Stop; order filed `failed` / `submit_stopped` by the existing finalization |

## Security

- The live route is reachable without the internal token, so the viewer token must be unforgeable and
  short-lived: HMAC under a key derived from the internal token, 30 minutes, bound to one job id.
- The token travels in the query string (EventSource cannot set headers), so it appears in Caddy and
  gunicorn access logs. Its expiry bounds the exposure; it is minted only for admins and never stored.
- Frames carry customer PII — the same data the admin order page already shows. They are streamed to
  one authenticated admin and discarded. Nothing is written to disk or R2.
- CORS is granted to one origin on one route. The `X-Internal-Token` routes gain no CORS.
- The droplet's `GET /jobs` listing still carries no frames and no PII.

## Testing

**Scraper (pytest):**
- `test_live_view_token.py`: valid token accepted; expired, wrong job, tampered signature, malformed
  refused; the shared test vector verifies.
- `test_live_view_store.py`: throttle forwards at most one frame per 250 ms and always updates
  `latest`; a full queue drops the oldest frame and never a stage or log item; detach removes the
  store.
- `test_live_view_route.py` (Flask test client, fake store): 401 / 404 unknown / 404 no_live_view /
  429; on connect the stream carries `hello`, the latest frame, every recorded stage, and the log
  tail, in that order; a terminal job emits `status` then ends; the subscriber is unregistered after
  the client goes away.
- `test_live_view_screencast.py` (real Chromium): attaching to a page produces at least one frame;
  changing the page's content produces a newer frame; a `live_view=False` job attaches nothing.
- Existing `test_capacity_gate` and `test_job_cancel` untouched and passing.

**Vercel (vitest):**
- `live-view-token.test.ts`: mint/verify round trip and the shared vector matching Python.
- `admin-submit.test.ts`: each refusal (status, retry pending, deleted, target not enabled, dead
  session) leaves the order untouched; a good call sets `autoRetryDisabled`, passes `doPay: false`
  only when Stop before Pay is ticked, sends `live_view: true`, writes the audit row, and returns the
  job id and a token.
- `order-start.test.ts` additions: the request body for the existing call shape is unchanged; `doPay`
  overrides the env var; `startedBy: "admin"` changes only the history message.

**Browser:**
- A dev-only `scraper/devtools/live_view_demo.py` registers a fake `live_view` job in a local
  `api_server` and screencasts a public page, so the whole viewer — frames, stages, log, reconnect,
  finish — is exercised locally without a dealer session. Devtools are dockerignored and never ship.
- The dialog on the dev server: account list with session states, refusals, Stop before Pay text,
  the tab opening and navigating.
- The live page at 1280 and 375 widths, zero console errors.

**Live proof (the user's to trigger):** one admin submit against the portal with Stop before Pay
ticked, watched end to end, then the unpaid order voided. This is the first time a run is watched
rather than reconstructed.

## Consequences stated up front

- An admin submit permanently switches automatic retry off for that order.
- A Stop-before-Pay run leaves a real unpaid order at Unifi.
- Three gunicorn threads can be held by viewers; the thread count is raised to cover it.
- The viewer token is visible in droplet access logs for its 30-minute life.

---
name: order_entry_feature
description: Architecture and known-critical issues in the Unifi eSales order-entry feature (BizzFlow frontend + Flask/Playwright scraper backend)
metadata:
  type: project
---

Order Entry (Unifi eSales) is an in-progress feature (see context/current-feature.md) letting BizzFlow users key broadband orders into the Unifi dealer portal. It spans:
- Frontend: `src/app/dashboard/order-entry/page.tsx`, `src/components/order-entry/{OrderForm,OrdersList}.tsx`, `src/actions/{order,dealer}.ts`, `src/lib/{order-types,dealer-offers,mykad,r2}.ts`
- Backend (Python/Flask/Playwright): `scraper/api_server.py`, `scraper/dealer_web_login.py`, `scraper/dealer_login_service.py`, `scraper/order_entry.py`, `scraper/login_manager.py`

**Why this matters:** `submitOrder()` in `src/actions/order.ts` is currently a hardcoded no-op stub ("Portal submission isn't wired up yet") — none of the issues below are exploitable/live yet, but they will become live (some billable/PII-critical) the moment someone wires `submitOrder` to `POST /orders` and/or flips `dry_run` to `False`. Re-check this area whenever that wiring lands.

## Two disconnected login subsystems (architecture bug)
- The NEW per-user flow (`dealer_web_login.py` + `dealer_login_service.py`): user types staff code + password + their own OTP through BizzFlow; session cookies saved per-user to `sessions/dealer_<user_key>.json`. Password is never persisted (lives only in the in-memory `_PENDING` dict, dropped after phase 2 or TTL).
- The OLD shared flow (`login_manager.py` + `credential_manager.py`): single shared credential set at `config/credentials.enc` (Fernet-encrypted), OTP auto-read from a fixed Gmail inbox via `gmail_otp_reader.get_latest_otp()`. Built for the open-access `/scrape*` endpoints.
- **`scraper/order_entry.py::enter_order()` (line ~398-410) uses the OLD shared-credential flow, not the per-user session the order-entry UI builds.** It never accepts a `user_key`/session param at all. So when wired up, every user's order submission would run under one shared dealer identity (multi-tenancy violation), and would break/hijack if the shared credential file changes.
- Compounding this: `POST /save_credentials` on the Flask server is **open access, no auth** and overwrites the same `config/credentials.enc` that `enter_order()` reads. So the auth gate on `/orders` (shared-secret `X-Internal-Token`) is undermined by an unauthenticated route that controls which dealer account `/orders` actually logs in as.

## Auth boundary gap: job read-side is open even though write-side is gated
- `POST /orders`, `POST /dealer/login/*` are gated by `X-Internal-Token` (`_order_entry_authorized`).
- `GET /jobs/<job_id>` and `GET /jobs/<job_id>/log` are **not** gated — they're shared with the open-access scrape-job system (same `JOBS` dict, same routes, `api_server.py` lines ~188-220).
- `_run_order_job` (api_server.py ~242-291) does `print(f"... enter_order result: {result}")` to the job's log file — for a `dry_run` result this includes the full `would_submit` payload (customer MyKad number, name, mobile, email, address). That log file is servable to anyone via unauthenticated `GET /jobs/<job_id>/log`.
- (The JSON `GET /jobs/<job_id>` response itself actually strips `result` unless it has a `success` key — order results use `status` not `success`, so the JSON route currently returns nothing useful for order jobs. The **log file** route is the real leak vector.)

## Other confirmed issues (see full audit report delivered to user for full list/severities)
- `src/lib/r2.ts` `uploadToR2()` returns a public, unsigned R2 URL; `src/actions/order.ts::uploadOrderDocument` (~line 88) names uploaded ID-document files `{idNumber}_{docSlug}_{seq}.{ext}` — predictable/enumerable filenames for PII documents (MyKad scans) on a public bucket.
- `src/components/order-entry/OrderForm.tsx::handleSave` never passes `id` back into `saveOrder()` — there is no `orderId` state at all in this component — so every "Save Order" click **creates a new draft row instead of updating the existing one**. No zod validation anywhere in `src/actions/order.ts` or `dealer.ts` (confirmed no `zod` import in `src/actions/` or anywhere in `src`), despite project standard mandating it.
- `dealer_login_service.py::request_otp` has no cap on concurrent pending logins / spawned headless Chromium instances, and runs entirely outside the `JOBS` global single-browser lock used by scrape/order jobs — potential resource-exhaustion DoS.
- `saveOrder`'s `prisma.order.update({ where: { id, userId } })` (order.ts ~171-174) **is actually a correct, safe IDOR-preventing pattern** (Prisma's `WhereUniqueInput` is `AtLeast<{id, userId, ...}>`, confirmed in generated types) — do not flag this as a bug in future scans, only the generic error message it returns on a cross-user attempt (can't distinguish "not found" from real DB failure) is a minor note.

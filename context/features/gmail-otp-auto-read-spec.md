# Auto Read Gmail OTP — Feature Spec

## Status

Not started — planning.

## Goal

When connecting a dealer account (`src/actions/dealer.ts` → `scraper/dealer_login_service.py`),
the user currently has to open their email, find the OTP the Unifi portal sent,
and type it into the BizzFlow UI by hand (`submitDealerOtp`). This feature
automates that: BizzFlow reads the OTP straight from Gmail and submits it
without the user copy-pasting anything.

## Current state (what already exists)

- **`scraper/gmail_otp_reader.py`** — a working `GmailOTPReader` class that polls
  the Gmail API for a message from a given sender, strips HTML, and regexes out
  a 6-digit code. Already used by `scraper/login_manager.py` (the *internal*,
  shared-account login flow used by `scrape_orders.py`) — see
  `login_manager.py:10,393`. That flow already fully automates OTP entry today.
- **Nothing configured yet**: `scraper/config/gmail_credentials.json` and
  `scraper/config/gmail_token.json` don't exist on this machine. Gmail OAuth has
  never actually been set up — `login_manager.py`'s auto-OTP path has never run
  successfully here.
- **The per-user dealer-connect flow is separate code** and does **not** call
  `gmail_otp_reader` at all: `dealer_login_service.py:request_otp()` starts the
  portal login and returns a `pending_id`; `submit_otp()` takes a human-typed
  `otp` string and finishes the login. This is the flow the user-facing
  "Connect your dealer account" UI drives.

## The central open question: whose Gmail?

`request_otp()` accepts a `channel` (SMS or Email) chosen per user, per dealer
account. If `channel = Email`, the portal sends the OTP to **whatever email is
registered on that specific Unifi dealer account** — not necessarily a mailbox
BizzFlow has any access to.

`gmail_otp_reader.py` authenticates to **one** Gmail mailbox via a single OAuth
token (`config/gmail_token.json`). That works for the internal flow because
there's exactly one shared dealer account (`TMRS00517`) with one known inbox.
It does not generalize to arbitrary per-user dealer accounts without one of:

- **Option A — Single shared mailbox (small scope).** Only auto-read OTP for
  accounts whose registered email is a mailbox BizzFlow already controls (e.g.
  a shared admin inbox, or SMS-forwarding email like `@forward-sms.com` already
  referenced in `gmail_otp_reader.py`). Reuses the existing reader as-is.
  Doesn't help users connecting *their own* personal dealer accounts.
- **Option B — Per-user Gmail OAuth (full scope).** Each user grants BizzFlow
  read access to their own Gmail via OAuth consent, and we store a token per
  user (keyed like `dealerAccount`/`userId`). Solves the general case, but is a
  meaningfully bigger build: consent screen, per-user token storage/refresh,
  Google API verification/quota considerations, and a fallback to manual entry
  when a user won't grant Gmail access.

**Recommendation:** confirm which case this feature is actually for before
building — re-crawling activated cases (single shared WifiBizz account, Option
A shape) vs. arbitrary dealer-connect users (Option B). If it's Option A, this
is a small, mostly-plumbing change. If Option B, treat it as its own project
(OAuth consent flow, credential storage, security review) rather than a
drop-in addition to `dealer_login_service.py`.

## Proposed approach (assuming Option A — shared mailbox)

1. **Wire up Gmail auth for real.** Get `config/gmail_credentials.json` (OAuth
   client from Google Cloud Console) and run the one-time
   `GMAIL_ALLOW_BROWSER=1` flow locally to produce `config/gmail_token.json`.
   Document required scopes (`gmail.readonly`) and where the token lives in
   deployment (mount into the DigitalOcean container like `sessions/`/`config/`
   already are per `docker-compose.yml`).
2. **Auto-request Email channel + auto-read.** In `dealer_login_service.py`,
   after `request_otp()` succeeds with `channel="Email"`, kick off
   `gmail_otp_reader.get_latest_otp(sender_filter=..., max_wait=...)` in the
   background (mirrors `login_manager.py:393`'s `asyncio.to_thread` pattern)
   instead of waiting on the client to call `submit_otp()` with a human-typed
   code.
3. **New/changed endpoint behavior.** Either:
   - `request_otp()` blocks (with a sane timeout) until the OTP is found, then
     completes the login server-side and returns `{"ok": true}` directly — no
     `submit_otp` round-trip needed, or
   - keep the two-step shape but add an `auto` flag: the server fills in the
     OTP itself and the client just polls a status endpoint.
   Pick based on how `src/actions/dealer.ts` and the connect-account UI should
   behave (loading state vs. still showing an OTP input as a manual fallback).
4. **Manual fallback stays available.** Auto-read should have a timeout (e.g.
   60–120s) and fall back to the existing manual OTP form if no email arrives
   in time — email delivery isn't guaranteed to be fast.
5. **Update `.env.example`** with any new required vars (e.g.
   `GMAIL_OTP_SENDER_FILTER`) and note in the scraper README/`.dockerignore`
   comment that `config/gmail_credentials.json` + `config/gmail_token.json` are
   secrets, never baked into the image (already excluded via
   `scraper/.dockerignore`'s `config/` line — confirm that still holds).

## Edge cases to handle

- No OTP email arrives within the timeout → surface a clear error and let the
  user fall back to typing the code manually (don't hard-fail the login).
- Multiple pending logins racing for OTP emails at once (the existing
  `_PENDING` dict already supports concurrent logins per `MAX_CONCURRENT_LOGINS`)
  — the sender/timestamp filtering in `_extract_otp`/`get_latest_otp` needs to
  correctly disambiguate concurrent requests if Option A ever serves more than
  one user's login at a time.
- Gmail token expiry/revocation on the server (no browser available to
  re-auth) — `gmail_otp_reader.py` already raises a clear `RuntimeError` for
  this case; the calling code needs to surface that as a real error, not a
  silent failure.

## Acceptance criteria

- [ ] Gmail OAuth is configured and `config/gmail_token.json` exists in every
      environment that needs auto-read (local + droplet).
- [ ] Connecting a dealer account with the Email OTP channel completes without
      the user manually copying a code, when the email arrives within the
      timeout window.
- [ ] If auto-read times out or fails, the user can still complete login by
      typing the OTP manually (no regression to the current working flow).
- [ ] Concurrent logins from different users don't cross-match each other's
      OTP emails.

## Open questions to resolve before implementation

1. Is this for the shared WifiBizz/dealer crawl account only, or for every
   user's individually-connected dealer account? (Determines Option A vs B.)
2. If Option A: what's the actual mailbox/sender pattern OTP emails arrive at
   in this deployment — same `@forward-sms.com` pattern as the existing
   internal flow, or something else?
3. UX: should the OTP input field disappear entirely when auto-read is
   enabled, or stay visible as a manual override even on success path?

# WhatsApp CRM — respond.io-style chat desk (plan, for review)

Status: PLANNED 2026-10-20. Nothing built. Review, answer the open questions, then build phase by phase.

## Goal

The WhatsApp number is linked to BizzFlow by QR scan, so every chat on it can be handled from the browser:
read, reply, close, find, see who the customer is. **No AI in BizzFlow.** Meta AI answers from the phone;
those replies arrive as business messages and are shown as such.

## Where it stands (2026-10-20)

- Built and merged: QR link (Baileys gateway), shared inbox (Open/Unread/Closed/All), text replies, read ticks,
  close/reopen, search, contact panel linking orders and cases by phone number.
- **Not live.** Vercel has no `WHATSAPP_GATEWAY_URL`/`TOKEN`, and the gateway container was never deployed to
  the droplet (tag `scraper-v2026.10.11-2` never cut). That is the yellow banner in the screenshot.

## What is wrong with what is built

| # | Problem | Where | Effect |
|---|---|---|---|
| 1 | Inbox loads the newest **200 raw webhook rows**, receipts included, and rebuilds every chat from JSON in the browser every 8 s | `whatsapp-events.ts:6`, `whatsapp-desk.tsx` | Busy number → old chats vanish, long threads cut off, payload grows |
| 2 | A chat addressed by `@lid` without `remoteJidAlt` is **dropped** | `convert.mjs` `customerWaId` | Customer messages silently lost |
| 3 | No history on link (`syncFullHistory: false`, `messaging-history.set` ignored) | `server.mjs` | Inbox starts empty after the scan |
| 4 | Voice notes and video not saved | `convert.mjs` `MEDIA_MIME` | Bubble reads "Audio" — cannot be played |
| 5 | Customer's WhatsApp name thrown away (`pushName`) | `convert.mjs` | Every chat is bare digits |
| 6 | Webhook post: 3 tries then the message is gone from BizzFlow | `server.mjs` `postWebhook` | Vercel blip = lost message |
| 7 | Text-only sending; no quote, reactions dropped | gateway `/send`, `convert.mjs` | Cannot send a photo, a PDF or quote |

## Open questions — answer before Phase 1

1. **One shared business number in admin, or one number per agent?** Plan below assumes **one shared number**
   (what is built). Per-agent means one Baileys session per agent on the droplet (memory, more ban surface),
   the inbox moves to the agent dashboard and is scoped per user — Phase 1's tables gain a `userId`, and the
   gateway becomes a session manager. Roughly doubles Phases 1–2.
2. **Who uses the inbox?** Admin login is one shared identity, so "assign to agent" and "who replied" cannot
   exist on the admin page. If several people must handle chats with assignment, they need their own logins
   (dashboard users with an `whatsappInbox` access flag, like `orderEntryAccess`). Skipped in this plan unless
   you say yes.
3. **History on link:** recent history only (what WhatsApp pushes on link, typically recent chats) — or full?
   Full sync is slow and heavy on a 1 GB-class droplet. Plan assumes **recent only**.
4. **Media retention on the droplet:** keep forever, or delete after N days (plan: 90, same as captures)?

## Plan

### Phase 0 — Go live as-is (ops, no code)

Deploy the gateway now so real messages start landing; raw webhook rows are kept, so Phase 1's backfill
recovers everything stored in the meantime (except #2's dropped messages, which never arrive).
Steps are the existing "To go live" list in `current-feature.md` (droplet env, tag, Caddy reload, Vercel env,
scan the QR from the business phone).

### Phase 1 — A real message store (fixes #1)

- Migration: `whatsapp_messages` — `id` (WhatsApp message id, unique), `wa_id`, `direction` (in/out),
  `source` (`customer` | `phone` | `bizzflow`), `type`, `text`, `media_id`, `media_mime`, `quoted_id`,
  `status`, `error`, `at`. Index `(wa_id, at)`.
- `whatsapp_conversations` gains `name` (WhatsApp profile), `custom_name` (edited in BizzFlow),
  `last_message_at`, `last_inbound_at`, `preview`. Unread/closed keep today's rules.
- Webhook route: still stores the raw row (Raw events tab + audit), **and** upserts messages (dedupe on id),
  applies statuses furthest-wins, updates the conversation summary. Raw rows pruned after 30 days.
- `appendApiSend` writes a `bizzflow` message row directly.
- Backfill script: replays every stored raw row through the same writer (`buildInbox`'s parsing reused, then
  `buildInbox` is deleted).
- API: `GET` chat list paged by `last_message_at` with tab + search server-side; `GET` one chat's messages,
  newest 50, "load older" on scroll up; the 8 s poll asks only for changes since a cursor.
- Tests: writer idempotency (same webhook twice = one message), status ordering, backfill parity with
  `buildInbox` on the existing fixture, paging.

### Phase 2 — Gateway correctness (fixes #2, #3, #5, #6)

- LID: `remoteJidAlt` → Baileys' LID→phone mapping → else keep the chat under the LID (shown as "number
  hidden") rather than dropping it. Log every fallback.
- `pushName` forwarded as Cloud-API `contacts[].profile.name`; stored as `name`.
- `messaging-history.set`: post recent messages in batches marked `field: history`; the writer treats them like
  any message (dedupe makes re-sync harmless). Customer chats only — groups, broadcasts, channels skipped.
- Durable webhook: a failed post is appended to `/data/outbox.jsonl` and retried every 30 s until accepted.
- Tests (node:test): LID fallbacks, pushName, history batch conversion, outbox replay.

### Phase 3 — Handle chats well (fixes #4, #7 + CRM basics)

- Media in: voice notes (`audio/ogg`), video (`video/mp4`) saved and played inline; size cap 16 MB.
- Media out: attach image/PDF in the composer → gateway `/send-media` (multipart, 10 MB, same allowlist).
- Quote: reply to a specific bubble; quoted bubbles show the quoted text. Reactions shown under the bubble.
- Names: list and header show `custom_name` → WhatsApp name → number; name editable in the contact panel.
- Who sent it: business bubbles labelled "BizzFlow" or "Phone" (Meta AI replies are "Phone" — WhatsApp
  does not say whether a human or Meta AI typed it).
- Internal notes per chat (never sent), shown in the contact panel.
- Quick replies: saved snippets, `/` in the composer to insert.
- Media prune on the droplet after the retention in question 4.

### Out of scope

AI replies in BizzFlow, broadcasts/campaigns, groups, Meta's official API templates, multiple numbers
(unless question 1 says so), assignment (unless question 2 says so), tags, analytics.

## Risks

- **Ban risk** of the unofficial protocol — accepted 2026-10-11, unchanged.
- **Meta AI echo is unverified**: replies made by Meta AI on the phone should reach a linked device as the
  account's own messages; confirm on the first live day (Phase 0).
- Baileys is `7.0.0-rc14` (a release candidate); LID handling is the part most likely to change between rcs.

## Verification per phase

Phase 0: a real message in and a reply out, phone ticks match. Phase 1: unit tests + backfill count equals
`buildInbox` count on production data. Phase 2: gateway tests + one re-link shows recent chats. Phase 3: a voice
note plays, a photo sends and arrives on the customer's phone, a quote renders on both sides.

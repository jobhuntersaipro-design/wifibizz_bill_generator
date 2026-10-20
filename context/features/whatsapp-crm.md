# WhatsApp CRM on /admin/whatsapp (respond.io clone)

## Goal

`/admin/whatsapp` becomes a small respond.io: the admin links the business number by QR (like WhatsApp Web),
sees **all** its chats including the old ones, and each chat is sorted into a **folder**, **tags** and a
**lead stage** automatically from what the customer writes. Replies are made by **Meta AI** on the number
itself; BizzFlow is the CRM around it, with a reply box kept for a human to step in.

## Decisions (user, 2026-10-20)

| Question | Answer |
|---|---|
| Who sorts chats | **Claude applies it** after customer messages; the admin can change anything |
| Old chats on link | **Import past chats** (WhatsApp history sync) |
| Stages / folders / tags | **Admin edits the lists** (add, rename, reorder, delete) |
| Reply box | **Keep it** — Meta AI answers, an admin can still type from BizzFlow |

## Starting point (already on main)

- QR link: `scraper/whatsapp-gateway/server.mjs` (Baileys, pinned), `whatsapp-connection.tsx` shows the QR.
- Gateway posts each message / echo / status to `POST /api/whatsapp/webhook` in Cloud API shape.
- Store: `whatsapp_webhook_events` — **one row per webhook POST**, `message_id` of the first item only.
- Inbox: `buildInbox()` over the **latest 200 events** (`WHATSAPP_EVENT_LIMIT`), 8 s poll.
- `whatsapp_conversations`: `closed_at`, `last_read_at` per `wa_id`.
- Contact panel: matches `orders.mobile` / `wifibizz_cases.mobile` by number.

**Why the store has to change:** history sync delivers thousands of messages, many per batch. A 200-event
window shows a few chats at most, and a batch row keeps only its first message id, so dedupe is impossible.

## Build

### Phase 1 — one row per message

- New `whatsapp_messages`: `message_id` (unique), `wa_id`, `from_me`, `type`, `text`, `media` (json, nullable),
  `status` (sent/delivered/read/failed), `sent_at` (the message's own timestamp, not receive time),
  `source` (`live` | `history` | `bizzflow`). Index `(wa_id, sent_at)`.
- The webhook route writes one row per item, `ON CONFLICT (message_id) DO NOTHING`; a status updates `status`
  (furthest wins, same rule `buildInbox` uses today). `whatsapp_webhook_events` stays as the raw log.
- `whatsapp_conversations` gains `name` (WhatsApp push name / contact name), `last_message_at`,
  `last_inbound_at`, `last_preview`, updated in the same write. The chat list reads this table (paginated,
  newest first); the thread reads `whatsapp_messages` for one `wa_id`. `buildInbox` folds into those two
  queries instead of the 200-event window.
- Backfill: one script copies existing events into `whatsapp_messages`.

### Phase 2 — import past chats

- Gateway handles Baileys `messaging-history.set` (`chats`, `contacts`, `messages`). Convert with the same
  `convert.mjs`, post in batches of ≤100 to the webhook with field `history`, contacts' names included.
- `syncFullHistory` stays **false**: WhatsApp then sends its default recent window, not every message ever.
  Turning it on is one flag if the window proves too short.
- History media is **not downloaded** (1 GB droplet disk); the thread shows "Photo / document — not imported".
- History rows never trigger classification on arrival (see Phase 4 caps).

### Phase 3 — stages, folders, tags (manual first)

- One table `whatsapp_labels`: `kind` (`stage` | `folder` | `tag`), `name`, `description` ("when to use it" —
  this is what Claude reads), `color`, `sort`. Seeded once, all editable:
  - Stages: New → Interested → Docs pending → Order submitted → Installed / Lost
  - Folders: Home Fibre, Business Fibre, Support
  - Tags: Price question, Coverage check, Docs sent, Complaint
- `whatsapp_conversations` gains `stage_id`, `folder_id`, `tag_ids text[]`.
- New **Settings** tab beside Inbox / Raw events: three lists, add / rename / describe / recolour / reorder /
  delete. Deleting a label clears it from every chat in the same write (`array_remove` for tags); it asks first
  and says how many chats use it.
- Chat list: folder chips, stage and tag filters, beside the existing Open / Unread / Closed / All. Each row shows
  name, preview, stage chip and tags.
- Contact panel: stage select, folder select, tag multi-select, plus the existing order/case matches.
- Admin changes are audited (`recordAudit`).

### Phase 4 — Claude sorts the chat

- `GET /api/cron/whatsapp-classify` (every 5 min in `vercel.json`, `CRON_SECRET`, same as retry-sweep). Picks
  chats where `last_inbound_at > classified_at`, newest first, **20 per run**, and only chats with a customer
  message in the **last 30 days** — so importing history does not classify hundreds of dead chats at once.
- Per chat: last 30 messages + the three label lists with their descriptions + the chat's current values →
  Claude with a forced tool call returning `{stage, folder, tags, reason}`. **Only names from the lists** are
  accepted; anything else is dropped, so Claude can never invent a label.
- Model: Haiku 5.5 by default (`WHATSAPP_CRM_MODEL` to override) — this runs on every chatting customer.
- MyKad and other ID numbers are masked before the text leaves BizzFlow, same as the admin assistant.
- **Admin wins:** each of stage / folder / tags records who set it last (`ai` | `admin`). Claude only writes a
  field it set last. The contact panel shows a small "AI" / "Set by admin" marker per field and a "Let AI manage"
  button that hands the field back.
- `classified_at` and `ai_reason` stored on the conversation; the panel shows the reason under the stage
  ("Asked for the RM129 plan price").
- No key or an API error: the chat keeps its labels and is retried next run. Never blocks the inbox.

### Reply box

Unchanged from main: text send through the gateway. Meta AI's replies arrive as the business's own messages
(`from_me`). BizzFlow-sent messages are marked "Sent from BizzFlow" (`source = bizzflow`); everything else from
the business reads "Business".

## Acceptance criteria

- [ ] After a QR scan, past chats appear in the list with names, without anyone opening them on the phone.
- [ ] The list shows every chat, not only those in the latest 200 events, and a re-delivered message is stored once.
- [ ] Admin can add, rename, describe, reorder and delete stages, folders and tags; deleting asks first.
- [ ] Within ~5 min of a customer message, the chat has a stage, folder and tags from the lists, with a reason.
- [ ] A field the admin set is not changed by Claude until "Let AI manage" is pressed.
- [ ] Filters by folder, stage and tag narrow the list; counts match.
- [ ] No ID number reaches the Anthropic request (test).
- [ ] An admin can still reply from BizzFlow.

## Not in scope

Assigning chats to people (one shared admin login), broadcasts, automation/workflow builder, BizzFlow sending AI
replies (Meta AI does that), multiple WhatsApp numbers, groups, sending media, WebSockets (poll stays).

## Risks / unknowns

- **Ban risk** of the unofficial WhatsApp Web protocol — already accepted 2026-10-11; history sync is the same
  protocol.
- **Meta AI + a linked device:** not confirmed that Meta AI's replies reach a linked device as normal
  `from_me` messages, or that Meta AI keeps working while a Baileys device is linked. Check on the first real scan.
- **How far back the default history goes** is WhatsApp's choice and unknown until a real scan.
- **Cost:** one Haiku call per active chat per 5 min at most; the 20-per-run cap bounds a burst.
- Migration is Vercel-applied on build; the gateway change needs a droplet deploy (scraper tag).

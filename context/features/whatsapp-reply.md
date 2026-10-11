# WhatsApp Reply Inbox (respond.io-style) on /admin/whatsapp

## Decision

Route A (user, 2026-10-11): the official WhatsApp Business Platform through 360dialog, number onboarded with
**coexistence**. The QR login is the coexistence onboarding itself: the number's owner scans a QR code with the
WhatsApp Business app during 360dialog's Embedded Signup (360dialog docs: "a QR code scan is required during the
signup process"). The phone app keeps working beside the API. No unofficial WhatsApp Web library (Baileys) — that
breaks WhatsApp's terms and risks a ban on the number.

`github.com/morluto/rea` was reviewed and is not used: it is a reverse-engineering MCP, not a respond.io codebase.
Layout is copied from respond.io's public UI by eye, no code or assets.

## Starting point (already on main)

- `POST /api/whatsapp/webhook` stores 360dialog webhooks in `whatsapp_webhook_events` (signed, PR #55/#56).
- `/admin/whatsapp` → `WhatsappDesk`: read-only Inbox (chats built by `buildInbox` in `src/lib/whatsapp-inbox.ts`,
  8 s poll) and a Raw events view. "Opened" state lives in localStorage.

## Goals

1. Reply from the open chat. Text first.
2. Outside the 24-hour customer-service window the composer offers approved templates only, and says why.
3. Sent messages show in the thread with sent / delivered / read / failed ticks.
4. Open / Closed per chat, unread shared across admins (not per browser), filters Open / Closed / Unread + search.
5. Right-hand panel: the customer's BizzFlow orders and cases matched by phone number.
6. Inbound images and documents viewable in the thread.
7. Every send is audited (`recordAudit`), since the admin login is shared.

## Build

1. **Send.** `src/lib/whatsapp-send.ts`: `POST https://waba-v2.360dialog.io/messages`, header `D360-API-KEY`
   (new env `WHATSAPP_D360_API_KEY`), body in Cloud API shape (`messaging_product: "whatsapp"`, `to`, `type`).
   Admin-gated server action `sendWhatsappMessage(to, text)` / `sendWhatsappTemplate(to, name, lang)`.
   API sends are NOT echoed to the webhook (only `statuses` arrive), so each successful send is written to
   `whatsapp_webhook_events` as a synthetic row (`field: "api_send"`, Cloud API message shape in `raw_body`, the
   returned `wamid` as `message_id`). One table stays the single store; `buildInbox` reads it like an echo.
2. **24-hour window.** Pure `windowClosesAt(chat)` = last inbound + 24 h. Header countdown; composer swaps to a
   template picker when closed. Templates listed from 360dialog (`GET /v1/configs/templates` — confirm the exact
   path against the account at build time), approved ones only, and only those with no `{{variables}}` and
   no media header (we collect no parameters).
3. **Ticks.** `buildInbox` folds `statuses` rows onto the message with the same `wamid`; furthest status wins.
   A `failed` status shows its error title.
4. **Conversation state.** Migration: `whatsapp_conversations` (`wa_id` PK, `closed_at`, `last_read_at`,
   `updated_at`). Closed means `closed_at` is newer than the last customer message, so a new customer message
   reopens the chat with no webhook-side write. Replaces the localStorage "opened" map.
5. **Layout.** Chat list | thread + composer from 768px; the customer panel joins at ≥1280px (the admin sidebar
   leaves too little width below that). On a phone, list → thread as two screens with a back button. Existing
   `Inbox` / `Raw events` toggle kept.
6. **Customer panel.** Normalise the wa_id (`60…`) and match `orders.mobile` and `wifibizz_cases.mobile` in the
   same normalised form; links to `/admin/orders/[id]`. Read-only.
7. **Media.** `GET /api/admin/whatsapp/media?id=` (admin-gated) resolves the media id through 360dialog and
   streams it, so the API key never reaches the browser. Image/PDF only, `nosniff`.

## Not in scope

Assignment (one shared admin identity — nobody to assign to), workflow/automation builder, broadcasts, AI agent,
other channels, reports, roles, sending media, WebSockets (8 s poll stays).

## Needs (user)

- 360dialog API key → Vercel `WHATSAPP_D360_API_KEY`.
- Coexistence onboarding done once on the business number (the QR scan).
- Templates approved in 360dialog / Meta for out-of-window messages.

## Risks

- Preview deployments share the production database: a preview build with the API key set could send real
  messages. The key is set for Production only.
- Template messages are billed per conversation by Meta.
- Contact panel matching depends on how mobile numbers are stored (`+60…`, `01…`, `60…`); normaliser is tested.

# Admin AI Chatbot (testing feature)

Status: **CODE COMPLETE, NOT VERIFIED LIVE** · Branch `claude/gifted-dijkstra-9hfxee` · Vercel-only · **Migration** `20260930120000_admin_chat`

## Goal

A popup assistant on every `/admin` page that answers questions about orders, plans, agents and
failures from BizzFlow's own database, refuses anything else, and hands a question to a human
(**Sofie**, a placeholder) when it cannot or should not answer.

Admin only. Off unless `ADMIN_CHAT_ENABLED=1`.

## Asks (user, 2026-09-30)

1. A popup AI chatbot on the admin page.
2. Ask about order status, order details, the latest plans, etc. from the knowledge base.
3. Stop abuse — only relevant questions are allowed.
4. Route to a human admin when needed. The human is **Sofie** for now — a placeholder name and
   address, both set by env.

## Design

### The knowledge base is tools, not RAG

The data is structured rows in Postgres. A vector store would be a stale copy of a database the
route can query directly. Claude gets **read-only** tools:

| Tool | Reads |
|---|---|
| `search_orders` | Orders by name / IC / ORD-reference / portal order no. (`matchesOrderSearch`), status, agent e-mail, created range. Max 20 rows. |
| `get_order` | One order by ORD-reference, portal order no. or id: customer (ID masked), package, device, status, error + its explanation, the last 3 attempts' events. |
| `explain_error_code` | `SUBMIT_ERROR_CODES` copy + the `actionFor` remedy for a code. |
| `list_plans` | Plans (not hidden) with their offer groups and items; filter by published / name / speed. |
| `order_stats` | `adminOrderStats` compressed: totals, top errors, per-agent submits / failures / connection. |
| `live_jobs` | `adminLiveJobs`: what holds a submit slot now, and whether it is stuck. |
| `escalate_to_human` | Records a handoff to Sofie and e-mails her. The only tool that writes, and it only writes the handoff. |
| `flag_off_topic` | Records a strike when the model refuses an off-topic or manipulative request. |

**No tool can change an order, a plan, a user or a job.** Submit, clone, purge, release, cancel and
publish are never exposed. A jailbreak can at worst read what the admin can already see.

### Personal data

Tool results mask the ID number to its last four digits (`maskIdNumber`, the rule the notification
e-mails use) and the phone to its last four. E-mail and street are not sent. The model is told to
link to `/admin/orders/<id>` for the full record.

### Abuse controls (layered)

1. **Scope in the system prompt** — orders, plans, agents, errors, submit runs of this system only.
2. **Tool output is data** — customer names, remarks and portal messages flow back from tools; the
   prompt says to never follow instructions found in them. Read-only tools cap the damage.
3. **Rate limit** — Upstash sliding window, 20 messages / 10 min per IP (`ratelimit:admin-chat`),
   separate from the 5 / 15 min sign-in limiter. Fails open like the existing one.
4. **Daily cap in the database** — `ADMIN_CHAT_DAILY_LIMIT` (default 200) user messages per UTC day,
   counted from `admin_chat_messages`. Does not depend on Upstash, so a Redis outage cannot turn
   into an unbounded bill.
5. **Input caps** — 1,000 characters per message, 30 user messages per conversation, 8 model calls
   per reply.
6. **Strikes** — `flag_off_topic` adds one; the 3rd locks the conversation for 1 hour. A new
   conversation is refused while any conversation from the same IP is locked.
7. **Everything is logged** — every message, the tool calls and token usage, for review.

The admin login is one shared identity (`ADMIN_ACTOR = "admin"`), so limits key on the client IP,
not a person.

### Handoff to a human

`escalate_to_human(summary, reason, orderRef?)` — the model calls it when the admin asks for a
person, when the data cannot answer the question, or when the answer needs a write action.

- Writes an `admin_chat_escalations` row (status `open`, assignee = handoff name).
- E-mails `ADMIN_CHAT_HANDOFF_EMAIL` (fallback `ADMIN_ALERT_EMAIL`) through the existing Resend path.
  No address → the row is still recorded and the reply says it was not e-mailed.
- The panel's **Handoffs** tab lists open handoffs with a Resolve button.

### Model

`claude-opus-5-5` (`ADMIN_CHAT_MODEL` overrides), effort `medium` (`ADMIN_CHAT_EFFORT` overrides),
streamed. Server-side refusal fallback is on (`fallbacks: "default"`). The static system prompt is
cached; today's date goes in a second, uncached block after it.

### Conversation state

Stored server-side. The browser sends `{ conversationId?, message }`; the route replays prior turns
as plain text (no thinking or tool blocks — nothing to invalidate) and appends the new reply.

## Surfaces

- `AdminShell` — a floating button (bottom-right) that opens a panel: right-side card on desktop,
  full screen on a phone. Tabs: **Chat** / **Handoffs**. Suggested prompts, a live "Looking up…"
  line while tools run, a New chat button, a "testing · read-only" note.
- Answers render a tiny safe markdown subset (paragraphs, bullets, **bold**, links). Links are
  clickable only when they point inside `/admin/`.

## Files

- `prisma/schema.prisma` + migration `20260930120000_admin_chat`
- `src/lib/admin-chat/config.ts` — env, limits, handoff name
- `src/lib/admin-chat/guard.ts` — pure: message validation, strike/lock rules
- `src/lib/admin-chat/prompt.ts` — the system prompt
- `src/lib/admin-chat/tools.ts` — tool definitions + executors
- `src/lib/admin-chat/format.ts` — pure: result shapers (masking, compression)
- `src/lib/admin-chat/markdown.ts` — pure: safe chat markdown tokenizer
- `src/lib/admin-chat/rate-limit.ts` — the chat limiter
- `src/app/api/admin/chat/route.ts` — POST, NDJSON stream
- `src/actions/admin-chat.ts` — handoff list / resolve
- `src/components/admin/admin-chat.tsx` — the popup
- `src/lib/notifications/templates.ts` — `handoffEmail`

## Env

| Variable | Default | |
|---|---|---|
| `ADMIN_CHAT_ENABLED` | off | `1` to show the button and accept requests |
| `ANTHROPIC_API_KEY` | — | required |
| `ADMIN_CHAT_MODEL` | `claude-opus-5-5` | |
| `ADMIN_CHAT_EFFORT` | `medium` | `low` / `medium` / `high` |
| `ADMIN_CHAT_DAILY_LIMIT` | `200` | user messages per UTC day, all admins |
| `ADMIN_CHAT_HANDOFF_NAME` | `Sofie` | placeholder |
| `ADMIN_CHAT_HANDOFF_EMAIL` | `ADMIN_ALERT_EMAIL` | placeholder |

## Not in scope

Opening it to agents (the tools would need owner scoping), write actions, RAG over documents, a
separate classifier call before the main one (add only if the logs show it is needed), voice.

## Acceptance

- [ ] Button shows on every admin page only when enabled; hidden and 404 otherwise
- [ ] "Why did ORD-xxxx fail?" answers from the order's own events and error copy, with a link
- [ ] "What plans are published at 500Mbps?" answers from `plans`
- [ ] An off-topic request is refused and counted; the 3rd locks the chat for an hour
- [ ] Rate limit and daily cap refuse with a readable message
- [ ] "Get a human" creates a handoff to Sofie, e-mails when configured, and shows in Handoffs
- [ ] No tool can mutate orders, plans, users or jobs
- [ ] ID and phone are masked in everything sent to the model

## Verified (2026-09-30)

- 29 new vitest in `src/lib/__tests__/admin-chat.test.ts`: message caps, strike/lock rules, the
  `/admin/`-only link rule (an off-site or `javascript:` link renders as text), IC and phone masking,
  screenshot events dropped from order detail, the tool list pinned to exactly eight names, a source
  check that `tools.ts` writes only the two chat tables, invalid input and unknown tools refused
  without running, the handoff to Sofie (recorded + e-mailed, and recorded-only with no address),
  the 3rd strike locking, the system prompt byte-stable for caching. Full suite 1200 passing (the 4
  failing files are the pre-existing Playwright specs).
- `next build` clean with `/api/admin/chat` in the route list; lint clean on every touched file;
  `tsc` unchanged (3 pre-existing errors). The migration SQL matches `prisma migrate diff` exactly.
- The popup in a browser (Playwright, throwaway preview page, deleted afterwards) against a mocked
  NDJSON stream at 1280 and 375: opens focused on the input, streams text, renders bold / list /
  code, the order link points at `/admin/orders/…`, an `https://` link is plain text, the second
  question carries the conversation id, the handoff line shows "Handed off to Sofie", a 423 lock
  disables the input, Escape closes, no horizontal overflow; full-screen on mobile, 400×600 card on
  desktop. With the flag off, `POST /api/admin/chat` answers 404.

## NOT verified

- **A real model call.** No `ANTHROPIC_API_KEY` or database in the build container, so the tool
  loop, streaming from the API, prompt caching, the refusal fallback and real tool results have
  not run. First live test: set the env on a preview/production deploy and ask about a known order.
- The migration has not been applied anywhere (Vercel's build applies it on deploy).
- The handoff e-mail rendered in a mail client; the Upstash chat limiter against real Redis.

## Follow-up (2026-09-30): the working is visible

The reply now shows its reasoning and lookups above the answer, animated:
- typing dots before anything arrives;
- a timeline of thinking summaries (`thinking.display: "summarized"`) and each lookup, with what it
  asked for and a one-line result chip (counts and statuses only, never a customer row);
- a live header ("Checking plans…", "Running 2 lookups…") that folds to "Worked for 7s · 2 lookups"
  when the answer starts, and can be reopened;
- text the model writes before a tool call moves into the timeline, so the bubble holds only the
  answer (and only that is saved).

Event folding and wording are pure (`stream-state.ts`, `trace.ts`) and tested. Verified in a browser
at 390 px against a delayed mock stream; not yet against the live model.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { mediaOf, messageText, type ChatSummary, type InboxMedia, type InboxMessage, type LabelSetter, type TickStatus } from "@/lib/whatsapp-inbox";

/**
 * One row per WhatsApp message in `whatsapp_messages`, plus the chat summary on
 * `whatsapp_conversations`. Every webhook body (live, history, a BizzFlow send)
 * goes through `ingestWebhook`, so the three can never disagree.
 */

export type MessageSource = "live" | "history" | "bizzflow";

export interface ParsedMessage {
  messageId: string;
  waId: string;
  fromMe: boolean;
  type: string;
  text: string;
  media: InboxMedia | null;
  source: MessageSource;
  sentAt: Date;
}

export interface ParsedStatus {
  id: string;
  status: TickStatus;
  error: string | null;
}

export interface ParsedWebhook {
  messages: ParsedMessage[];
  statuses: ParsedStatus[];
  /** wa_id → display name, from the Cloud API `contacts` block. */
  names: Map<string, string>;
  /** Meta's history-import progress (0-100) carried by this body, or null. */
  historyProgress: number | null;
}

export interface ChatUpdate {
  waId: string;
  name: string | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  preview: string;
  /** History is old news: it counts as read up to its newest customer message. */
  readUpTo: Date | null;
}

const STATUSES: TickStatus[] = ["sent", "delivered", "read", "failed"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sourceOf(field: string | null): MessageSource {
  if (field === "history") return "history";
  if (field === "api_send") return "bizzflow";
  return "live";
}

function pushItems(out: ParsedMessage[], list: unknown, fromMe: boolean, source: MessageSource, receivedAt: Date) {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    const item = asRecord(raw);
    const messageId = asString(item?.id);
    if (!item || !messageId) continue;
    const waId = asString(fromMe ? item.to : item.from);
    const text = messageText(item);
    if (!waId || text === null) continue;
    const stamp = Number(asString(item.timestamp));
    out.push({
      messageId,
      waId,
      fromMe,
      type: asString(item.type) ?? "text",
      text,
      media: fromMe ? null : mediaOf(item) ?? null,
      source,
      sentAt: Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000) : receivedAt,
    });
  }
}

/** Every message, status and contact name in a Cloud-API-shaped body. Pure. */
export function parseWebhook(body: unknown, receivedAt = new Date()): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], names: new Map(), historyProgress: null };
  const root = asRecord(body);
  if (!root || !Array.isArray(root.entry)) return out;
  for (const entry of root.entry) {
    const changes = asRecord(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = asRecord(change);
      const value = asRecord(c?.value) ?? {};
      const source = sourceOf(asString(c?.field));
      pushItems(out.messages, value.messages, false, source, receivedAt);
      pushItems(out.messages, value.message_echoes, true, source, receivedAt);
      // Meta Coexistence history: value.history[].threads[], thread id = the customer's wa_id.
      for (const chunk of Array.isArray(value.history) ? value.history : []) {
        const meta = asRecord(asRecord(chunk)?.metadata);
        const progress = Number(meta?.progress);
        // The business declined sharing (errors, no threads): nothing more will come.
        const declined = Array.isArray(asRecord(chunk)?.errors);
        if (Number.isFinite(progress) || declined) {
          out.historyProgress = Math.max(out.historyProgress ?? 0, declined ? 100 : Math.min(100, Math.max(0, Math.round(progress))));
        }
        const threads = asRecord(chunk)?.threads;
        for (const rawThread of Array.isArray(threads) ? threads : []) {
          const thread = asRecord(rawThread);
          const waId = asString(thread?.id);
          if (!thread || !waId || !Array.isArray(thread.messages)) continue;
          const items = thread.messages.map((m) => asRecord(m)).filter((m): m is Record<string, unknown> => !!m);
          pushItems(out.messages, items.filter((m) => m.from === waId), false, "history", receivedAt);
          pushItems(out.messages, items.filter((m) => m.from !== waId).map((m) => ({ ...m, to: waId })), true, "history", receivedAt);
        }
      }
      // Meta Coexistence contact sync: value.state_sync[] of type "contact".
      for (const raw of Array.isArray(value.state_sync) ? value.state_sync : []) {
        const contact = asRecord(asRecord(raw)?.contact);
        const waId = asString(contact?.phone_number)?.replace(/\D/g, "");
        const name = asString(contact?.full_name)?.trim();
        if (waId && name) out.names.set(waId, name.slice(0, 120));
      }
      if (Array.isArray(value.contacts)) {
        for (const raw of value.contacts) {
          const contact = asRecord(raw);
          const waId = asString(contact?.wa_id);
          const name = asString(asRecord(contact?.profile)?.name)?.trim();
          if (waId && name) out.names.set(waId, name.slice(0, 120));
        }
      }
      if (Array.isArray(value.statuses)) {
        for (const raw of value.statuses) {
          const item = asRecord(raw);
          const id = asString(item?.id);
          const status = STATUSES.find((s) => s === item?.status);
          if (!item || !id || !status) continue;
          const first = Array.isArray(item.errors) ? asRecord(item.errors[0]) : null;
          const error = asString(asRecord(first?.error_data)?.details) ?? asString(first?.message) ?? asString(first?.title);
          out.statuses.push({ id, status, error });
        }
      }
    }
  }
  return out;
}

/** One summary update per chat in the batch. Pure. */
export function chatUpdates(parsed: ParsedWebhook): ChatUpdate[] {
  const byChat = new Map<string, ChatUpdate>();
  for (const m of parsed.messages) {
    const prev = byChat.get(m.waId);
    const inbound = m.fromMe ? null : m.sentAt;
    const readUpTo = m.source === "history" ? inbound : null;
    if (!prev) {
      byChat.set(m.waId, {
        waId: m.waId,
        name: parsed.names.get(m.waId) ?? null,
        lastMessageAt: m.sentAt,
        lastInboundAt: inbound,
        preview: m.text,
        readUpTo,
      });
      continue;
    }
    if (m.sentAt >= prev.lastMessageAt) {
      prev.lastMessageAt = m.sentAt;
      prev.preview = m.text;
    }
    if (inbound && (!prev.lastInboundAt || inbound > prev.lastInboundAt)) prev.lastInboundAt = inbound;
    if (readUpTo && (!prev.readUpTo || readUpTo > prev.readUpTo)) prev.readUpTo = readUpTo;
  }
  return [...byChat.values()];
}

const PREVIEW_MAX = 300;

/** Store a webhook body. Re-delivered messages are kept once; statuses only move forward. */
export async function ingestWebhook(body: unknown): Promise<void> {
  const parsed = parseWebhook(body);
  if (parsed.messages.length > 0) {
    await prisma.whatsappMessage.createMany({
      data: parsed.messages.map((m) => ({
        messageId: m.messageId,
        waId: m.waId,
        fromMe: m.fromMe,
        type: m.type,
        text: m.text,
        media: m.media ? { ...m.media } : Prisma.DbNull,
        source: m.source,
        status: m.source === "bizzflow" ? "sent" : null,
        sentAt: m.sentAt,
      })),
      skipDuplicates: true,
    });
  }
  for (const s of parsed.statuses) {
    await prisma.$executeRaw`
      UPDATE whatsapp_messages SET status = ${s.status}, error = ${s.error}
      WHERE message_id = ${s.id}
        AND COALESCE(array_position(ARRAY['sent','delivered','read','failed'], status), 0)
          < array_position(ARRAY['sent','delivered','read','failed'], ${s.status}::text)`;
  }
  // A live reply typed on the phone (an echo) means a human took over: pause the AI for that chat.
  const humanEchoes = parsed.messages.filter((m) => m.fromMe && m.source === "live");
  for (const m of humanEchoes) {
    await prisma.$executeRaw`
      UPDATE whatsapp_conversations SET ai_enabled = false, ai_paused_reason = 'human', ai_paused_at = now()
      WHERE wa_id = ${m.waId} AND ai_enabled
        AND NOT EXISTS (SELECT 1 FROM whatsapp_messages WHERE message_id = ${m.messageId} AND by_ai)`;
  }
  if (parsed.historyProgress !== null) {
    await prisma.$executeRaw`
      INSERT INTO whatsapp_crm_settings (id, history_progress, history_at, updated_at) VALUES (1, ${parsed.historyProgress}, now(), now())
      ON CONFLICT (id) DO UPDATE SET history_progress = EXCLUDED.history_progress, history_at = now(), updated_at = now()`;
  }
  const updates = chatUpdates(parsed);
  // A name with no message in this body (contact sync). The chat list hides it until a message lands.
  const withMessages = new Set(updates.map((c) => c.waId));
  for (const [waId, name] of parsed.names) {
    if (withMessages.has(waId)) continue;
    await prisma.$executeRaw`
      INSERT INTO whatsapp_conversations (wa_id, name, updated_at) VALUES (${waId}, ${name}, now())
      ON CONFLICT (wa_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`;
  }
  for (const c of updates) {
    await prisma.$executeRaw`
      INSERT INTO whatsapp_conversations (wa_id, name, last_message_at, last_inbound_at, last_preview, last_read_at, updated_at)
      VALUES (${c.waId}, ${c.name}, ${c.lastMessageAt}, ${c.lastInboundAt}, ${c.preview.slice(0, PREVIEW_MAX)}, ${c.readUpTo}, now())
      ON CONFLICT (wa_id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, whatsapp_conversations.name),
        last_preview = CASE
          WHEN whatsapp_conversations.last_message_at IS NULL OR EXCLUDED.last_message_at >= whatsapp_conversations.last_message_at
          THEN EXCLUDED.last_preview ELSE whatsapp_conversations.last_preview END,
        last_message_at = GREATEST(whatsapp_conversations.last_message_at, EXCLUDED.last_message_at),
        last_inbound_at = GREATEST(whatsapp_conversations.last_inbound_at, EXCLUDED.last_inbound_at),
        last_read_at = GREATEST(whatsapp_conversations.last_read_at, EXCLUDED.last_read_at),
        updated_at = now()`;
  }
}

let backfilled = false;

/**
 * Messages that arrived before whatsapp_messages existed live only in the raw
 * event log. Copied over once, the first time the inbox is read with an empty
 * table. Idempotent: rows are keyed on the WhatsApp message id.
 */
export async function backfillFromEvents(): Promise<void> {
  if (backfilled) return;
  const any = await prisma.whatsappMessage.findFirst({ select: { messageId: true } });
  if (!any) {
    let cursor: string | undefined;
    for (;;) {
      const rows = await prisma.whatsappWebhookEvent.findMany({
        orderBy: { id: "asc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, rawBody: true },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          await ingestWebhook(JSON.parse(row.rawBody));
        } catch {
          // A body that is not JSON was never a message.
        }
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  backfilled = true;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function setter(value: string | null): LabelSetter | null {
  return value === "ai" || value === "admin" ? value : null;
}

interface SummaryRow {
  wa_id: string;
  name: string | null;
  named_by_admin: boolean;
  last_message_at: Date;
  last_inbound_at: Date | null;
  last_preview: string | null;
  closed_at: Date | null;
  last_read_at: Date | null;
  stage_id: string | null;
  folder_id: string | null;
  tag_ids: string[] | null;
  stage_by: string | null;
  folder_by: string | null;
  tags_by: string | null;
  ai_reason: string | null;
  intent: string | null;
  signup_chance: number | null;
  insight_by: string | null;
  ai_enabled: boolean | null;
  ai_paused_reason: string | null;
  unread: number;
}

export const CHAT_LIST_LIMIT = 500;

/** Newest chats first. `q` matches the number, the name, or any message text. */
export async function listChatSummaries(q = ""): Promise<ChatSummary[]> {
  const query = q.trim();
  const like = likePattern(query);
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT c.wa_id, COALESCE(c.display_name, c.name) AS name, c.display_name IS NOT NULL AS named_by_admin, c.last_message_at, c.last_inbound_at, c.last_preview, c.closed_at, c.last_read_at,
           c.stage_id, c.folder_id, c.tag_ids, c.stage_by, c.folder_by, c.tags_by, c.ai_reason, c.intent, c.signup_chance, c.insight_by, c.ai_enabled, c.ai_paused_reason,
           (SELECT count(*)::int FROM whatsapp_messages m
             WHERE m.wa_id = c.wa_id AND NOT m.from_me
               AND (c.last_read_at IS NULL OR m.sent_at > c.last_read_at)) AS unread
    FROM whatsapp_conversations c
    WHERE c.last_message_at IS NOT NULL
      AND (${query} = '' OR c.wa_id ILIKE ${like} OR c.name ILIKE ${like} OR c.display_name ILIKE ${like}
           OR EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.wa_id = c.wa_id AND m.text ILIKE ${like}))
    ORDER BY c.last_message_at DESC
    LIMIT ${CHAT_LIST_LIMIT}`;
  return rows.map((r) => ({
    customer: r.wa_id,
    name: r.name,
    namedByAdmin: r.named_by_admin,
    lastAt: r.last_message_at.toISOString(),
    preview: r.last_preview ?? "",
    lastInboundAt: r.last_inbound_at?.toISOString() ?? null,
    unread: r.unread,
    closedAt: r.closed_at?.toISOString() ?? null,
    lastReadAt: r.last_read_at?.toISOString() ?? null,
    stageId: r.stage_id,
    folderId: r.folder_id,
    tagIds: r.tag_ids ?? [],
    stageBy: setter(r.stage_by),
    folderBy: setter(r.folder_by),
    tagsBy: setter(r.tags_by),
    aiReason: r.ai_reason,
    intent: r.intent,
    signupChance: r.signup_chance,
    insightBy: setter(r.insight_by),
    aiEnabled: r.ai_enabled ?? true,
    aiPausedReason: r.ai_paused_reason,
  }));
}

export const THREAD_LIMIT = 300;

/** The latest messages of one chat, oldest first. */
export async function listThread(waId: string, limit = THREAD_LIMIT): Promise<InboxMessage[]> {
  const rows = await prisma.whatsappMessage.findMany({
    where: { waId },
    orderBy: { sentAt: "desc" },
    take: limit,
  });
  return rows.reverse().map((r) => {
    const media = r.media as InboxMedia | null;
    const status = STATUSES.find((s) => s === r.status);
    return {
      id: r.messageId,
      side: r.fromMe ? "echo" : "inbound",
      at: r.sentAt.toISOString(),
      text: r.text,
      ...(r.source === "bizzflow" ? { fromBizzflow: true } : {}),
      ...(r.byAi ? { byAi: true } : {}),
      ...(media ? { media } : {}),
      ...(status ? { status } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
  });
}

/** A stored webhook row. Only the fields the inbox reads. */
export interface InboxEvent {
  id: string;
  receivedAt: string;
  rawBody: string;
}

export type InboxSide = "inbound" | "echo";

/** Delivery state of a business message, from the `statuses` webhooks. */
export type TickStatus = "sent" | "delivered" | "read" | "failed";

/** An inbound attachment the admin media proxy can fetch. */
export interface InboxMedia {
  id: string;
  kind: "image" | "document" | "audio";
  mime: string | null;
}

export interface InboxMessage {
  id: string;
  side: InboxSide;
  /** Business messages typed in BizzFlow (vs the phone or Meta AI). */
  fromBizzflow?: boolean;
  /** Written and sent by the Claude auto-reply. */
  byAi?: boolean;
  at: string;
  text: string;
  /** Business messages only, once a status webhook names them. */
  status?: TickStatus;
  /** The portal's reason when status is failed. */
  error?: string;
  media?: InboxMedia;
}

export interface InboxChat {
  customer: string;
  /** Oldest first. */
  messages: InboxMessage[];
  lastAt: string;
  preview: string;
  /** Newest customer message. A closed chat reopens when this is newer. */
  lastInboundAt: string | null;
}

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker", "location"]);

interface Draft extends InboxMessage {
  customer: string;
  messageId: string;
  /** Set only when WhatsApp gave the message an id; used to drop repeats. */
  dedupeKey: string | null;
  atMs: number;
  receivedMs: number;
  index: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function titleType(type: string): string {
  return type.slice(0, 1).toUpperCase() + type.slice(1);
}

/** Full text, or a type label plus caption and filename. Never the 160-char preview. */
export function messageText(item: Record<string, unknown>): string | null {
  const type = asString(item.type);
  const text = asString(asRecord(item.text)?.body);
  if (type === "text") return text ?? "";
  if (!type) return text;

  if (!MEDIA_TYPES.has(type) && text) return text;

  const block = asRecord(item[type]);
  const parts = [
    asString(block?.filename),
    asString(block?.caption),
    asString(block?.name),
    asString(block?.address),
  ].filter((part): part is string => part !== null);
  const label = titleType(type);
  return parts.length > 0 ? `${label} · ${parts.join(" · ")}` : label;
}

/** Images (and stickers) render inline, audio plays inline; documents open in a new tab. */
export function mediaOf(item: Record<string, unknown>): InboxMedia | undefined {
  const type = asString(item.type);
  const kind =
    type === "image" || type === "sticker" ? "image" : type === "document" ? "document" : type === "audio" ? "audio" : null;
  if (!kind || !type) return undefined;
  const block = asRecord(item[type]);
  const id = asString(block?.id);
  if (!id) return undefined;
  return { id, kind, mime: asString(block?.mime_type) };
}

export const TICK_RANK: Record<TickStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

interface Tick {
  status: TickStatus;
  error?: string;
}

/** Furthest status per message id. Webhooks can arrive out of order. */
function collectTicks(ticks: Map<string, Tick>, list: unknown) {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    const item = asRecord(raw);
    const id = asString(item?.id);
    const status = asString(item?.status);
    if (!item || !id || !status || !(status in TICK_RANK)) continue;
    const next = status as TickStatus;
    const prev = ticks.get(id);
    if (prev && TICK_RANK[prev.status] >= TICK_RANK[next]) continue;
    const first = Array.isArray(item.errors) ? asRecord(item.errors[0]) : null;
    const error = asString(asRecord(first?.error_data)?.details) ?? asString(first?.message) ?? asString(first?.title);
    ticks.set(id, error ? { status: next, error } : { status: next });
  }
}

function pushList(
  out: Draft[],
  event: InboxEvent,
  receivedMs: number,
  list: unknown,
  side: InboxSide,
  customerField: "from" | "to",
  index: number,
): number {
  if (!Array.isArray(list)) return index;
  for (const raw of list) {
    index += 1;
    const item = asRecord(raw);
    if (!item) continue;
    const customer = asString(item[customerField]);
    const text = messageText(item);
    if (!customer || text === null) continue;
    const stamp = asString(item.timestamp);
    const stamped = stamp !== null ? Number(stamp) * 1000 : NaN;
    const atMs = Number.isFinite(stamped) ? stamped : receivedMs;
    const realId = asString(item.id);
    const messageId = realId ?? String(index);
    const media = side === "inbound" ? mediaOf(item) : undefined;
    out.push({
      id: `${event.id}:${messageId}`,
      customer,
      messageId,
      dedupeKey: realId ? `${side}:${realId}` : null,
      side,
      at: new Date(atMs).toISOString(),
      text,
      ...(media ? { media } : {}),
      atMs,
      receivedMs,
      index,
    });
  }
  return index;
}

/**
 * One chat per customer number. Inbound messages key on `from`. Business
 * echoes key on `to`. Status rows are not bubbles: they become ticks on the
 * business message with the same id. Replies sent from BizzFlow are stored by
 * `appendApiSend` as `message_echoes`, so they read like phone-app echoes.
 *
 * ponytail: history threads stay in the raw event list. Bubbles come only
 * from `messages` and `message_echoes`.
 */
export function buildInbox(events: InboxEvent[]): InboxChat[] {
  const drafts: Draft[] = [];
  const ticks = new Map<string, Tick>();
  for (const event of events) {
    const parsedMs = Date.parse(event.receivedAt);
    const receivedMs = Number.isFinite(parsedMs) ? parsedMs : 0;
    let body: unknown;
    try {
      body = JSON.parse(event.rawBody);
    } catch {
      continue;
    }
    const root = asRecord(body);
    if (!root || !Array.isArray(root.entry)) continue;
    let index = 0;
    for (const entry of root.entry) {
      const record = asRecord(entry);
      if (!record || !Array.isArray(record.changes)) continue;
      for (const change of record.changes) {
        const value = asRecord(asRecord(change)?.value) ?? {};
        index = pushList(drafts, event, receivedMs, value.messages, "inbound", "from", index);
        index = pushList(drafts, event, receivedMs, value.message_echoes, "echo", "to", index);
        collectTicks(ticks, value.statuses);
      }
    }
  }

  // The same message can be stored twice (a webhook retried after it had already
  // landed, or re-sent on reconnect). One bubble per WhatsApp message id.
  const seen = new Set<string>();
  const byCustomer = new Map<string, Draft[]>();
  for (const draft of drafts) {
    if (draft.dedupeKey) {
      if (seen.has(draft.dedupeKey)) continue;
      seen.add(draft.dedupeKey);
    }
    const list = byCustomer.get(draft.customer);
    if (list) list.push(draft);
    else byCustomer.set(draft.customer, [draft]);
  }

  const chats: InboxChat[] = [];
  for (const [customer, items] of byCustomer) {
    items.sort((a, b) => a.atMs - b.atMs || a.receivedMs - b.receivedMs || a.index - b.index);
    const last = items[items.length - 1];
    const lastInbound = items.findLast((item) => item.side === "inbound");
    chats.push({
      customer,
      messages: items.map(({ id, side, at, text, media, messageId }) => {
        const tick = side === "echo" ? ticks.get(messageId) : undefined;
        return { id, side, at, text, ...(media ? { media } : {}), ...(tick ?? {}) };
      }),
      lastAt: last.at,
      preview: last.text,
      lastInboundAt: lastInbound?.at ?? null,
    });
  }
  chats.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.customer.localeCompare(b.customer));
  return chats;
}

/** Messages strictly newer than the admin's last open. Null means never opened. */
export function unreadCount(messages: { at: string }[], openedAt: string | null): number {
  if (openedAt === null) return messages.length;
  const opened = Date.parse(openedAt);
  if (Number.isNaN(opened)) return messages.length;
  return messages.reduce((count, message) => count + (Date.parse(message.at) > opened ? 1 : 0), 0);
}

/** Stamp a viewing so every message currently on screen counts as seen. */
export function openedAtAfterViewing(messages: { at: string }[], nowIso: string): string {
  let max = Date.parse(nowIso);
  if (Number.isNaN(max)) max = 0;
  for (const message of messages) {
    const at = Date.parse(message.at);
    if (at > max) max = at;
  }
  return new Date(max).toISOString();
}

export function filterInbox(chats: InboxChat[], query: string): InboxChat[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return chats;
  return chats.filter((chat) =>
    chat.customer.toLowerCase().includes(needle) ||
    chat.messages.some((message) => message.text.toLowerCase().includes(needle)),
  );
}

/** A newer customer message reopens a closed chat. */
export function isClosed(lastInboundAt: string | null, closedAt: string | null | undefined): boolean {
  if (!closedAt) return false;
  if (!lastInboundAt) return true;
  return Date.parse(closedAt) >= Date.parse(lastInboundAt);
}

export type InboxTab = "open" | "unread" | "closed" | "all";

export interface ConversationState {
  closedAt: string | null;
  lastReadAt: string | null;
}

/** Customer messages newer than the shared last read. */
export function unreadFor(chat: InboxChat, state: ConversationState | undefined): number {
  return unreadCount(chat.messages.filter((m) => m.side === "inbound"), state?.lastReadAt ?? null);
}

export function chatInTab(chat: InboxChat, state: ConversationState | undefined, tab: InboxTab): boolean {
  const closed = isClosed(chat.lastInboundAt, state?.closedAt);
  if (tab === "open") return !closed;
  if (tab === "closed") return closed;
  if (tab === "unread") return unreadFor(chat, state) > 0;
  return true;
}

/**
 * The ways a customer's number can be stored on an order or a case: a wa_id
 * `60123456789` may sit as `123456789`, `0123456789`, `60123456789` or
 * `+60123456789`.
 *
 * ponytail: exact matches only. A number stored with spaces or dashes is missed;
 * normalise the columns if that turns up.
 */
export function phoneVariants(waId: string): string[] {
  const digits = waId.replace(/\D/g, "");
  if (!digits) return [];
  const out = new Set([digits, `+${digits}`]);
  if (digits.startsWith("60") && digits.length > 2) {
    const national = digits.slice(2);
    out.add(national);
    out.add(`0${national}`);
  }
  return [...out];
}


/** One row of the chat list. The thread is fetched separately. */
export interface ChatSummary {
  customer: string;
  name: string | null;
  /** The name was typed by an admin (it wins over the WhatsApp profile name). */
  namedByAdmin?: boolean;
  lastAt: string;
  preview: string;
  lastInboundAt: string | null;
  /** Newest customer message that arrived live (not history): what Meta's 24h window counts. */
  liveInboundAt?: string | null;
  /** Customer messages newer than the shared last read. */
  unread: number;
  closedAt: string | null;
  lastReadAt: string | null;
  stageId: string | null;
  folderId: string | null;
  tagIds: string[];
  stageBy: LabelSetter | null;
  folderBy: LabelSetter | null;
  tagsBy: LabelSetter | null;
  aiReason: string | null;
  /** Claude's one-line read of what the customer wants. */
  intent: string | null;
  /** 0-100, Claude's guess that this chat signs up. */
  signupChance: number | null;
  insightBy: LabelSetter | null;
  /** Claude auto-reply for this chat (Dualhook). Missing = on. */
  aiEnabled?: boolean;
  /** Why it is off: "human" (a person replied), "documents" (handed off), "admin". */
  aiPausedReason?: string | null;
}

export type LabelSetter = "ai" | "admin";
export type LabelKind = "stage" | "folder" | "tag";

export interface Label {
  id: string;
  kind: LabelKind;
  name: string;
  description: string;
  color: string;
  sort: number;
}

/** Palette for label chips. Unknown names fall back to gray. */
export const LABEL_COLORS: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  violet: "bg-violet-100 text-violet-700",
  pink: "bg-pink-100 text-pink-700",
  teal: "bg-teal-100 text-teal-700",
};

export function summaryInTab(chat: ChatSummary, tab: InboxTab): boolean {
  const closed = isClosed(chat.lastInboundAt, chat.closedAt);
  if (tab === "open") return !closed;
  if (tab === "closed") return closed;
  if (tab === "unread") return chat.unread > 0;
  return true;
}

export interface ChatFilter {
  folderId: string | null;
  stageId: string | null;
  tagId: string | null;
}

export function matchesFilter(chat: ChatSummary, filter: ChatFilter): boolean {
  if (filter.folderId && chat.folderId !== filter.folderId) return false;
  if (filter.stageId && chat.stageId !== filter.stageId) return false;
  if (filter.tagId && !chat.tagIds.includes(filter.tagId)) return false;
  return true;
}

/** A real contact name, or null. WhatsApp hands out "+60·······98" for a hidden number; that is no name. */
export function contactName(name: string | null | undefined): string | null {
  const clean = name?.trim();
  return clean && /\p{L}/u.test(clean) ? clean : null;
}

/** Meta stops sending chunks once done; a sync silent this long has stalled or finished without a 100. */
export const HISTORY_STALE_MS = 30 * 60_000;

/** The Coexistence history import is still running: under 100% and a chunk arrived recently. */
export function historyLoading(history: { progress: number; at: string } | null, now = Date.now()): boolean {
  return !!history && history.progress < 100 && now - Date.parse(history.at) < HISTORY_STALE_MS;
}

/** A stable colour slot (0-5) per contact, so the same customer keeps the same avatar colour. */
export function avatarTone(waId: string): number {
  let hash = 0;
  for (const ch of waId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 6;
}

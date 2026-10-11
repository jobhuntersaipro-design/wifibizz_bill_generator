/** A stored webhook row. Only the fields the inbox reads. */
export interface InboxEvent {
  id: string;
  receivedAt: string;
  rawBody: string;
}

export type InboxSide = "inbound" | "echo";

export interface InboxMessage {
  id: string;
  side: InboxSide;
  at: string;
  text: string;
}

export interface InboxChat {
  customer: string;
  /** Oldest first. */
  messages: InboxMessage[];
  lastAt: string;
  preview: string;
}

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker", "location"]);

interface Draft extends InboxMessage {
  customer: string;
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
function messageText(item: Record<string, unknown>): string | null {
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
    const messageId = asString(item.id) ?? String(index);
    out.push({
      id: `${event.id}:${messageId}`,
      customer,
      side,
      at: new Date(atMs).toISOString(),
      text,
      atMs,
      receivedMs,
      index,
    });
  }
  return index;
}

/**
 * One chat per customer number. Inbound messages key on `from`. Business
 * echoes key on `to`. Status rows are not bubbles.
 *
 * ponytail: history threads stay in the raw event list. Bubbles come only
 * from `messages` and `message_echoes`.
 */
export function buildInbox(events: InboxEvent[]): InboxChat[] {
  const drafts: Draft[] = [];
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
      }
    }
  }

  const byCustomer = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const list = byCustomer.get(draft.customer);
    if (list) list.push(draft);
    else byCustomer.set(draft.customer, [draft]);
  }

  const chats: InboxChat[] = [];
  for (const [customer, items] of byCustomer) {
    items.sort((a, b) => a.atMs - b.atMs || a.receivedMs - b.receivedMs || a.index - b.index);
    const last = items[items.length - 1];
    chats.push({
      customer,
      messages: items.map(({ id, side, at, text }) => ({ id, side, at, text })),
      lastAt: last.at,
      preview: last.text,
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

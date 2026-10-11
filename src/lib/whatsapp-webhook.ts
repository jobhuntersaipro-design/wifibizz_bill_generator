import { createHmac, timingSafeEqual } from "node:crypto";

/** Short enough for a table cell. The full text stays in raw_body. */
const PREVIEW_MAX = 160;

export interface WhatsappExtract {
  field: string | null;
  fromWaId: string | null;
  toWaId: string | null;
  messageId: string | null;
  messageType: string | null;
  textPreview: string | null;
}

const EMPTY: WhatsappExtract = {
  field: null,
  fromWaId: null,
  toWaId: null,
  messageId: null,
  messageType: null,
  textPreview: null,
};

const DIRECTION: Record<string, string> = {
  messages: "Inbound",
  smb_message_echoes: "Echo",
  statuses: "Status",
  history: "History",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Meta's X-Hub-Signature-256: `sha256=` + HMAC-SHA256 of the raw body. */
export function signatureOk(raw: Uint8Array, header: string | null, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqual(expected, header ?? "");
}

function headerMatches(expected: string, header: string | null): boolean {
  if (!header) return false;
  return safeEqual(header, expected);
}

/**
 * POST gate. When both secrets are set, either check is enough: a matching
 * `X-Webhook-Secret` or `D360-Webhook-Secret` header, or a valid
 * `X-Hub-Signature-256`. 360dialog sends the header, not Meta's signature.
 * Production with neither secret configured rejects the body. Other
 * environments still accept it so local dev can post samples unsigned.
 */
export function authorizeWhatsappPost(input: {
  vercelEnv: string | undefined;
  webhookSecret: string | undefined;
  appSecret: string | undefined;
  webhookHeader: string | null;
  d360Header: string | null;
  hubSignature: string | null;
  raw: Uint8Array;
}): { ok: true } | { ok: false; status: 401 | 403 } {
  const webhook = (input.webhookSecret ?? "").trim();
  const app = input.appSecret ?? "";
  const hasWebhook = webhook.length > 0;
  const hasApp = app.length > 0;

  if (hasWebhook && (headerMatches(webhook, input.webhookHeader) || headerMatches(webhook, input.d360Header))) {
    return { ok: true };
  }
  if (hasApp && signatureOk(input.raw, input.hubSignature, app)) return { ok: true };
  if (!hasWebhook && !hasApp) {
    return input.vercelEnv === "production" ? { ok: false, status: 401 } : { ok: true };
  }
  return { ok: false, status: hasApp && !hasWebhook ? 403 : 401 };
}

/**
 * GET verification. The challenge is returned as plain text only when mode,
 * token, and challenge are all present and the token matches.
 */
export function verifyChallenge(
  params: URLSearchParams,
  expectedToken: string | undefined,
): { ok: true; challenge: string } | { ok: false } {
  const expected = (expectedToken ?? "").trim();
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (
    params.get("hub.mode") === "subscribe" &&
    expected &&
    token &&
    challenge &&
    safeEqual(token, expected)
  ) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

export function directionLabel(field: string | null): string {
  if (!field) return "Unknown";
  const first = field.split("+")[0] ?? "";
  return DIRECTION[first] ?? first;
}

/** Asia/Kuala_Lumpur has no DST, so server and browser format the same instant. */
export function formatKualaLumpur(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function previewOf(item: Record<string, unknown>): string | null {
  const text = asString(asRecord(item.text)?.body);
  if (text) return text.slice(0, PREVIEW_MAX);
  for (const key of ["image", "video", "document"]) {
    const caption = asString(asRecord(item[key])?.caption);
    if (caption) return caption.slice(0, PREVIEW_MAX);
  }
  const button = asString(asRecord(item.button)?.text);
  if (button) return button.slice(0, PREVIEW_MAX);
  const status = asString(item.status);
  if (status) return status.slice(0, PREVIEW_MAX);
  return null;
}

function firstItem(value: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["messages", "message_echoes", "statuses"]) {
    const list = value[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    const item = asRecord(list[0]);
    if (item) return item;
  }
  return null;
}

/**
 * ponytail: one row per POST. A payload with several messages keeps the first
 * message's from/to/id/preview; the rest stay in raw_body. Split rows if the
 * admin list needs one line per message.
 */
export function extractWhatsappEvent(body: unknown): WhatsappExtract {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.entry)) return { ...EMPTY };

  const changes: { field: string | null; value: Record<string, unknown> }[] = [];
  for (const entry of root.entry) {
    const record = asRecord(entry);
    if (!record || !Array.isArray(record.changes)) continue;
    for (const change of record.changes) {
      const item = asRecord(change);
      if (!item) continue;
      changes.push({ field: asString(item.field), value: asRecord(item.value) ?? {} });
    }
  }

  const fields = [...new Set(changes.map((c) => c.field).filter((f): f is string => !!f))];
  const field = fields.length > 0 ? fields.join("+") : null;

  for (const change of changes) {
    const item = firstItem(change.value);
    if (!item) continue;
    return {
      field,
      fromWaId: asString(item.from),
      toWaId: asString(item.to) ?? asString(item.recipient_id),
      messageId: asString(item.id),
      messageType: asString(item.type) ?? (change.field === "statuses" ? asString(item.status) : null),
      textPreview: previewOf(item),
    };
  }

  return { ...EMPTY, field };
}

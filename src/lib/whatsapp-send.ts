/**
 * 360dialog (WhatsApp Cloud API) client for the admin inbox. Server only: the
 * API key never leaves this module.
 */

const D360_BASE = "https://waba-v2.360dialog.io";
const TIMEOUT_MS = 15_000;

export type SendResult = { ok: true; wamid: string } | { ok: false; error: string };

export interface TemplateView {
  name: string;
  language: string;
  category: string | null;
  /** The body as the customer will read it. */
  body: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function d360Key(): string | null {
  const key = (process.env.WHATSAPP_D360_API_KEY ?? "").trim();
  return key || null;
}

/**
 * Preview deployments share the production database and usually the
 * production env, so a preview build must never message a real customer.
 */
export function sendRefusal(vercelEnv: string | undefined, key: string | null): string | null {
  if (vercelEnv === "preview") return "Sending is disabled on preview deployments.";
  if (!key) return "WhatsApp sending is not set up (WHATSAPP_D360_API_KEY is missing).";
  return null;
}

/** The Cloud API's own sentence, e.g. the 24-hour re-engagement refusal. */
export function apiError(body: unknown, status: number): string {
  const error = asRecord(asRecord(body)?.error);
  const details = asString(asRecord(error?.error_data)?.details);
  const message = asString(error?.message) ?? asString(asRecord(body)?.message);
  return details ?? message ?? `WhatsApp API answered ${status}.`;
}

async function d360(path: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(`${D360_BASE}${path}`, {
    ...init,
    headers: { "D360-API-KEY": key, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function postMessage(key: string, payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await d360("/messages", key, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: apiError(body, res.status) };
    const messages = asRecord(body)?.messages;
    const wamid = Array.isArray(messages) ? asString(asRecord(messages[0])?.id) : null;
    if (!wamid) return { ok: false, error: "WhatsApp accepted the request but returned no message id." };
    return { ok: true, wamid };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "WhatsApp API timed out." : "Could not reach the WhatsApp API." };
  }
}

export function sendText(key: string, to: string, text: string): Promise<SendResult> {
  return postMessage(key, { to, type: "text", text: { body: text, preview_url: false } });
}

export function sendTemplate(key: string, to: string, name: string, language: string): Promise<SendResult> {
  return postMessage(key, { to, type: "template", template: { name, language: { code: language } } });
}

/**
 * Approved templates that can be sent with no parameters.
 *
 * ponytail: a template with {{variables}} or a media header needs values we do
 * not collect, so it is left out. Add a parameter form if those are needed.
 */
export function usableTemplates(body: unknown): TemplateView[] {
  const root = asRecord(body);
  const list = root?.waba_templates ?? root?.data;
  if (!Array.isArray(list)) return [];
  const out: TemplateView[] = [];
  for (const raw of list) {
    const t = asRecord(raw);
    const name = asString(t?.name);
    const language = asString(t?.language);
    if (!t || !name || !language || asString(t.status)?.toLowerCase() !== "approved") continue;
    const components = Array.isArray(t.components) ? t.components.map(asRecord) : [];
    let body = "";
    let usable = true;
    for (const c of components) {
      if (!c) continue;
      const type = asString(c.type)?.toUpperCase();
      const text = asString(c.text) ?? "";
      if (/\{\{/.test(text) || JSON.stringify(c.buttons ?? []).includes("{{")) usable = false;
      if (type === "HEADER" && (asString(c.format)?.toUpperCase() ?? "TEXT") !== "TEXT") usable = false;
      if (type === "BODY") body = text;
    }
    if (usable) out.push({ name, language, category: asString(t.category), body });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTemplates(key: string): Promise<{ ok: true; templates: TemplateView[] } | { ok: false; error: string }> {
  try {
    const res = await d360("/v1/configs/templates?limit=1000", key);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: apiError(body, res.status) };
    return { ok: true, templates: usableTemplates(body) };
  } catch {
    return { ok: false, error: "Could not load templates." };
  }
}

/** Only what the inbox renders. The type decides the response header, never the upstream one. */
export const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Two hops: the media id resolves to a lookaside.fbsbx.com URL, which 360dialog
 * serves on its own host with the same key.
 */
export async function fetchMedia(key: string, mediaId: string): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; status: number }> {
  try {
    const meta = await d360(`/${encodeURIComponent(mediaId)}`, key);
    if (!meta.ok) return { ok: false, status: meta.status === 404 ? 404 : 502 };
    const info = asRecord(await meta.json().catch(() => null));
    const url = asString(info?.url);
    const mime = asString(info?.mime_type)?.split(";")[0].trim().toLowerCase() ?? "";
    if (!url || !MEDIA_TYPES.has(mime)) return { ok: false, status: 415 };
    const parsed = new URL(url);
    if (parsed.hostname !== "lookaside.fbsbx.com") return { ok: false, status: 502 };
    const file = await d360(`${parsed.pathname}${parsed.search}`, key);
    if (!file.ok) return { ok: false, status: 502 };
    return { ok: true, bytes: await file.arrayBuffer(), mime };
  } catch {
    return { ok: false, status: 502 };
  }
}

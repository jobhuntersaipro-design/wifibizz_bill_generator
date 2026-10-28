/**
 * Client for the Dualhook Runtime API (Meta Coexistence). Same JSON as the Meta
 * Cloud API, sent to api.dualhook.com with the account's live key. Server only.
 */

import { fetchMedia, gatewayConfig, MEDIA_TYPES, type SendResult } from "@/lib/whatsapp-send";

export { SEND_WINDOW_MS, windowOpen, WINDOW_CLOSED_MESSAGE } from "@/lib/dualhook-window";

const TIMEOUT_MS = 15_000;
const DEFAULT_BASE = "https://api.dualhook.com/v25.0";

export interface DualhookConfig {
  base: string;
  key: string;
  phoneNumberId: string;
}

export function dualhookConfig(): DualhookConfig | null {
  const key = (process.env.DUALHOOK_API_KEY ?? "").trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const base = (process.env.DUALHOOK_API_URL ?? "").trim().replace(/\/+$/, "") || DEFAULT_BASE;
  return key && phoneNumberId ? { base, key, phoneNumberId } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function call(config: DualhookConfig, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${config.base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

export async function dualhookSendText(config: DualhookConfig, to: string, text: string): Promise<SendResult> {
  try {
    const res = await call(config, `/${encodeURIComponent(config.phoneNumberId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }),
    });
    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) {
      const message = asRecord(body?.error)?.message;
      return { ok: false, error: typeof message === "string" && message ? message : `Dualhook answered ${res.status}.` };
    }
    const first = Array.isArray(body?.messages) ? asRecord(body.messages[0]) : null;
    const id = typeof first?.id === "string" ? first.id : null;
    return id ? { ok: true, wamid: id } : { ok: false, error: "Dualhook did not return a message id." };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "Dualhook timed out." : "Could not reach Dualhook." };
  }
}

/** Media by its WhatsApp media id (`GET /<id>/content`), never by the webhook's url. */
export async function dualhookMedia(
  config: DualhookConfig,
  mediaId: string,
): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; status: number }> {
  try {
    const res = await call(config, `/${encodeURIComponent(mediaId)}/content`);
    if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502 };
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!MEDIA_TYPES.has(mime)) return { ok: false, status: 415 };
    return { ok: true, bytes: await res.arrayBuffer(), mime };
  } catch {
    return { ok: false, status: 502 };
  }
}

/** Media through whichever transport is set up: Dualhook first, else the QR gateway. */
export async function fetchWhatsappMedia(mediaId: string): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; status: number }> {
  const dualhook = dualhookConfig();
  if (dualhook) return dualhookMedia(dualhook, mediaId);
  const gateway = gatewayConfig();
  return gateway ? fetchMedia(gateway, mediaId) : { ok: false, status: 503 };
}

/**
 * Client for the WhatsApp gateway on the droplet (scraper/whatsapp-gateway):
 * one WhatsApp number linked as a device by QR scan. Server only — the token
 * never leaves this module.
 */

const TIMEOUT_MS = 15_000;

export type SendResult = { ok: true; wamid: string } | { ok: false; error: string };

export type GatewayStatus = "starting" | "qr" | "qr_expired" | "open" | "reconnecting" | "logged_out";

export interface GatewayState {
  status: GatewayStatus;
  /** PNG data URL while a QR is waiting to be scanned. */
  qr: string | null;
  /** The linked number, once connected. */
  me: string | null;
  error: string | null;
}

export interface GatewayConfig {
  url: string;
  token: string;
}

export function gatewayConfig(): GatewayConfig | null {
  const url = (process.env.WHATSAPP_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.WHATSAPP_GATEWAY_TOKEN ?? "").trim();
  return url && token ? { url, token } : null;
}

/**
 * Preview deployments share the production database and usually the
 * production env, so a preview build must never message a real customer.
 */
export function sendRefusal(vercelEnv: string | undefined, config: GatewayConfig | null): string | null {
  if (vercelEnv === "preview") return "Sending is disabled on preview deployments.";
  if (!config) return "WhatsApp is not set up (WHATSAPP_GATEWAY_URL / WHATSAPP_GATEWAY_TOKEN are missing).";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function call(config: GatewayConfig, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${config.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

function unreachable(e: unknown): string {
  return e instanceof Error && e.name === "TimeoutError" ? "The WhatsApp gateway timed out." : "Could not reach the WhatsApp gateway.";
}

export async function sendText(config: GatewayConfig, to: string, text: string): Promise<SendResult> {
  try {
    const res = await call(config, "/send", { method: "POST", body: JSON.stringify({ to, text }) });
    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) return { ok: false, error: asString(body?.error) ?? `WhatsApp gateway answered ${res.status}.` };
    const id = asString(body?.id);
    return id ? { ok: true, wamid: id } : { ok: false, error: "WhatsApp did not return a message id." };
  } catch (e) {
    return { ok: false, error: unreachable(e) };
  }
}

const STATUSES: GatewayStatus[] = ["starting", "qr", "qr_expired", "open", "reconnecting", "logged_out"];

export async function gatewayState(config: GatewayConfig): Promise<{ ok: true; state: GatewayState } | { ok: false; error: string }> {
  try {
    const res = await call(config, "/status");
    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) return { ok: false, error: asString(body?.error) ?? `WhatsApp gateway answered ${res.status}.` };
    const status = STATUSES.find((s) => s === body?.status) ?? "starting";
    const qr = asString(body?.qr);
    return {
      ok: true,
      state: {
        status,
        qr: qr?.startsWith("data:image/png;base64,") ? qr : null,
        me: asString(body?.me),
        error: asString(body?.error),
      },
    };
  } catch (e) {
    return { ok: false, error: unreachable(e) };
  }
}

/** POST /connect (new QR) or /logout (unlink the number). */
export async function gatewayAction(config: GatewayConfig, action: "connect" | "logout"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await call(config, `/${action}`, { method: "POST", body: "{}" });
    if (res.ok) return { ok: true };
    const body = asRecord(await res.json().catch(() => null));
    return { ok: false, error: asString(body?.error) ?? `WhatsApp gateway answered ${res.status}.` };
  } catch (e) {
    return { ok: false, error: unreachable(e) };
  }
}

/** Only what the inbox renders. The type decides the response header, never the upstream one. */
export const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function fetchMedia(config: GatewayConfig, mediaId: string): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; status: number }> {
  try {
    const res = await call(config, `/media/${encodeURIComponent(mediaId)}`);
    if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502 };
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!MEDIA_TYPES.has(mime)) return { ok: false, status: 415 };
    return { ok: true, bytes: await res.arrayBuffer(), mime };
  } catch {
    return { ok: false, status: 502 };
  }
}

/** The contact's WhatsApp profile picture (JPEG preview), if they share one. */
export async function fetchAvatar(config: GatewayConfig, waId: string): Promise<ArrayBuffer | null> {
  try {
    const res = await call(config, `/avatar/${encodeURIComponent(waId)}`);
    return res.ok && res.headers.get("content-type")?.startsWith("image/jpeg") ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

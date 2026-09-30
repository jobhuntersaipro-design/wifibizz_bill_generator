import { CHAT_LIMITS } from "./config";

/**
 * The chatbot's pure abuse rules. Pure so each can be tested without a model
 * or a database — a guard that silently lets everything through looks exactly
 * like one that works until the bill arrives.
 */

export type MessageCheck = { ok: true; text: string } | { ok: false; error: string };

/** Trim, refuse empty and over-long input. Control characters are dropped. */
export function checkMessage(raw: unknown): MessageCheck {
  if (typeof raw !== "string") return { ok: false, error: "Type a question first." };
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return { ok: false, error: "Type a question first." };
  if (text.length > CHAT_LIMITS.maxMessageChars) {
    return {
      ok: false,
      error: `Keep a question under ${CHAT_LIMITS.maxMessageChars} characters.`,
    };
  }
  return { ok: true, text };
}

/** Is a lock still in force at `now`? */
export function isLocked(lockedUntil: Date | string | null | undefined, now = new Date()): boolean {
  if (!lockedUntil) return false;
  const t = new Date(lockedUntil).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/**
 * Apply one strike. Returns the new count and, when it reaches the threshold,
 * the time the lock ends.
 */
export function applyStrike(
  strikes: number,
  now = new Date(),
): { strikes: number; lockedUntil: Date | null } {
  const next = strikes + 1;
  return {
    strikes: next,
    lockedUntil:
      next >= CHAT_LIMITS.strikesToLock ? new Date(now.getTime() + CHAT_LIMITS.lockMs) : null,
  };
}

/** "in 42 minutes" for a lock message. Never "in 0 minutes". */
export function lockRemaining(lockedUntil: Date | string, now = new Date()): string {
  const ms = new Date(lockedUntil).getTime() - now.getTime();
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return mins === 1 ? "in 1 minute" : `in ${mins} minutes`;
}

/** Start of the current UTC day — the daily cap's window. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The client key limits hang off. The admin login is one shared identity, so
 * the IP is the only "who" available. Vercel sets x-forwarded-for; the first
 * hop is the client.
 */
export function clientKeyFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || "unknown";
}

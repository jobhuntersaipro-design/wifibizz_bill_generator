import { timingSafeEqual } from "node:crypto";

/**
 * Gate for the Dualhook (Meta Coexistence) webhook. Meta signs these bodies with
 * Dualhook's app secret, which we cannot get, so no signature check is possible.
 * The secret path segment plus these ID checks are the gate.
 */

/** The change fields we store. Any other field is logged and dropped. */
export const DUALHOOK_FIELDS = ["messages", "history", "smb_app_state_sync", "smb_message_echoes"] as const;

export interface DualhookEnv {
  wabaId: string | undefined;
  phoneNumberId: string | undefined;
}

export type DualhookScreen =
  | { ok: false; reason: string }
  | { ok: true; body: { object: string; entry: unknown[] }; kept: number; dropped: string[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Constant-time compare. An empty expected value never matches. */
export function secretMatches(given: string, expected: string | undefined): boolean {
  const want = (expected ?? "").trim();
  if (!want) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Check every entry and change. One wrong WABA id or phone_number_id rejects the
 * whole body, so nothing from it is stored. Pure.
 */
export function screenDualhookBody(body: unknown, env: DualhookEnv): DualhookScreen {
  const waba = (env.wabaId ?? "").trim();
  const phone = (env.phoneNumberId ?? "").trim();
  if (!waba || !phone) return { ok: false, reason: "env_missing" };

  const root = asRecord(body);
  if (!root || root.object !== "whatsapp_business_account") return { ok: false, reason: "bad_object" };
  if (!Array.isArray(root.entry) || root.entry.length === 0) return { ok: false, reason: "no_entry" };

  const allowed = new Set<string>(DUALHOOK_FIELDS);
  const dropped: string[] = [];
  const entries: unknown[] = [];
  let kept = 0;

  for (const raw of root.entry) {
    const entry = asRecord(raw);
    if (!entry || entry.id !== waba) return { ok: false, reason: "waba_mismatch" };
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    const keep: unknown[] = [];
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      const field = typeof change?.field === "string" ? change.field : "";
      if (!change || !allowed.has(field)) {
        dropped.push(field || "(none)");
        continue;
      }
      const metaPhone = asRecord(asRecord(change.value)?.metadata)?.phone_number_id;
      // Required on `messages`; checked on any other field that carries it.
      if (field === "messages" ? metaPhone !== phone : metaPhone !== undefined && metaPhone !== phone) {
        return { ok: false, reason: "phone_mismatch" };
      }
      keep.push(change);
    }
    kept += keep.length;
    entries.push({ ...entry, changes: keep });
  }

  return { ok: true, body: { object: "whatsapp_business_account", entry: entries }, kept, dropped };
}

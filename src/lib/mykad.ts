// Derive gender + birthday from a Malaysian 12-digit ID (MyKad/MyKAS/MyTentera),
// and best-effort race from a Malaysian name. Client-side helpers for the order
// form's auto-fill. Mirrors scraper/case_to_payload.py.

export interface MykadInfo {
  gender: "Male" | "Female";
  birthday: string; // dd-mm-yyyy
}

/** Parse a 12-digit MyKad-like ID. Returns null if not parseable. */
export function parseMykad(ic: string): MykadInfo | null {
  const digits = (ic || "").replace(/\D/g, "");
  if (digits.length !== 12) return null;

  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  // Century: assume 2000s unless that's in the future, then 1900s.
  let year = 2000 + yy;
  if (year > new Date().getFullYear()) year = 1900 + yy;

  const d = new Date(year, mm - 1, dd);
  if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return null; // invalid calendar date

  const gender = parseInt(digits[11], 10) % 2 === 1 ? "Male" : "Female";
  const pad = (n: number) => String(n).padStart(2, "0");
  return { gender, birthday: `${pad(dd)}-${pad(mm)}-${year}` };
}

/**
 * Display form of a MyKad-like ID: XXXXXX-XX-XXXX.
 *
 * Presentation only — the stored value stays raw digits, which is what the
 * document keys embed and what `order_to_payload.py` sends to the portal
 * (it strips non-digits anyway). Formats partial input as the agent types.
 */
export function formatMykad(value: string): string {
  const d = (value || "").replace(/\D/g, "").slice(0, 12);
  if (d.length <= 6) return d;
  if (d.length <= 8) return `${d.slice(0, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/** True when a MyKad-like ID has all 12 digits. */
export function isCompleteMykad(value: string): boolean {
  return (value || "").replace(/\D/g, "").length === 12;
}

/**
 * Email check for the portal's contact form. Stricter than `x@y.z`: rejects
 * consecutive dots, a leading/trailing dot in either part, and a TLD shorter
 * than two characters — the shapes the portal bounces.
 */
export function isValidEmail(value: string): boolean {
  const v = (value || "").trim();
  if (!v || /\s/.test(v)) return false;
  if (v.includes("..")) return false;
  const parts = v.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (!local || local.startsWith(".") || local.endsWith(".")) return false;
  if (domain.startsWith(".") || domain.startsWith("-") || domain.endsWith(".")) return false;
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(domain);
}

/** Best-effort race from Malaysian name markers (portal needs a value). */
export function inferRace(name: string): "Malay" | "Indian" | "Chinese" {
  const n = ` ${(name || "").toUpperCase()} `;
  if (n.includes(" BINTI ") || n.includes(" BIN ")) return "Malay";
  if (n.includes(" A/P ") || n.includes(" A/L ")) return "Indian";
  return "Chinese";
}

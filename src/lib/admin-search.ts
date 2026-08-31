/**
 * The admin oversight's small pure tools: search, CSV, and the alert window.
 * Pure because each is a place where a silent miss looks exactly like a hit.
 */

export interface SearchableOrder {
  fullName: string;
  idNumber: string;
  reference: string | null;
  orderId: string | null;
}

/** Digits-and-letters only, so 940811-03-4224 finds 940811034224. */
const strip = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Does a row match the search box? The four fields somebody arrives holding:
 * name, IC, ORD-reference, portal order number.
 *
 * Name matches as typed (case-insensitive substring); the identifier fields
 * match with separators stripped on BOTH sides, because ICs are written with
 * and without dashes interchangeably and a search that misses on punctuation
 * silently reports "no such order".
 */
export function matchesOrderSearch(row: SearchableOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.fullName.toLowerCase().includes(q)) return true;
  const qs = strip(q);
  if (!qs) return false;
  return (
    strip(row.idNumber).includes(qs) ||
    (!!row.reference && strip(row.reference).includes(qs)) ||
    (!!row.orderId && strip(row.orderId).includes(qs))
  );
}

/**
 * RFC-4180-enough CSV: quote every field, double internal quotes. Quoting
 * unconditionally costs bytes and buys never having to decide — names with
 * commas are a certainty at fifty agents.
 */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/**
 * Should THIS cron tick send the stuck-lock alert?
 *
 * Stateless dedup: the sweep runs every `sweepS`; the age crosses the cap
 * exactly once, so mailing only inside (cap, cap + sweep + slack] fires once
 * per incident with no table and no marker. The slack absorbs cron jitter —
 * without it, a tick landing at cap+5:59.9 and the next at cap+11:00 could
 * straddle the window and mail never.
 */
export function inAlertWindow(
  ageS: number,
  capS: number,
  sweepS = 300,
  slackS = 60,
): boolean {
  return ageS > capS && ageS <= capS + sweepS + slackS;
}

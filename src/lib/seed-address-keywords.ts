// Turning a typed address line into keyword candidates for the portal's
// address search.
//
// The portal's "By Keywords" search matches against its own address database,
// which does NOT contain the state name or the postcode as part of the street
// text. Handing it the whole line typically returns nothing, so the line is
// narrowed in steps and the first candidate that returns rows wins.
//
// Pure and ordered widest-first: a narrower keyword returns more rows, not
// fewer, and picking the right unit out of forty is worse than being told the
// address needs refining.

import { normalizeAddress } from "@/lib/malaysia-address";

/**
 * Keyword strings to try, in order, most specific first.
 *
 * 1. The line as typed, minus postcode / state / MALAYSIA — the portal stores
 *    the street text without them.
 * 2. The same, minus the leading unit or house number, which is the token most
 *    likely to be written differently ("NO 12" vs "12" vs "12A").
 *
 * Duplicates are dropped, so a line with nothing to strip yields one candidate
 * rather than the same search twice.
 */
export function keywordCandidates(address: string, state?: string): string[] {
  const normalized = normalizeAddress(address || "");
  if (!normalized) return [];

  // The state travels to the portal as its own combobox field, so leaving it in
  // the free-text keywords searches for street text that does not exist.
  const stateName = normalizeAddress(state || "");
  const stripped = normalized
    .replace(/\b\d{5}\b/g, " ")
    .replace(/\bMALAYSIA\b/g, " ")
    .replace(stateName ? new RegExp(`\\b${stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g") : /(?!)/g, " ")
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const out: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (t.length >= 3 && !out.includes(t)) out.push(t);
  };

  push(stripped);
  // Drop a leading unit/house number token ("NO 12", "12A", "A-3-2").
  push(stripped.replace(/^(NO\.?\s*)?[A-Z]?[\d][\w-]*\s+/i, ""));

  return out;
}

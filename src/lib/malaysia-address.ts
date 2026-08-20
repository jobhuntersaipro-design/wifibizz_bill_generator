// Validation + parsing for the single "Full Address" field on the Order Entry
// form. The agent types one complete address (the same shape the Unifi portal
// returns as `concatAddress`) and we derive postcode / state / city from it.
//
// This proves the address is well-FORMED, never that it is REAL — only the
// portal's QryNIGAddress search can do that. The point is to stop obviously
// broken input from burning an authenticated dealer-session round trip.
import { MALAYSIA_STATES, STATE_ALIASES } from "@/lib/malaysia-states";
import { ADDRESS_SEARCH_STATES } from "@/lib/order-types";
import MY_POSTCODES from "@/lib/malaysia-postcodes.json";

const POSTCODES = MY_POSTCODES as unknown as Record<string, [string, string]>;

export interface AddressParts {
  postcode?: string;
  /** Canonical MALAYSIA_STATES name, e.g. "Selangor". */
  state?: string;
  /** From the postcode dataset, uppercase — e.g. "JENJAROM". */
  city?: string;
}

export type AddressValidation =
  | { ok: true; postcode: string; state: string; city?: string; hint?: string }
  | { ok: false; reason: string };

const MIN_LENGTH = 20;
const MIN_TOKENS = 5;

/** Street-type words that mark a real street/area segment. */
const STREET_WORDS = new Set([
  "JALAN", "JLN", "LORONG", "LRG", "PERSIARAN", "LEBUH", "LEBUHRAYA",
  "TAMAN", "BANDAR", "KAMPUNG", "KG", "PARIT", "SOLOK", "SIMPANG",
  "BLOK", "LOT", "NO", "MEDAN", "SEKSYEN", "PESIARAN",
]);

/** Unit / house-number shapes: A-07-15, 07-15, LOT 123, NO 45. */
const UNIT_PATTERNS = [/\b[A-Z]?-?\d+-\d+\b/, /\bLOT\s+\d+/, /\bNO\.?\s*\d+/];

/**
 * The three federal territories are named differently in the portal's own
 * State combobox than in MALAYSIA_STATES — see ADDRESS_SEARCH_STATES.
 */
const PORTAL_STATE_OVERRIDES: Record<string, string> = {
  "Kuala Lumpur": "W.P. KUALA LUMPUR",
  Putrajaya: "W.P. PUTRAJAYA",
  Labuan: "W.P. LABUAN",
};

/** Uppercase, strip punctuation to spaces, collapse whitespace. */
function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Whole-word state lookup, built once from the shared state tables.
 *
 * Deliberately NOT `extractState()` from malaysia-states.ts: that one does a
 * `segment.includes(alias)` substring scan in object-key order, so a two-letter
 * alias ("ns", "kl", "jb") can match inside an unrelated word and win over the
 * real state. Here every key is matched as a complete token run instead.
 */
const STATE_LOOKUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const state of MALAYSIA_STATES) map[normalizeKey(state)] = state;
  for (const [alias, state] of Object.entries(STATE_ALIASES)) map[normalizeKey(alias)] = state;
  return map;
})();

const MAX_STATE_TOKENS = 4;

/** Uppercase + collapse whitespace, preserving the address's own characters. */
export function normalizeAddress(input: string): string {
  return input.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Find the state by scanning token windows from the END of the address —
 * Malaysian addresses put the state last, and a street can legitimately be
 * named after another state ("JALAN PERAK" in Pulau Pinang).
 */
function findState(address: string): string | null {
  const cleaned = normalizeKey(
    normalizeAddress(address).replace(/\bMALAYSIA\b/g, " ").replace(/\b\d{5}\b/g, " ")
  );
  if (!cleaned) return null;
  const tokens = cleaned.split(" ");
  for (let end = tokens.length - 1; end >= 0; end--) {
    const maxLen = Math.min(MAX_STATE_TOKENS, end + 1);
    for (let len = maxLen; len >= 1; len--) {
      const hit = STATE_LOOKUP[tokens.slice(end - len + 1, end + 1).join(" ")];
      if (hit) return hit;
    }
  }
  return null;
}

/** Best-effort extraction — no validation, no errors. */
export function parseMalaysianAddress(input: string): AddressParts {
  const normalized = normalizeAddress(input || "");
  const postcodes = normalized.match(/\b\d{5}\b/g) ?? [];
  const postcode = postcodes.length === 1 ? postcodes[0] : undefined;
  const state = findState(normalized) ?? undefined;
  const city = postcode ? POSTCODES[postcode]?.[0] : undefined;
  return { postcode, state, city };
}

/** The portal's State combobox value for a canonical state, or null. */
export function toPortalState(state: string): string | null {
  const portal = PORTAL_STATE_OVERRIDES[state] ?? state.toUpperCase();
  return (ADDRESS_SEARCH_STATES as readonly string[]).includes(portal) ? portal : null;
}

/**
 * A comparison key for "is this the same installation address?".
 *
 * Punctuation and spacing differ freely between what an agent types and what
 * the portal returns for the very same unit ("NO.12, JALAN X" vs "NO 12 JALAN
 * X"), so both collapse to the same key. A trailing "MALAYSIA" is dropped for
 * the same reason — it is optional in practice and carries no information.
 *
 * Returns "" for input with nothing comparable in it, which callers must treat
 * as "no key" rather than as a match — otherwise every blank address would
 * collide with every other blank one.
 */
export function addressKey(input: string): string {
  return normalizeKey(normalizeAddress(input || "").replace(/\bMALAYSIA\b/g, " "));
}

function hasStreetOrUnit(normalized: string): boolean {
  const tokens = normalizeKey(normalized).split(" ");
  if (tokens.some((t) => STREET_WORDS.has(t))) return true;
  return UNIT_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Validate a typed full address. Rules are ordered so the agent gets the most
 * actionable message first.
 */
export function validateMalaysianAddress(input: string): AddressValidation {
  const normalized = normalizeAddress(input || "");

  if (!normalized) return { ok: false, reason: "Enter the installation address." };

  const tokens = normalized.split(" ").filter(Boolean);
  if (normalized.length < MIN_LENGTH || tokens.length < MIN_TOKENS) {
    return { ok: false, reason: "Enter the full address, not just the street." };
  }

  const postcodes = normalized.match(/\b\d{5}\b/g) ?? [];
  const foundState = findState(normalized);

  // Missing BOTH the postcode and the state means this is a street fragment,
  // not a nearly-complete address — say so instead of nit-picking one field.
  if (postcodes.length === 0 && !foundState) {
    return { ok: false, reason: "Enter the full address, not just the street." };
  }
  if (postcodes.length === 0) {
    return { ok: false, reason: "Missing a 5-digit postcode." };
  }
  if (postcodes.length > 1) {
    return {
      ok: false,
      reason: `More than one 5-digit number (${postcodes.join(", ")}) — remove the extra.`,
    };
  }
  const postcode = postcodes[0] as string;

  if (!foundState) {
    return { ok: false, reason: "Couldn't find a Malaysian state in the address." };
  }
  const state = foundState;

  const known = POSTCODES[postcode];
  if (known && known[1] !== state) {
    return {
      ok: false,
      reason: `Postcode ${postcode} belongs to ${known[1].toUpperCase()}, but the address says ${state.toUpperCase()}.`,
    };
  }

  if (!toPortalState(state)) {
    return { ok: false, reason: `The portal doesn't support address search for ${state}.` };
  }

  if (!hasStreetOrUnit(normalized)) {
    return { ok: false, reason: "Include the street / unit (e.g. A-07-15 PERSIARAN …)." };
  }

  return {
    ok: true,
    postcode,
    state,
    city: known?.[0],
    hint: /\bMALAYSIA\b/.test(normalized)
      ? undefined
      : "Tip: portal addresses usually end with MALAYSIA <postcode>.",
  };
}

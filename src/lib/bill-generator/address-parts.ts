/**
 * Shared parsing of a portal address into the parts a document needs to lay out:
 * the street segments, and the postcode / city / state that form the locality.
 *
 * Extracted from the authorization letter so the TIME invoice resolves an address
 * the same way. That matters for more than tidiness: this resolution deliberately
 * treats the postcode table as the authority on city and state, which is what
 * keeps it clear of the state-matcher bug still open against the two bills, where
 * a city containing a state name is mangled (`81200 JOHOR BAHRU JOHOR` becomes
 * `81200 BAHRU JOHOR`). Copying the logic would have meant copying that escape,
 * and any future fix would have had to be made twice.
 */

import { normalizeAddress, type UtilityAddressResult } from './address-normalizer';
import postcodeTable from '../malaysia-postcodes.json';

/**
 * pdf-lib's standard fonts encode Latin-1 only, and a character outside it
 * throws. Map the punctuation that actually turns up in portal addresses to its
 * ASCII equivalent and drop anything else, so a stray en-dash costs a character
 * rather than the whole document.
 */
export function sanitize(text: string): string {
  return (text || '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `part` is a whole-word fragment of `whole` — "KINABALU" of "KOTA KINABALU". */
export function isFragmentOf(part: string, whole: string): boolean {
  const p = part.trim().toUpperCase();
  const w = whole.trim().toUpperCase();
  if (p === w) return true;
  return new RegExp(`(^|\\s)${escapeRegExp(p)}($|\\s)`).test(w);
}

/**
 * Peel the city, state and country off the end of the street text.
 *
 * Repeated because they stack — `… KOTA KINABALU SABAH MALAYSIA` sheds three
 * tails, and stopping after one leaves the address printing the state twice.
 */
export function stripTrailingLocality(text: string, tails: (string | undefined)[]): string {
  const candidates = ['MALAYSIA', ...tails].filter((t): t is string => Boolean(t && t.trim()));
  let out = text.trim();

  for (let pass = 0; pass < candidates.length + 1; pass++) {
    const before = out;
    for (const tail of candidates) {
      out = out.replace(new RegExp(`[,\\s-]*${escapeRegExp(tail.trim())}[,\\s-]*$`, 'i'), '');
    }
    out = out.trim();
    if (out === before) break;
  }
  return out;
}

/**
 * Portal addresses carry placeholder dashes where a segment was left blank
 * ("12 JALAN MIRI BYPASS - - KAMPUNG …"). They are not punctuation and must not
 * reach the document.
 */
export function dropEmptySegments(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token !== '-' && token !== '--' && token !== ',')
    .join(' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(^[,\s-]+)|([,\s-]+$)/g, '')
    .trim();
}

export interface AddressParts {
  /** Comma-separated street segments, with the locality tail already peeled off. */
  streetSegments: string[];
  postcode?: string;
  /** City / town. */
  locality?: string;
  state?: string;
  /**
   * Whether a postcode was found and the tail therefore split off. When false the
   * whole address is street text and there is no locality line to draw.
   */
  hasTail: boolean;
}

/**
 * Resolve a raw portal address into its parts.
 *
 * `normalizeAddress` is used only for its parsed postcode / city / state — the
 * parts that must look clean. The street portion is taken from the raw address
 * up to the postcode, which preserves unit prefixes (`A-12-3`) that the parsed
 * components drop.
 */
export async function resolveAddressParts(
  rawAddress: string,
  fullName: string,
): Promise<AddressParts> {
  const raw = sanitize(rawAddress);
  if (!raw) return { streetSegments: [], hasTail: false };

  let components: UtilityAddressResult['components'] = {};
  try {
    const result = (await normalizeAddress(raw, 'utility', fullName)) as UtilityAddressResult;
    components = result.components ?? {};
  } catch {
    // A geocoding failure must not cost the document — fall through to the raw string.
  }

  // The postcode table is the authority on city and state; the address parser is
  // only the fallback. On a real portal address ("… KOTA KINABALU SABAH MALAYSIA
  // 88450") the parser returned the city as "KINABALU", which both mislabelled
  // the locality line and stranded a lone "KOTA" at the end of the street.
  const postcode = components.postal_code || raw.match(/\b\d{5}\b/)?.[0];
  const fromTable = postcode ? (postcodeTable as Record<string, string[]>)[postcode] : undefined;

  // The table's city REPLACES the parsed one only when the parse is missing or is
  // a fragment of it ("KINABALU" of "KOTA KINABALU"). A parsed city that simply
  // differs is kept: 71010 is LUKUT in the address and PORT DICKSON in the table,
  // and the document should say what the customer's address says.
  const parsedLocality = components.locality?.trim();
  const tableLocality = fromTable?.[0];
  const locality =
    !parsedLocality || (tableLocality && isFragmentOf(parsedLocality, tableLocality))
      ? tableLocality ?? parsedLocality
      : parsedLocality;

  // The state, unlike the city, is unambiguous for a given postcode, and the
  // parser is known to mangle it when a city name contains a state name.
  const state = fromTable?.[1] ?? components.state;

  let streetPart = raw;
  let hasTail = false;
  if (postcode && raw.includes(postcode)) {
    // The portal writes the postcode LAST and uses no commas at all —
    // "A-2-2 LORONG MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450" — so
    // slicing at the postcode is not enough: the city, state and country are
    // still sitting in the street text, and the address would print each of
    // them twice.
    streetPart = raw.replace(new RegExp(`\\b${escapeRegExp(postcode)}\\b`), ' ');
    streetPart = stripTrailingLocality(streetPart, [locality, state]);
    hasTail = true;
  }
  streetPart = dropEmptySegments(streetPart);

  const streetSegments = streetPart
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { streetSegments, postcode, locality, state, hasTail };
}

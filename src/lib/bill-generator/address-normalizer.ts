/**
 * Address Normalization Pipeline for Bill Generation.
 *
 * 3-step pipeline shared by both Internet Bill and Utility Bill generators:
 *   1. Pre-clean (local, no API) — strip FTTH artifacts, *, MALAYSIA; extract unit prefix
 *   2. Google Geocoding API — get postcode, city, state (structural info only)
 *   3. Format per bill type — internet (no masking) vs utility (with masking)
 *
 * Hybrid approach: Google provides postcode/city/state, but original street text
 * is preserved to avoid the API rewriting street names.
 */

import { measureText, fitRepeatCount, type BillFont } from './font-metrics';

// ── Malaysian state names ─────────────────────────────────────────

const STATES = [
  'WP KUALA LUMPUR', 'WP PUTRAJAYA', 'WP LABUAN',
  'WILAYAH PERSEKUTUAN KUALA LUMPUR', 'WILAYAH PERSEKUTUAN PUTRAJAYA',
  'WILAYAH PERSEKUTUAN LABUAN',
  'NEGERI SEMBILAN', 'PULAU PINANG',
  'JOHOR', 'KEDAH', 'KELANTAN', 'MELAKA',
  'PAHANG', 'PERAK', 'PERLIS', 'SABAH', 'SARAWAK',
  'SELANGOR', 'TERENGGANU',
  'KUALA LUMPUR', 'PUTRAJAYA', 'LABUAN',
];

const STREET_KEYWORDS = [
  'JALAN', 'JLN', 'LORONG', 'LRG', 'PERSIARAN', 'LEBUH',
  'TAMAN', 'TMN', 'KAMPUNG', 'KG', 'DESA', 'BANDAR',
  'FELDA', 'LADANG', 'PEKAN', 'PERUMAHAN',
  'RESIDENSI', 'FLAT', 'BLOK',
];

interface AddressComponents {
  street_number?: string;
  route?: string;
  sublocality?: string;
  postal_code?: string;
  locality?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

interface UtilityAddressResult {
  alamat_pos: string[];
  alamat_premis: string[];
  components: AddressComponents;
}

/**
 * Geometry of one address block on the utility bill template.
 *
 * `widthPt` is the width of the white knock-out box, not the page: text drawn wider than
 * the box sits on top of un-erased template content, which is exactly what the overlapping
 * masked name looked like. `slots` is how many fixed Y positions the page actually draws —
 * lines produced beyond it were previously discarded in silence, and the discarded one was
 * the state.
 */
interface UtilityBlockLayout {
  widthPt: number;
  slots: number;
  fontSize: number;
  addrFont: BillFont;
  nameFont: BillFont;
}

// ── Step 1: Pre-clean ─────────────────────────────────────────────

function preclean(rawAddress: string): { cleaned: string; unitPrefix: string | null } {
  let addr = rawAddress.trim().toUpperCase().replace(/\s+/g, ' ');

  // Strip leading asterisk
  addr = addr.replace(/^\*+/, '').trim();

  // Strip FTTH artifacts: e.g. "12 FTTH S2D", "8 FTTH G9"
  addr = addr.replace(/\b\d+\s+FTTH\s+[A-Z0-9]+\b/gi, '');
  addr = addr.replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();

  // Strip MALAYSIA
  addr = addr.replace(/\bMALAYSIA\b/g, '').trim().replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();

  // Extract condo unit prefix: e.g. S2D-12-6, G9-3-8, A-10-1
  let unitPrefix: string | null = null;
  const m = addr.match(/^([A-Z][A-Z0-9]*-\d+-\d+)\b[\s,]*(.*)/i);
  if (m) {
    unitPrefix = m[1].toUpperCase();
    addr = m[2].trim().replace(/^,/, '').trim();
  }

  return { cleaned: addr, unitPrefix };
}

// ── Step 2: Google Geocoding API ───────────────────────────────────

async function geocode(cleanedAddress: string, apiKey?: string): Promise<AddressComponents> {
  if (!apiKey) return {};

  try {
    const params = new URLSearchParams({
      address: cleanedAddress,
      region: 'my',
      key: apiKey,
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'BillGenerator/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json();

    if (data.status !== 'OK' || !data.results?.length) return {};

    const result = data.results[0];
    const components: AddressComponents = {};

    for (const comp of result.address_components) {
      const types: string[] = comp.types;
      const name = comp.long_name.toUpperCase();
      if (types.includes('postal_code') && !components.postal_code) {
        components.postal_code = name;
      }
      if (types.includes('locality') && !components.locality) {
        components.locality = name;
      }
      if (types.includes('administrative_area_level_1') && !components.state) {
        components.state = name;
      }
    }

    const loc = result.geometry.location;
    components.lat = loc.lat;
    components.lng = loc.lng;

    return components;
  } catch {
    return {};
  }
}

// ── State normalization ───────────────────────────────────────────

function normalizeState(state: string): string {
  state = state.toUpperCase().trim();
  if (['KUALA LUMPUR', 'WILAYAH PERSEKUTUAN KUALA LUMPUR', 'FEDERAL TERRITORY OF KUALA LUMPUR'].includes(state)) {
    return 'WP KUALA LUMPUR';
  }
  if (['PUTRAJAYA', 'WILAYAH PERSEKUTUAN PUTRAJAYA', 'FEDERAL TERRITORY OF PUTRAJAYA'].includes(state)) {
    return 'WP PUTRAJAYA';
  }
  if (['LABUAN', 'WILAYAH PERSEKUTUAN LABUAN', 'FEDERAL TERRITORY OF LABUAN'].includes(state)) {
    return 'WP LABUAN';
  }
  return state;
}

// ── Local address parsing ─────────────────────────────────────────

function extractStructure(cleanedAddress: string, googleComponents?: AddressComponents): AddressComponents {
  let addr = cleanedAddress.replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove WILAYAH PERSEKUTUAN
  addr = addr.replace(/\bWILAYAH\s+PERSEKUTUAN\b/g, '').trim().replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();

  const components: AddressComponents = {};

  // Extract state from address text
  let addrRemaining = addr;
  const sortedStates = [...STATES].sort((a, b) => b.length - a.length);
  for (const s of sortedStates) {
    const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = addrRemaining.match(re);
    if (m) {
      components.state = normalizeState(s);
      addrRemaining = (addrRemaining.slice(0, m.index!) + addrRemaining.slice(m.index! + m[0].length)).trim().replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();
      break;
    }
  }

  // Extract postcode (last 5-digit sequence)
  let postcodeMatch: RegExpExecArray | null = null;
  const postcodeRe = /\b(\d{5})\b/g;
  let tempMatch: RegExpExecArray | null;
  while ((tempMatch = postcodeRe.exec(addrRemaining)) !== null) {
    postcodeMatch = tempMatch;
  }

  let streetText: string;
  if (postcodeMatch) {
    components.postal_code = postcodeMatch[1];
    const before = addrRemaining.slice(0, postcodeMatch.index).trim().replace(/,$/, '').trim();
    const after = addrRemaining.slice(postcodeMatch.index + postcodeMatch[0].length).trim().replace(/,$/, '').trim();

    if (after) {
      components.locality = after;
    } else {
      const state = components.state || '';
      const isFt = ['WP KUALA LUMPUR', 'WP PUTRAJAYA', 'WP LABUAN'].includes(state);
      if (!isFt) {
        const words = before.split(' ');
        if (words.length > 0) {
          const lastWord = words[words.length - 1];
          const kwSet = new Set(STREET_KEYWORDS.map(k => k.toUpperCase()));
          if (!kwSet.has(lastWord) && !/^\d/.test(lastWord) && lastWord.length >= 4) {
            components.locality = lastWord;
            streetText = words.slice(0, -1).join(' ');
          } else {
            streetText = before;
          }
        } else {
          streetText = before;
        }
      } else {
        streetText = before;
      }
    }
    streetText = streetText!;
    if (streetText === undefined) streetText = before;
  } else {
    streetText = addrRemaining;
  }

  // Use Google data to fill gaps
  if (googleComponents) {
    if (!components.postal_code && googleComponents.postal_code) {
      components.postal_code = googleComponents.postal_code;
    }
    if (!components.locality && googleComponents.locality) {
      components.locality = googleComponents.locality;
    }
    if (!components.state && googleComponents.state) {
      components.state = normalizeState(googleComponents.state);
    }
    if (googleComponents.lat !== undefined) {
      components.lat = googleComponents.lat;
      components.lng = googleComponents.lng;
    }
  }

  // Federal territory overrides
  const state = components.state || '';
  if (state === 'WP KUALA LUMPUR') components.locality = 'KUALA LUMPUR';
  else if (state === 'WP PUTRAJAYA') components.locality = 'PUTRAJAYA';
  else if (state === 'WP LABUAN') components.locality = 'LABUAN';
  else if (!components.locality && googleComponents?.locality) {
    components.locality = googleComponents.locality;
  }

  // Parse street text
  parseStreet(streetText, components);

  return components;
}

function parseStreet(streetText: string, components: AddressComponents): void {
  if (!streetText) return;
  let text = streetText.trim();

  // Extract leading house/lot number
  const numMatch = text.match(/^((?:LOT|NO\.?)\s+\d[\dA-Z\-/]*|\d[\dA-Z\-/]*)\s+(.*)/i);
  if (numMatch) {
    components.street_number = numMatch[1].toUpperCase();
    text = numMatch[2].trim();
  }

  // Split into route and sublocality at second street keyword
  const kwPattern = new RegExp(`\\b(?:${STREET_KEYWORDS.join('|')})\\b`, 'gi');
  const kwMatches: { pos: number; kw: string }[] = [];
  let kwMatch: RegExpExecArray | null;
  while ((kwMatch = kwPattern.exec(text)) !== null) {
    const kw = kwMatch[0].toUpperCase();
    // Skip JALAN/JLN right after LORONG/LRG
    if (['JALAN', 'JLN'].includes(kw) && kwMatches.length > 0) {
      const prevKw = kwMatches[kwMatches.length - 1].kw.toUpperCase();
      if (['LORONG', 'LRG'].includes(prevKw)) continue;
    }
    kwMatches.push({ pos: kwMatch.index, kw: kwMatch[0] });
  }

  if (kwMatches.length >= 2) {
    const splitAt = kwMatches[1].pos;
    components.route = text.slice(0, splitAt).trim().replace(/,$/, '').trim();
    components.sublocality = text.slice(splitAt).trim().replace(/,$/, '').trim();
  } else {
    components.route = text;
  }
}

// ── Line splitting helpers ────────────────────────────────────────

function smartSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const kwPattern = new RegExp(`\\b(?:${STREET_KEYWORDS.join('|')})\\b`, 'gi');
  let bestSplit: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = kwPattern.exec(text)) !== null) {
    const pos = m.index;
    const first = text.slice(0, pos).trim().replace(/,$/, '').trim();
    if (first.length > 0 && first.length <= maxChars) {
      bestSplit = pos;
    }
  }

  if (bestSplit !== null) {
    const line1 = text.slice(0, bestSplit).trim().replace(/,$/, '').trim();
    const remainder = text.slice(bestSplit).trim();
    return [line1, ...smartSplit(remainder, maxChars)];
  }

  return wrap(text, maxChars);
}

function wrap(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    if (current.length + 1 + words[i].length <= maxChars) {
      current += ' ' + words[i];
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Word-wrap `text` so no line exceeds `widthPt` when measured in the given font.
 *
 * A single word wider than the budget is broken mid-word rather than allowed to overhang —
 * running off the knock-out box is the failure being fixed here, so overflowing is never
 * the lesser evil.
 */
function wrapToWidth(text: string, widthPt: number, font: BillFont, fontSize: number): string[] {
  if (!text) return [];
  if (measureText(text, font, fontSize) <= widthPt) return [text];

  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    let rest = word;
    while (measureText(rest, font, fontSize) > widthPt) {
      let cut = rest.length - 1;
      while (cut > 1 && measureText(rest.slice(0, cut), font, fontSize) > widthPt) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  };

  for (const word of text.split(' ')) {
    if (!current) {
      pushWord(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measureText(candidate, font, fontSize) <= widthPt) {
      current = candidate;
    } else {
      lines.push(current);
      pushWord(word);
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Split `text` to fit `widthPt`, preferring a break at a street keyword.
 *
 * Unlike the character-based `smartSplit`, this only breaks when the text genuinely does
 * not fit. The old version broke at every keyword regardless of width, which is how
 * "XXX XXX," ended up alone on a line and pushed the state past the last slot.
 */
function smartSplitToWidth(text: string, widthPt: number, font: BillFont, fontSize: number): string[] {
  if (!text) return [];
  if (measureText(text, font, fontSize) <= widthPt) return [text];

  const kwPattern = new RegExp(`\\b(?:${STREET_KEYWORDS.join('|')})\\b`, 'gi');
  let bestSplit: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = kwPattern.exec(text)) !== null) {
    if (m.index === 0) continue;
    const head = text.slice(0, m.index).trim().replace(/,$/, '').trim();
    if (head && measureText(head, font, fontSize) <= widthPt) bestSplit = m.index;
  }

  if (bestSplit !== null) {
    const head = text.slice(0, bestSplit).trim().replace(/,$/, '').trim();
    const tail = text.slice(bestSplit).trim();
    return [head, ...smartSplitToWidth(tail, widthPt, font, fontSize)];
  }

  return wrapToWidth(text, widthPt, font, fontSize);
}

function buildStreetLine(components: AddressComponents): string {
  const parts: string[] = [];
  if (components.route) parts.push(components.route);
  if (components.sublocality) parts.push(components.sublocality);
  return parts.join(' ');
}

function buildPostcodeCity(components: AddressComponents, includeState = true, includeCountry = false): string {
  const parts: string[] = [];
  if (components.postal_code) parts.push(components.postal_code);
  if (components.locality) parts.push(components.locality);
  if (includeState && components.state) parts.push(components.state);
  if (includeCountry) parts.push('MALAYSIA');
  return parts.join(' ');
}

// ── Internet Bill Formatting ────────────────────────────────────

/**
 * Lay out the Umobile bill's address in the `slots` lines the page draws.
 *
 * The postcode / city / state line is reserved first and always survives. It used to be
 * pushed last and then cut by `slice(0, 3)`, so any street that took three lines — a
 * keyword split that leaves "17" alone on line one is enough — printed a bill with no
 * postcode and no state. If the keyword-split street does not fit the lines left, it is
 * re-wrapped as plain text before anything is dropped.
 */
function formatInternetAddress(
  components: AddressComponents,
  unitPrefix: string | null,
  maxChars = 55,
  slots = 3,
): string[] {
  const postcodeLine = buildPostcodeCity(components, true, true);
  const localityLines = postcodeLine ? wrap(postcodeLine, maxChars).slice(0, slots) : [];
  const streetBudget = Math.max(0, slots - localityLines.length);

  let streetLines: string[];
  if (unitPrefix) {
    const line1 = `${unitPrefix} ${components.route || ''}`.trim();
    streetLines = smartSplit(line1, maxChars);
    if (components.sublocality) streetLines.push(...smartSplit(components.sublocality, maxChars));
  } else {
    const street = buildStreetLine(components);
    const unit = components.street_number || '';
    const streetWithUnit = unit ? `${unit} ${street}`.trim() : street;
    streetLines = streetWithUnit ? smartSplit(streetWithUnit, maxChars) : [];
  }
  if (streetLines.length > streetBudget) streetLines = wrap(streetLines.join(' '), maxChars);

  return [...streetLines.slice(0, streetBudget), ...localityLines];
}

// ── Utility Bill Formatting ─────────────────────────────────────

/**
 * Postcode, city and state on ONE line: "63000 CYBERJAYA, SELANGOR".
 *
 * These used to occupy two of the five slots, and the state — pushed last — was the line
 * the drawing loop dropped when the address ran long. Merging them frees a slot and keeps
 * the block that a reader actually checks the bill against intact.
 */
function buildLocalityLine(components: AddressComponents): string {
  const postcodeCity = buildPostcodeCity(components, false);
  const state = components.state || '';
  if (postcodeCity && state) return `${postcodeCity}, ${state}`;
  return postcodeCity || state;
}

/**
 * Lay out one utility-bill address block within its knock-out box and slot count.
 *
 * The locality line is reserved first and always survives; street and sublocality lines
 * take whatever slots are left. If they still do not fit, the trailing street lines are
 * dropped — a bill missing a street detail reads as ordinary, one missing its state reads
 * as fabricated.
 */
function layoutUtilityBlock(
  components: AddressComponents,
  unitPrefix: string | null,
  layout: UtilityBlockLayout,
  maskName: boolean,
): string[] {
  const { widthPt, fontSize, addrFont, nameFont } = layout;
  const route = components.route || '';
  const sublocality = components.sublocality || '';

  const lines: string[] = [];
  let available = layout.slots;

  if (maskName) {
    // Fixed-width mask. The old mask was 'X'.repeat(fullName.length), so a long name drew a
    // long row of X's — and X is the widest common glyph in Tahoma-Bold — straight past the
    // box and over the column divider. The mask conveys nothing, so its length is free to
    // be whatever fits.
    lines.push('X'.repeat(fitRepeatCount('X', nameFont, fontSize, widthPt)));
    available -= 1;
  }

  const localityLines = wrapToWidth(buildLocalityLine(components), widthPt, addrFont, fontSize);
  const streetBudget = Math.max(0, available - localityLines.length);

  const streetHead = unitPrefix ? `XXX XXX,${route}` : `XXX XXX, ${route}`;
  const streetLines = [
    ...smartSplitToWidth(streetHead, widthPt, addrFont, fontSize),
    ...smartSplitToWidth(sublocality, widthPt, addrFont, fontSize),
  ];

  lines.push(...streetLines.slice(0, streetBudget), ...localityLines);
  return lines;
}

// ── High-level normalize function ─────────────────────────────────

/**
 * Geometry for both utility blocks. The generator passes its own overlay constants so the
 * page coordinates and the wrapping budget cannot drift apart; this is the fallback.
 */
interface UtilityLayout {
  alamatPos: UtilityBlockLayout;
  alamatPremis: UtilityBlockLayout;
}

const DEFAULT_UTILITY_LAYOUT: UtilityLayout = {
  alamatPos: { widthPt: 178, slots: 5, fontSize: 8, addrFont: '/F0301', nameFont: '/F0201' },
  alamatPremis: { widthPt: 150, slots: 5, fontSize: 8, addrFont: '/F0301', nameFont: '/F0201' },
};

export async function normalizeAddress(
  rawAddress: string,
  billType: 'internet' | 'utility',
  fullName = '',
  maxChars?: number,
  apiKey?: string,
  utilityLayout?: UtilityLayout,
): Promise<string[] | UtilityAddressResult> {
  void fullName; // the utility name line is a fixed-width mask now, so the real name is unused
  if (!apiKey) {
    apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  // Step 1: Pre-clean
  const { cleaned, unitPrefix } = preclean(rawAddress);

  // Step 2: Try local parsing first — skip geocoding if we have postcode + state
  const localComponents = extractStructure(cleaned);

  let components: AddressComponents;
  if (localComponents.postal_code && localComponents.state) {
    components = localComponents;
  } else {
    const googleComponents = await geocode(cleaned, apiKey);
    components = extractStructure(cleaned, googleComponents);
  }

  // Step 3: Format per bill type
  if (billType === 'internet') {
    const mc = maxChars || 55;
    return formatInternetAddress(components, unitPrefix, mc);
  }

  const layout = utilityLayout || DEFAULT_UTILITY_LAYOUT;
  return {
    alamat_pos: layoutUtilityBlock(components, unitPrefix, layout.alamatPos, true),
    alamat_premis: layoutUtilityBlock(components, unitPrefix, layout.alamatPremis, false),
    components,
  };
}

export type { AddressComponents, UtilityAddressResult, UtilityLayout, UtilityBlockLayout };

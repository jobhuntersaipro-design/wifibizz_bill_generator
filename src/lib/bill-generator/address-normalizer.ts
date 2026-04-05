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

function formatInternetAddress(components: AddressComponents, unitPrefix: string | null, maxChars = 55): string[] {
  const street = buildStreetLine(components);
  const postcodeLine = buildPostcodeCity(components, true, true);
  const unit = components.street_number || '';

  if (unitPrefix) {
    const route = components.route || '';
    const sublocality = components.sublocality || '';
    const line1 = `${unitPrefix} ${route}`.trim();
    const lines = smartSplit(line1, maxChars);
    if (sublocality) lines.push(...smartSplit(sublocality, maxChars));
    lines.push(postcodeLine);
    return lines.slice(0, 3);
  }

  const streetWithUnit = unit ? `${unit} ${street}`.trim() : street;
  const lines = smartSplit(streetWithUnit, maxChars);
  lines.push(postcodeLine);
  return lines.slice(0, 3);
}

// ── Utility Bill Formatting ─────────────────────────────────────

function formatUtilityAlamatPos(components: AddressComponents, unitPrefix: string | null, fullName = '', maxChars = 40): string[] {
  const maskedName = 'X'.repeat(Math.max(fullName.length, 12));
  const route = components.route || '';
  const sublocality = components.sublocality || '';
  const postcodeCity = buildPostcodeCity(components, false);
  const state = components.state || '';

  const lines = [maskedName];

  if (unitPrefix) {
    lines.push(`XXX XXX,${route}`);
    if (sublocality) lines.push(...smartSplit(sublocality, maxChars));
  } else {
    lines.push(`XXX XXX, ${route}`);
    if (sublocality) lines.push(...smartSplit(sublocality, maxChars));
  }

  lines.push(postcodeCity);
  if (state) lines.push(state);

  return lines;
}

function formatUtilityAlamatPremis(components: AddressComponents, unitPrefix: string | null, maxChars = 33): string[] {
  const route = components.route || '';
  const sublocality = components.sublocality || '';
  const postcodeCity = buildPostcodeCity(components, false);
  const state = components.state || '';

  const lines: string[] = [];

  if (unitPrefix) {
    lines.push(`XXX XXX,${route}`);
    if (sublocality) lines.push(...smartSplit(sublocality, maxChars));
  } else {
    lines.push(`XXX XXX, ${route}`);
    if (sublocality) lines.push(...smartSplit(sublocality, maxChars));
  }

  lines.push(postcodeCity);
  if (state) lines.push(state);

  return lines;
}

// ── High-level normalize function ─────────────────────────────────

export async function normalizeAddress(
  rawAddress: string,
  billType: 'internet' | 'utility',
  fullName = '',
  maxChars?: number,
  apiKey?: string,
): Promise<string[] | UtilityAddressResult> {
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

  return {
    alamat_pos: formatUtilityAlamatPos(components, unitPrefix, fullName, 40),
    alamat_premis: formatUtilityAlamatPremis(components, unitPrefix, maxChars || 33),
    components,
  };
}

export type { AddressComponents, UtilityAddressResult };

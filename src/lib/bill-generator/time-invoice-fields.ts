/**
 * Every value the TIME invoice prints, computed in one place.
 *
 * The invoice states the same figures on four pages — the A/B/C summary boxes,
 * the BILL SUMMARY table, the payment slip and the page-3 detail. They cannot be
 * allowed to disagree, so all of them read this one object rather than each
 * recomputing from the case.
 *
 * Nothing here touches pdf-lib, so the arithmetic and the date rules are testable
 * on their own.
 */

import { hashSeed, makeRng } from './owner-identity';
import { resolveAddressParts } from './address-parts';

/**
 * Helvetica 9pt, the face and size the customer block is drawn in.
 * The audit measures with the same pair so a line the bill wraps is a line the
 * audit accepts.
 */
export const TIME_ADDRESS_FONT_SIZE = 9;

/**
 * From x=42 to the left edge of the Overdue / Current Charges boxes (x=342).
 *
 * Those boxes are the rects `342 661 105 -55` and `448 661 105 -55`: x>=342,
 * y=606–661. Text past x=342 paints over them.
 */
export const TIME_ADDRESS_MAX_WIDTH = 300;

/**
 * Top of the e-invoice mark on page 1 of `time_invoice.pdf`.
 * img4 is `50 0 0 33 32 601 cm` (top y=634). Xf1 is a 273×180 form scaled by
 * 0.18315 at (32, 602), top y=635. Helvetica's descent is 207/1000, so 9pt
 * ink reaches 1.86pt under the baseline. A baseline at 640.56 stays clear.
 */
export const TIME_ADDRESS_QR_TOP = 635;

/**
 * Street lines the page can draw. Two is the common case and keeps the
 * template's four slots. A third is drawn only when the street still needs it
 * after the trailing-locality drop; the fifth baseline then sits at y=640.56.
 */
export const TIME_ADDRESS_STREET_SLOTS = 3;

/** Two street lines, the locality, then MALAYSIA. The template's own slots. */
export const TIME_ADDRESS_BASELINES = [688.56, 676.56, 663.56, 650.56] as const;

/** Three street lines, the locality, then MALAYSIA. The last baseline clears the e-invoice mark. */
export const TIME_ADDRESS_BASELINES_WITH_THIRD_STREET = [688.56, 676.56, 664.56, 652.56, 640.56] as const;

// ── The plan ───────────────────────────────────────────────────────
// Fixed for every invoice, per the 2026-08-23 decision: no speed mapping from
// the case's Unifi package.
export const PLAN_NAME = 'TIME Fibre Home Broadband 200Mbps';
/** Monthly charge in sen. Money is integer sen throughout — see `money()`. */
export const MONTHLY_SEN = 9900;
export const SERVICE_TAX_PERCENT = 6;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Formatting ─────────────────────────────────────────────────────

/** `02/04/2026` — the form every date on the invoice uses except the due date. */
export function slashDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** `2 May 2026` — the due date only, matching the template. */
export function longDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Sen to the printed form: `10858` → `108.58`.
 *
 * All money on this invoice is carried as integer sen and only formatted here.
 * The figures chain — prorated feeds the subtotal, which feeds the tax, which
 * feeds the total, which feeds the rounded amount — and doing that in floating
 * point is how a bill ends up one sen short of its own sub-total.
 */
export function money(sen: number): string {
  const sign = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ── Dates ──────────────────────────────────────────────────────────

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Add whole months, clamping the day to the target month's length so that
 * 31 January + 1 month is 28 February rather than rolling into March.
 */
export function addMonths(d: Date, months: number): Date {
  const year = d.getFullYear();
  const month = d.getMonth() + months;
  const day = Math.min(d.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Inclusive day count between two dates on the same clock. */
export function inclusiveDays(from: Date, to: Date): number {
  const ms = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
    - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

// ── Identity ───────────────────────────────────────────────────────

function digits(rng: () => number, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(rng() * 10);
  return out;
}

export interface TimeInvoiceFields {
  /** 12 digits. Printed with a ` 10` suffix in the header and the barcode caption. */
  account: string;
  /** 9 digits. */
  invoice: string;
  serviceNo: string;

  invoiceDate: Date;
  dueDate: Date;
  /** The full month being billed. */
  periodStart: Date;
  periodEnd: Date;
  /** The part-month before the first full cycle. */
  proStart: Date;
  proEnd: Date;

  /** All money in integer sen. */
  monthlySen: number;
  proratedSen: number;
  subtotalSen: number;
  taxSen: number;
  totalSen: number;
  /** `totalSen` at the nearest 5 sen — what the payment slip asks for. */
  roundedSen: number;
}

/**
 * Compute the invoice for a case.
 *
 * Seeded on the case number, for the same reason the authorization letter seeds
 * its property owner: nothing about this document is stored, so an unseeded
 * random would hand out a different account number, and a different set of
 * dates, every time the same case is downloaded.
 */
export function computeInvoiceFields(caseNo: string, now = new Date()): TimeInvoiceFields {
  const rng = makeRng(hashSeed(`time-invoice:${caseNo}`));

  const account = `6888${digits(rng, 8)}`;
  const invoice = `${1 + Math.floor(rng() * 9)}${digits(rng, 8)}`;
  const serviceNo = `TBBNB${digits(rng, 6)}G_${digits(rng, 10)}`;

  // Invoice date: a day early in last month. Billing on the 2nd-9th mirrors the
  // sample and keeps the whole cycle in the past, so the invoice always reads as
  // one already issued rather than one dated into the future.
  const invoiceDay = 2 + Math.floor(rng() * 8);
  const lastMonth = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -1);
  const invoiceDate = new Date(
    lastMonth.getFullYear(),
    lastMonth.getMonth(),
    Math.min(invoiceDay, daysInMonth(lastMonth.getFullYear(), lastMonth.getMonth())),
  );

  const dueDate = addMonths(invoiceDate, 1);
  const periodStart = invoiceDate;
  const periodEnd = addDays(dueDate, -1);

  // The part-month between service activation and the first full cycle — why the
  // sample shows 30/03–01/04 ahead of 02/04–01/05.
  const proSpan = 1 + Math.floor(rng() * 9);
  const proEnd = addDays(invoiceDate, -1);
  const proStart = addDays(proEnd, -(proSpan - 1));

  // Prorated against the month the service started in, which is proStart's month.
  // The sample proves this: 30/03–01/04 spans two months and divides by 31, and
  // 9900 × 3 ÷ 31 = 958 sen, the 9.58 the template prints.
  const proratedDays = inclusiveDays(proStart, proEnd);
  const proratedSen = Math.round(
    (MONTHLY_SEN * proratedDays) / daysInMonth(proStart.getFullYear(), proStart.getMonth()),
  );

  const subtotalSen = proratedSen + MONTHLY_SEN;
  // Half-up. The sample does not settle rounding versus truncation — 651.48 sen
  // gives 651 either way — so this is a choice, not something inferred from it.
  const taxSen = Math.round((subtotalSen * SERVICE_TAX_PERCENT) / 100);
  const totalSen = subtotalSen + taxSen;
  // Malaysian 5-sen rounding, which the sample's 115.09 → 115.10 confirms.
  const roundedSen = Math.round(totalSen / 5) * 5;

  return {
    account,
    invoice,
    serviceNo,
    invoiceDate,
    dueDate,
    periodStart,
    periodEnd,
    proStart,
    proEnd,
    monthlySen: MONTHLY_SEN,
    proratedSen,
    subtotalSen,
    taxSen,
    totalSen,
    roundedSen,
  };
}

// ── Customer block ─────────────────────────────────────────────────

export interface InvoiceAddress {
  /** Street lines actually drawn. At most TIME_ADDRESS_STREET_SLOTS. */
  street: string[];
  /**
   * The street wrap before the page drops a line that does not fit.
   * Equal to `street` when nothing was cut.
   */
  fullStreet: string[];
  /** True when `fullStreet` is longer than `street`. The audit fails on this. */
  streetTruncated: boolean;
  /**
   * Postcode, city and state on one line. Present when the address has a
   * postcode. Omitted when it would only repeat a city or state the street
   * already prints and the source has no postcode.
   */
  locality: string;
}

/** Measures a string in points. Supplied by the caller so this module stays pdf-free. */
export type Measure = (text: string) => number;

/**
 * Word-wrap `text` so every line measures within `maxWidth`.
 *
 * A single word wider than the box is broken mid-word. Letting it overhang is
 * how a line crosses x=342 and paints over the charges boxes. An ellipsis is
 * never inserted: `...` is what ate TAMAN SUBANG PERMAI off the TIME bill.
 */
function wrapMeasured(text: string, measure: Measure, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  const breakWide = (word: string): string => {
    let rest = word;
    while (rest.length > 1 && measure(rest) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return rest;
  };

  for (const word of words) {
    if (!current) {
      current = breakWide(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = breakWide(word);
    }
  }
  if (current) lines.push(current);
  return lines;
}

const LOCALITY_WORDS = ['MALAYSIA', 'WP', 'W.P', 'WILAYAH', 'PERSEKUTUAN', 'FEDERAL', 'TERRITORY', 'OF'];

function localityTokens(text: string): string[] {
  return text
    .toUpperCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ''))
    .filter(Boolean);
}

/** MALAYSIA has its own line. It is never also printed inside the street or the locality. */
function withoutCountry(text: string): string {
  return text
    .replace(/\bMALAYSIA\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function localityVocabulary(parts: { postcode?: string; locality?: string; state?: string }): Set<string> {
  const words = new Set<string>(LOCALITY_WORDS);
  for (const piece of [parts.postcode, parts.locality, parts.state]) {
    for (const token of localityTokens(piece ?? '')) words.add(token);
  }
  return words;
}

/** A segment whose every token is city, state, WP, Malaysia or the postcode. */
function isLocalityOnlySegment(segment: string, vocab: Set<string>): boolean {
  const tokens = localityTokens(segment);
  return tokens.length > 0 && tokens.every((token) => vocab.has(token));
}

/**
 * Peel locality-only segments off the end. A segment that also names a street
 * (`Jalan Bukit Bintang Kuala Lumpur`) stays whole.
 */
function dropTrailingLocalitySegments(segments: string[], vocab: Set<string>): string[] {
  const out = [...segments];
  while (out.length > 0 && isLocalityOnlySegment(out[out.length - 1], vocab)) out.pop();
  return out;
}

function coversLocality(streetText: string, locality: string): boolean {
  const folded = streetText
    .toUpperCase()
    .replace(/\bWILAYAH\s+PERSEKUTUAN\b/g, 'WP')
    .replace(/\bFEDERAL\s+TERRITORY\s+OF\b/g, 'WP')
    .replace(/\bW\.?\s*P\.?\b/g, 'WP');
  const have = new Set(localityTokens(folded));
  const need = localityTokens(locality);
  return need.length > 0 && need.every((token) => have.has(token));
}

function localityLine(parts: { postcode?: string; locality?: string; state?: string }): string {
  const city = (parts.locality ?? '').trim();
  const state = (parts.state ?? '').trim();
  // The postcode table names Kuala Lumpur as both city and state. Printing it
  // twice on the one line adds nothing the source did not already say.
  const stateAdds = state && state.toUpperCase() !== city.toUpperCase();
  return withoutCountry([parts.postcode, city, stateAdds ? state : ''].filter((p) => p && p.trim()).join(' ')).toUpperCase();
}

/**
 * Pack the address into the street slots plus the locality line.
 *
 * The locality line is reserved when the address has a postcode: postcode, city
 * and state draw, and it is the street that yields. The utility bill got this
 * the other way round — its formatter emitted as many lines as it needed while
 * the page drew a fixed number, so the last line was silently dropped, and the
 * last line was the state.
 *
 * Trailing segments that only repeat the locality (city, state, Wilayah
 * Persekutuan / WP, Malaysia, the postcode) are dropped when the street would
 * otherwise need more than two lines, and only then. Dropping them on every
 * address would take SUBANG JAYA off the golden street, which has to stay:
 * `… TAMAN SUBANG PERMAI, SUBANG JAYA` then `47500 SUBANG JAYA SELANGOR`.
 * The golden wrap is two lines with that segment, so it is left in place.
 * Whole segments only — a street name that ends with the city is not split.
 *
 * A street that still needs a third line gets one. The fifth baseline clears
 * the e-invoice mark. Anything beyond that is a real truncation: `fullStreet`
 * keeps the lines that were not drawn, and the audit fails with
 * `street_truncated` even when those words also sit on the locality line.
 *
 * With no postcode, a locality line that only repeats the city or state already
 * printed on the street is omitted, so the bill does not say SELANGOR and then
 * SELANGOR again. MALAYSIA is never put on either of those lines.
 *
 * Uppercase BEFORE measuring. Helvetica caps are wider than the mixed-case
 * portal text, so a line that fit in "Jalan Subang Permai" overflowed once it
 * became "JALAN SUBANG PERMAI" and was then cut with `...`.
 *
 * Width is measured, never counted. A line of `X` is far wider than a line of
 * address text of the same length, which is exactly what pushed the utility
 * bill's masked name outside its box.
 */
export function packAddress(
  parts: { streetSegments: string[]; postcode?: string; locality?: string; state?: string },
  measure: Measure,
  maxWidth: number,
): InvoiceAddress {
  const vocab = localityVocabulary(parts);
  let segments = parts.streetSegments.map(withoutCountry).filter(Boolean);
  const joinSegments = (rows: string[]) => rows.map((s) => s.toUpperCase()).join(', ');

  let fullStreet = wrapMeasured(joinSegments(segments), measure, maxWidth);
  if (fullStreet.length > 2) {
    const trimmed = dropTrailingLocalitySegments(segments, vocab);
    if (trimmed.length !== segments.length) {
      segments = trimmed;
      fullStreet = wrapMeasured(joinSegments(segments), measure, maxWidth);
    }
  }

  const street = fullStreet.slice(0, TIME_ADDRESS_STREET_SLOTS);
  const localityText = localityLine(parts);
  // A postcode line fits the box. If one ever does not, the first wrapped piece
  // is what draws — still with no ellipsis, and still inside the box.
  let locality = localityText ? (wrapMeasured(localityText, measure, maxWidth)[0] ?? '') : '';
  if (!parts.postcode?.trim() && locality && coversLocality(street.join(' '), locality)) {
    locality = '';
  }

  return {
    street,
    fullStreet,
    streetTruncated: fullStreet.length > street.length,
    locality,
  };
}

/** Street, locality, then MALAYSIA — the lines the invoice actually draws. */
export function printedTimeAddress(address: InvoiceAddress): string[] {
  return [...address.street, address.locality, 'MALAYSIA'].filter((line) => line.trim());
}

/** Resolve a raw portal address into the invoice's customer block. */
export async function buildInvoiceAddress(
  rawAddress: string,
  fullName: string,
  measure: Measure,
  maxWidth: number,
): Promise<InvoiceAddress> {
  const parts = await resolveAddressParts(rawAddress, fullName, { keepTrailingLocality: true });
  return packAddress(parts, measure, maxWidth);
}

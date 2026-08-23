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
  /** Up to two street lines. */
  street: string[];
  /**
   * Postcode, city and state on one line. Always present when the address has a
   * postcode, and always drawn — see `buildInvoiceAddress`.
   */
  locality: string;
}

/** Measures a string in points. Supplied by the caller so this module stays pdf-free. */
export type Measure = (text: string) => number;

function truncateToWidth(text: string, measure: Measure, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && measure(`${out}...`) > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}...`;
}

/**
 * Pack the address into the two street slots plus the locality line.
 *
 * The locality line is reserved: postcode, city and state always draw, and it is
 * the street that yields. The utility bill got this the other way round — its
 * formatter emitted as many lines as it needed while the page drew a fixed
 * number, so the last line was silently dropped, and the last line was the state.
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
  const locality = [parts.postcode, parts.locality, parts.state]
    .filter((p) => p && p.trim())
    .join(' ')
    .toUpperCase();

  const lines: string[] = [];
  let current = '';
  for (const segment of parts.streetSegments) {
    const candidate = current ? `${current}, ${segment}` : segment;
    if (!current || measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = segment;
    }
  }
  if (current) lines.push(current);

  // Only two street slots exist on the page. Anything beyond them is folded into
  // the second line and truncated to fit, rather than being dropped unseen.
  let street = lines.map((l) => l.toUpperCase());
  if (street.length > 2) {
    street = [street[0], truncateToWidth(street.slice(1).join(', '), measure, maxWidth)];
  } else {
    street = street.map((l) => truncateToWidth(l, measure, maxWidth));
  }

  return { street, locality: truncateToWidth(locality, measure, maxWidth) };
}

/** Resolve a raw portal address into the invoice's customer block. */
export async function buildInvoiceAddress(
  rawAddress: string,
  fullName: string,
  measure: Measure,
  maxWidth: number,
): Promise<InvoiceAddress> {
  const parts = await resolveAddressParts(rawAddress, fullName);
  return packAddress(parts, measure, maxWidth);
}

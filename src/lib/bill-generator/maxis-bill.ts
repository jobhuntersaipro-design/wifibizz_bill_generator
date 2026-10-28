/**
 * Maxis bill (ClickUp z8v9xnj9ck).
 *
 * The template is a real 9-page Maxis statement: page 1 summary, account
 * summary, then the itemised charges and call records of two mobile lines and a
 * Home Fibre line. The Amdocs printer writes every text run as a plain
 * `(literal) Tj`, and each run sits at its own TD offset, so a run is swapped
 * in place and keeps its font and position.
 *
 * What changes per bill: the customer name and address, the account and bill
 * reference numbers, the four service numbers, every number called (repeated
 * contacts stay repeated), and every date (moved by whole months, so the
 * statement falls in the month before today). The amounts stay as printed, so
 * every total still adds up. The fonts are embedded whole (not subset), so any
 * WinAnsi character draws.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { resolveAddressParts, sanitize } from './address-parts';
import { decodeCustomerName } from '../html-entities';
import type { CaseData } from './internet-bill';

type Rng = () => number;

const TEMPLATE = path.join(process.cwd(), 'bill_generator', 'template', 'maxis_bill.pdf');

/** The template's statement date, 10/05/2026. Month index is 0-based. */
const TEMPLATE_YEAR = 2026;
const TEMPLATE_MONTH = 4;

/** Widest a name (top panel) or address line (bottom block) may run before the next column (pt). */
const MAX_NAME_WIDTH = 190;
const MAX_ADDRESS_WIDTH = 250;
/** The address block has six lines in the template. */
const ADDRESS_SLOTS = 6;
const TEMPLATE_NAME = 'SIEW CHEE MING';
const TEMPLATE_ADDRESS = ['NO 34 JALAN 6/4', 'SAUJANA PUCHONG', 'PUCHONG', '47100 PUCHONG', 'SELANGOR', 'MALAYSIA'];

const randInt = (min: number, max: number, rng: Rng) => min + Math.floor(rng() * (max - min + 1));
const digits = (n: number, rng: Rng) => Array.from({ length: n }, () => randInt(0, 9, rng)).join('');
const two = (n: number) => String(n).padStart(2, '0');

/** Months to add to the template so the statement lands in the month before today (Malaysia time). */
export function monthShift(now = new Date()): number {
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  return (myt.getUTCFullYear() - TEMPLATE_YEAR) * 12 + myt.getUTCMonth() - 1 - TEMPLATE_MONTH;
}

/** Moves every DD/MM/YYYY and DD/MM/YY in `text` by `months`; a day past the month's end is clamped. */
export function shiftDates(text: string, months: number): string {
  return text.replace(/\b(\d{2})\/(\d{2})\/(\d{4}|\d{2})\b/g, (_, d: string, m: string, y: string) => {
    const short = y.length === 2;
    const total = (short ? 2000 + Number(y) : Number(y)) * 12 + Number(m) - 1 + months;
    const year = Math.floor(total / 12);
    const month = total % 12;
    const day = Math.min(Number(d), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return `${two(day)}/${two(month + 1)}/${short ? two(year % 100) : year}`;
  });
}

/** `+60137089093` → `6013 7089093`, the way the bill prints a mobile line. Null when it is not a mobile. */
export function maxisLineNumber(mobile: string): string | null {
  let d = (mobile || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `6${d}`;
  return /^601\d{8,9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4)}` : null;
}

export interface MaxisFields {
  name: string;
  address: string[];
  /** Template string → replacement, applied to whole runs and inside longer runs. */
  swaps: [string, string][];
  months: number;
}

export async function maxisFields(caseData: CaseData, now = new Date(), rng: Rng = Math.random): Promise<MaxisFields> {
  const name = sanitize(decodeCustomerName(caseData.full_name)).toUpperCase();
  const parts = await resolveAddressParts(caseData.full_address, name);
  const street = wrap(parts.streetSegments.join(', ').toUpperCase(), 44);
  const locality = [parts.postcode, parts.locality].filter(Boolean).join(' ');
  // Six lines in all. A long street takes the state onto the postcode line, then
  // the country's line, before any street word is dropped.
  let tail = [locality, parts.state ?? '', 'MALAYSIA'].filter(Boolean);
  if (street.length + tail.length > ADDRESS_SLOTS) tail = [[locality, parts.state].filter(Boolean).join(' '), 'MALAYSIA'];
  if (street.length + tail.length > ADDRESS_SLOTS) tail = tail.slice(0, 1);
  const address = [...street.slice(0, ADDRESS_SLOTS - tail.length), ...tail].map((s) => s.toUpperCase());

  const line1 = maxisLineNumber(caseData.mobile) ?? `6014 ${digits(7, rng)}`;
  const line2 = `6012 ${digits(7, rng)}`;
  const swaps: [string, string][] = [
    ['1864671191', `18${digits(8, rng)}`],
    ['1615193144', `16${digits(8, rng)}`],
    ['6014 9331718', line1],
    ['60149331718', line1.replace(' ', '')],
    ['6012 3059950', line2],
    ['60123059950', line2.replace(' ', '')],
    ['603 58926816', `603 ${digits(8, rng)}`],
    ['462710', digits(6, rng)],
  ];
  return { name, address, swaps, months: monthShift(now) };
}

/** Word wrap by characters; one long word stays whole. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && last.length + 1 + word.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

const escapePdf = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const unescapePdf = (s: string) => s.replace(/\\([\\()])/g, '$1');

/** Advance widths (1/1000 em) of each font on a page, keyed by resource name. */
function fontWidths(page: ReturnType<PDFDocument['getPages']>[number]) {
  const out = new Map<string, (text: string) => number>();
  const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
  if (!fonts) return out;
  for (const [key, ref] of fonts.entries()) {
    const font = page.doc.context.lookup(ref, PDFDict);
    const first = font.lookup(PDFName.of('FirstChar'), PDFNumber)?.asNumber() ?? 0;
    const widths = font.lookup(PDFName.of('Widths'), PDFArray);
    if (!widths) continue;
    const w = widths.asArray().map((n) => (n as PDFNumber).asNumber());
    out.set(key.asString().replace(/^\//, ''), (text) =>
      [...text].reduce((sum, c) => sum + (w[c.charCodeAt(0) - first] ?? 500), 0),
    );
  }
  return out;
}

export async function generateMaxisBill(
  caseData: CaseData,
  now = new Date(),
  rng: Rng = Math.random,
): Promise<Uint8Array> {
  const fields = await maxisFields(caseData, now, rng);
  const doc = await PDFDocument.load(await readFile(TEMPLATE));
  const called = new Map<string, string>();
  // ponytail: the call log keeps the template's operators and durations; only the numbers and dates move.
  const calledNumber = (n: string) => {
    if (!called.has(n)) called.set(n, n.slice(0, 5) + digits(n.length - 5, rng));
    return called.get(n)!;
  };

  for (const page of doc.getPages()) {
    const widthOf = fontWidths(page);
    let addressIndex = 0;
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        let font = '';
        let size = 0;
        const src = buf.toString('latin1');
        const out = src.replace(
          /\/(\S+) ([\d.]+) Tf|\(((?:[^()\\]|\\.)*)\) Tj/g,
          (match, f: string | undefined, s: string | undefined, lit: string | undefined) => {
            if (f) {
              font = f;
              size = Number(s);
              return match;
            }
            let text = unescapePdf(lit!);
            if (text === TEMPLATE_NAME) text = fields.name;
            else if (TEMPLATE_ADDRESS.includes(text) && addressIndex < ADDRESS_SLOTS)
              text = fields.address[addressIndex++] ?? '';
            else if (/^60\d{9,10}$/.test(text) && !fields.swaps.some(([from]) => from === text))
              text = calledNumber(text);
            else {
              for (const [from, to] of fields.swaps) text = text.split(from).join(to);
              text = shiftDates(text, fields.months);
            }
            const run = `(${escapePdf(text)}) Tj`;
            // A long name or address line would run into the panel beside it, so it
            // is drawn smaller rather than cut. Size is in 1/1000 of the 0.03 scale.
            const width = ((widthOf.get(font)?.(text) ?? 0) * size * 0.03) / 1000;
            const max = customerRunLimit(lit!);
            if (!max || width <= max) return run;
            const fitted = ((size * max) / width).toFixed(2);
            return `/${font} ${fitted} Tf ${run} /${font} ${size.toFixed(2)} Tf`;
          },
        );
        return { data: Buffer.from(out, 'latin1'), count: 1 };
      });
    }
  }
  return doc.save();
}

/** How wide a customer run may be, or null for every other run (left as the template has it). */
function customerRunLimit(literal: string): number | null {
  const text = unescapePdf(literal);
  if (text === TEMPLATE_NAME) return MAX_NAME_WIDTH;
  return TEMPLATE_ADDRESS.includes(text) ? MAX_ADDRESS_WIDTH : null;
}

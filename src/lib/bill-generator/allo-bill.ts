/**
 * Allo bill (ClickUp z8v9xnjav6).
 *
 * The template is a real 2-page Allo invoice printed by BIRT/iText. Every text
 * run sits at its own absolute position (`1 0 0 1 x y cm … (text)Tj`), so a run
 * is found by its page and position. The embedded Crimson Pro fonts are
 * subsets, so the customer's own letters may be missing from them: a changed
 * run is blanked in the stream and redrawn on top in a full Crimson Pro.
 *
 * What changes per bill: name, address, invoice and account numbers, the
 * customer code, the email reference, and the dates (invoice on the 1st of the
 * current month, Malaysia time, due on the 1st of the next). The plan stays
 * Allo Fibre Residential 500Mbps at RM147.35. The account is shown paid up:
 * last month's RM147.35 was paid, nothing is overdue, and the total due is this
 * month's charge. The template's "The resource of this report item is not
 * reachable." (a missing image in the original print) is removed.
 */

import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'fs/promises';
import path from 'path';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { resolveAddressParts, sanitize } from './address-parts';
import { decodeCustomerName } from '../html-entities';
import type { CaseData } from './internet-bill';

type Rng = () => number;
type Align = 'left' | 'center';

const TEMPLATE = path.join(process.cwd(), 'bill_generator', 'template', 'allo_bill.pdf');
const FONT_DIR = path.join(process.cwd(), 'bill_generator', 'fonts');

/** This month's charge, as printed. Every balance on the bill is built from it. */
const CHARGE = '147.35';
/** Widest an address line may run before it reaches the invoice-details column (pt). */
const ADDRESS_WIDTH = 360;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const two = (n: number) => String(n).padStart(2, '0');
const digits = (n: number, rng: Rng) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');

export interface AlloDates {
  /** "1 October 2026" */
  invoice: string;
  due: string;
  /** "01/10/2026 - 31/10/2026" */
  period: string;
}

/** Invoice on the 1st of the current month (Malaysia time), due the 1st of the next, billing the whole month. */
export function alloDates(now = new Date()): AlloDates {
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  const y = myt.getUTCFullYear();
  const m = myt.getUTCMonth();
  const next = new Date(Date.UTC(y, m + 1, 1));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    invoice: `1 ${MONTHS[m]} ${y}`,
    due: `1 ${MONTHS[next.getUTCMonth()]} ${next.getUTCFullYear()}`,
    period: `01/${two(m + 1)}/${y} - ${last}/${two(m + 1)}/${y}`,
  };
}

/** Word wrap by measured width; a word wider than the line stays whole. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && font.widthOfTextAtSize(`${last} ${word}`, size) <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

interface Swap {
  page: number;
  /** The run's position exactly as the stream writes it, "x y". */
  at: string;
  text: string;
  align?: Align;
}

export async function generateAlloBill(
  caseData: CaseData & { email?: string },
  now = new Date(),
  rng: Rng = Math.random,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await readFile(TEMPLATE));
  doc.registerFontkit(fontkit);
  // Embedded whole, not subset: pdf-lib's subsetter can drop glyphs silently.
  const [regular, bold, italic] = await Promise.all(
    ['Regular', 'Bold', 'Italic'].map(async (w) =>
      doc.embedFont(await readFile(path.join(FONT_DIR, `CrimsonPro-${w}.ttf`)), { subset: false }),
    ),
  );
  const fonts: Record<string, PDFFont> = { F1: regular, F2: bold, F3: italic, F4: bold };

  const name = sanitize(decodeCustomerName(caseData.full_name)).toUpperCase();
  const parts = await resolveAddressParts(caseData.full_address, name);
  const locality = [parts.locality, parts.postcode, parts.state, 'Malaysia'].filter(Boolean).join(' , ');
  const street = wrap(parts.streetSegments.join(', '), bold, 9, ADDRESS_WIDTH);

  const dates = alloDates(now);
  const code = `PA${digits(9, rng)}`;
  const invoiceNo = `I${digits(9, rng)}`;
  const ref2 = (caseData.email || '').trim() || (caseData.mobile || '').replace(/\D/g, '');

  const swaps: Swap[] = [
    { page: 0, at: '21.27 633.85', text: name },
    { page: 0, at: '21.27 619.45', text: street[0] ?? '' },
    { page: 0, at: '21.27 592.75', text: locality },
    { page: 0, at: '477.07 619.85', text: invoiceNo },
    { page: 0, at: '477.07 608.35', text: dates.invoice },
    { page: 0, at: '477.07 595.35', text: dates.due },
    { page: 0, at: '477.07 582.35', text: code },
    { page: 0, at: '62.18 517.26', text: CHARGE, align: 'center' },
    { page: 0, at: '181.86 517.26', text: CHARGE, align: 'center' },
    { page: 0, at: '292.58 517.26', text: '0.00', align: 'center' },
    { page: 0, at: '523.7 517.26', text: CHARGE, align: 'center' },
    { page: 0, at: '408.6 502.26', text: dates.due },
    { page: 0, at: '20.55 417.67', text: `A${digits(9, rng)}` },
    { page: 0, at: '106.95 417.67', text: `Recurring fee for dates ${dates.period}` },
    { page: 1, at: '428.1 716.54', text: code },
    { page: 1, at: '428.1 701.54', text: invoiceNo },
    { page: 1, at: '428.1 686.54', text: dates.due },
    { page: 1, at: '143.7 628.79', text: code },
    { page: 1, at: '143.7 613.79', text: ref2 },
    { page: 1, at: '309.3 613.79', text: 'RM 0.00' },
    { page: 1, at: '309.33 530.69', text: `RM ${CHARGE}` },
    { page: 1, at: '325.14 505.29', text: '' },
  ];

  const pages = doc.getPages();
  for (const [index, page] of pages.entries()) {
    const wanted = new Map(swaps.filter((s) => s.page === index).map((s) => [s.at, s]));
    const draws: { swap: Swap; font: PDFFont; size: number; original: string }[] = [];
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        const out = buf.toString('latin1').replace(
          /(\/(F\d+) ([\d.]+) Tf\s*(?:[\d. ]+rg\s*)?1 0 0 1 ([\d.]+ [\d.]+) cm\s*1 0 0 1 0 0 Tm\s*)\(((?:[^()\\]|\\.)*)\)Tj/g,
          (match, head: string, font: string, size: string, at: string, literal: string) => {
            const swap = wanted.get(at);
            if (!swap) return match;
            wanted.delete(at);
            draws.push({ swap, font: fonts[font] ?? regular, size: Number(size), original: literal.replace(/\\(.)/g, '$1') });
            return `${head}()Tj`;
          },
        );
        return { data: Buffer.from(out, 'latin1'), count: 1 };
      });
    }
    // A template that has moved under us must fail loudly, not print the sample customer.
    if (wanted.size) throw new Error(`Allo template runs not found on page ${index + 1}: ${[...wanted.keys()].join(', ')}`);

    for (const { swap, font, size, original } of draws) {
      if (!swap.text) continue;
      const [x, y] = swap.at.split(' ').map(Number);
      const left = swap.align === 'center'
        ? x + (font.widthOfTextAtSize(original, size) - font.widthOfTextAtSize(swap.text, size)) / 2
        : x;
      page.drawText(swap.text, { x: left, y, size, font, color: rgb(0, 0, 0) });
    }
    // A street too long for one line takes the blank line between it and the locality.
    if (index === 0 && street[1]) page.drawText(street.slice(1).join(' '), { x: 21.27, y: 606.1, size: 9, font: bold, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

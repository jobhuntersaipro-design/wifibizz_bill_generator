/**
 * TIME (TT dotCom) internet invoice generator.
 *
 * Takes the four-page sample invoice as a template and replaces the customer,
 * the account and invoice identifiers, the dates and every figure, so the
 * document bills the case's customer for a TIME Fibre Home Broadband 200Mbps
 * line at their installation address.
 *
 * ── Why this generator deletes text instead of covering it ──────────
 *
 * The internet and utility bills paint a white knock-out box over the template's
 * text and draw on top. That technique fails whenever the replacement is wider
 * than the box, because the surplus lands on template content the box never
 * erased — which is the defect the utility bill's address fix chased on
 * 2026-08-22.
 *
 * This template makes a better technique available. Every text run is a plain
 * `(literal)Tj` with an explicit `Tm` matrix — no kerned `TJ` arrays anywhere —
 * so the original literal can simply be removed from the content stream. With
 * nothing underneath, a slightly-too-wide value is merely slightly too wide.
 *
 * ── Why nothing is drawn in the template's own fonts ────────────────
 *
 * All five embedded fonts are subsets with the unused glyph outlines stripped.
 * The face carrying the customer NAME has no `C F G J K P Q U V W X Z`, no
 * digits and no punctuation; the address face is missing `C F G K N Q V X Z 2 3
 * 8 9 . /`. The sample renders only by luck of its own content. So every value
 * this generator writes is drawn in a font it controls: Helvetica for the
 * customer block, whose metrics match the Arial the template used there, and a
 * bundled Work Sans for everything else, which is the family the rest of the
 * page is set in.
 */

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'fs/promises';
import path from 'path';
import { deflateSync } from 'zlib';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { hashSeed, makeRng } from './owner-identity';
import { sanitize } from './address-parts';
import { decodeCustomerName } from '../html-entities';
import {
  buildInvoiceAddress,
  computeInvoiceFields,
  longDate,
  money,
  slashDate,
  PLAN_NAME,
  type TimeInvoiceFields,
} from './time-invoice-fields';
import {
  BARCODE_EXTENTS,
  QR_FORM,
  barcodeContent,
  qrBitmapRgb,
  qrFormContent,
  randomQrModules,
} from './time-artwork';

const TEMPLATE = path.join(process.cwd(), 'bill_generator', 'template', 'time_invoice.pdf');
const FONT_DIR = path.join(process.cwd(), 'bill_generator', 'fonts');

/**
 * The customer block runs from the left margin to well short of the grey summary
 * box on the right. Measured, and the only bound the address is wrapped against.
 */
const ADDRESS_MAX_WIDTH = 300;

type FontKey = 'ws' | 'wsb' | 'helv' | 'helvB';
type Align = 'left' | 'right' | 'center';

interface Draw {
  /** The value to print. */
  text: string;
  x: number;
  y: number;
  size: number;
  font: FontKey;
  align?: Align;
  /**
   * Set only where the template does. Two fields sit inside the black summary
   * box and are drawn white there; redrawing them in the default black makes
   * them vanish into it, which is exactly what happened on the first render.
   */
  white?: boolean;
  /**
   * The template's own value at this position. Right- and centre-aligned fields
   * are positioned by their `Tm` x alone, so the edge has to be recovered from
   * what the template drew there before a different-width value can replace it.
   */
  template?: string;
}

/** Case fields this generator needs. */
export interface TimeInvoiceCase {
  case_no: string;
  full_name: string;
  full_address: string;
}

// ── Content stream editing ─────────────────────────────────────────

function escapeLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Blank every occurrence of an exact text literal on a page.
 *
 * Matching is on the whole `(literal)Tj` token, never on a substring, so
 * removing `108.58` cannot damage `Service Charges of MYR 108.58` — they are
 * separate literals and each is handled on its own terms. The operator is left
 * in place drawing an empty string, which keeps the stream structurally
 * identical to the one the template shipped.
 */
function blankLiterals(pdfDoc: PDFDocument, page: PDFPage, literals: string[]): number {
  let total = 0;
  const targets = literals.map((l) => Buffer.from(`(${escapeLiteral(l)})Tj`, 'latin1'));

  for (const entry of getPageStreamRefs(pdfDoc, page)) {
    total += transformStream(pdfDoc, entry, (buf) => {
      let data = buf;
      let count = 0;
      for (const target of targets) {
        let index = data.indexOf(target);
        while (index !== -1) {
          data = Buffer.concat([
            data.subarray(0, index),
            Buffer.from('()Tj', 'latin1'),
            data.subarray(index + target.length),
          ]);
          count++;
          index = data.indexOf(target, index + 4);
        }
      }
      return { data, count };
    });
  }

  return total;
}

/**
 * Swap a stream object's bytes while keeping every other entry in its dictionary.
 *
 * The XObjects being replaced carry a `BBox` (the form's coordinate space) or a
 * `Width`/`Height`/`ColorSpace`/`SMask` set (the bitmap's). Rebuilding the dict
 * from scratch would lose them and with them the artwork's size and placement,
 * so the original dictionary is cloned and only the byte-level entries change.
 */
function replaceStreamBytes(stream: PDFRawStream, data: Buffer): void {
  const compressed = deflateSync(data);
  const dict = stream.dict;
  dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
  // pdf-lib keeps raw stream bytes on the object itself; the dictionary above is
  // what the file declares about them, and the two must be set together.
  (stream as unknown as { contents: Uint8Array }).contents = compressed;
}

function lookupXObject(page: PDFPage, name: string): PDFRawStream | null {
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return null;
  const obj = xobjects.lookup(PDFName.of(name));
  return obj instanceof PDFRawStream ? obj : null;
}

// ── Draw plans ─────────────────────────────────────────────────────

/** Text on page 1 that this generator replaces. */
function page1Literals(): string[] {
  return [
    '688807230326 10',
    '688807230326  10',
    '688807230326',
    '341341613',
    '02/04/2026',
    'MOHD HELMY BIN ARSHAT',
    'Block A, Level 1, Unit 6, EDUMETRO - THE DUO (TOWER A)',
    'Persiaran Subang Permai,',
    '47500 SubangJaya Selangor',
    'MALAYSIA',
    'MYR 115.09',
    'MYR 115.10',
    '2 May 2026',
    '108.58',
    'Service Tax (6% on Taxable Amount of MYR 108.58)',
    '6.51',
    '115.09',
    '115.10',
  ];
}

function page1Draws(f: TimeInvoiceFields, name: string, address: { street: string[]; locality: string }): Draw[] {
  const total = `MYR ${money(f.totalSen)}`;
  const rounded = `MYR ${money(f.roundedSen)}`;
  const draws: Draw[] = [
    // Header
    { text: `${f.account} 10`, x: 157.57, y: 802.56, size: 8, font: 'ws', align: 'right', template: '688807230326 10' },
    { text: f.invoice, x: 188.01, y: 789.56, size: 8, font: 'ws', align: 'right', template: '341341613' },
    { text: slashDate(f.invoiceDate), x: 180.34, y: 776.56, size: 8, font: 'ws', align: 'right', template: '02/04/2026' },

    // Customer block — Helvetica, matching the Arial the template set it in.
    { text: name, x: 42, y: 701.73, size: 9, font: 'helvB' },

    // Summary boxes
    { text: total, x: 470.52, y: 630.77, size: 11, font: 'wsb', align: 'right', template: 'MYR 115.09' },
    { text: total, x: 364.52, y: 562.77, size: 11, font: 'wsb', align: 'right', template: 'MYR 115.09', white: true },
    { text: longDate(f.dueDate), x: 466.96, y: 562.77, size: 11, font: 'wsb', align: 'right', template: '2 May 2026', white: true },

    // Bill summary
    { text: money(f.subtotalSen), x: 525.17, y: 399.63, size: 9, font: 'ws', align: 'right', template: '108.58' },
    { text: money(f.subtotalSen), x: 524.55, y: 381.63, size: 9, font: 'wsb', align: 'right', template: '108.58' },
    { text: `Service Tax (6% on Taxable Amount of MYR ${money(f.subtotalSen)})`, x: 42, y: 361.63, size: 9, font: 'ws' },
    { text: money(f.taxSen), x: 536.39, y: 361.63, size: 9, font: 'ws', align: 'right', template: '6.51' },
    { text: money(f.totalSen), x: 526.47, y: 342.63, size: 9, font: 'wsb', align: 'right', template: '115.09' },
    { text: total, x: 498.5, y: 321.7, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.09' },

    // Payment slip
    { text: f.account, x: 42, y: 82.7, size: 10, font: 'ws' },
    { text: f.invoice, x: 122, y: 82.7, size: 10, font: 'ws' },
    { text: slashDate(f.invoiceDate), x: 188, y: 82.7, size: 10, font: 'ws' },
    { text: total, x: 383.25, y: 79.57, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.09' },
    { text: rounded, x: 479.26, y: 79.57, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.10' },
    { text: total, x: 368.25, y: 39.57, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.09' },
    { text: rounded, x: 474.26, y: 39.57, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.10' },

    // Barcode captions, centred under their bars.
    { text: `${f.account}  10`, x: 95.87, y: 110.7, size: 7, font: 'ws', align: 'center', template: '688807230326  10' },
    { text: f.invoice, x: 280.38, y: 110.7, size: 7, font: 'ws', align: 'center', template: '341341613' },
    { text: money(f.roundedSen), x: 456.26, y: 110.7, size: 7, font: 'ws', align: 'center', template: '115.10' },
  ];

  // The block is packed downward into the template's four slots rather than each
  // line being pinned to a fixed one. An address with a single street line would
  // otherwise leave a blank row between the street and the postcode, which reads
  // as a missing line rather than a short address.
  //
  // The locality is placed before MALAYSIA and both always draw, so the postcode
  // can never be the line that falls off the end — the failure the utility bill
  // had, where the formatter emitted more lines than the page had slots and
  // silently dropped the last one, which was the state.
  const slots = [688.56, 676.56, 663.56, 650.56];
  const block = [...address.street.slice(0, 2), address.locality, 'MALAYSIA'].filter(Boolean);
  block.slice(0, slots.length).forEach((line, i) => {
    draws.push({ text: line, x: 42, y: slots[i], size: 9, font: 'helv' });
  });

  return draws;
}

function page2Draws(f: TimeInvoiceFields): Draw[] {
  return [
    // JomPAY references. Ref-1 is the account with its `10` suffix and no space,
    // exactly as the template writes it.
    { text: `${f.account}10`, x: 318, y: 100.61, size: 7, font: 'helv' },
    { text: f.invoice, x: 318, y: 92.61, size: 7, font: 'helv' },
  ];
}

function page3Draws(f: TimeInvoiceFields): Draw[] {
  const subtotal = money(f.subtotalSen);
  return [
    { text: f.serviceNo, x: 122, y: 753.28, size: 8.3, font: 'wsb' },
    {
      text: `${PLAN_NAME} (${slashDate(f.proStart)} - ${slashDate(f.proEnd)})`,
      x: 62, y: 725.7, size: 10, font: 'ws',
    },
    { text: money(f.proratedSen), x: 532.19, y: 725.7, size: 10, font: 'ws', align: 'right', template: '9.58' },
    {
      text: `${PLAN_NAME} (${slashDate(f.periodStart)} - ${slashDate(f.periodEnd)})`,
      x: 62, y: 695.7, size: 10, font: 'ws',
    },
    { text: money(f.monthlySen), x: 525.56, y: 695.7, size: 10, font: 'ws', align: 'right', template: '99.00' },
    { text: `MYR ${subtotal}`, x: 496.37, y: 657.07, size: 10, font: 'wsb', align: 'right', template: 'MYR 108.58' },
    { text: `Service Charges of MYR ${subtotal}`, x: 57, y: 618.7, size: 10, font: 'ws' },
    { text: `MYR ${subtotal}`, x: 496.37, y: 615.7, size: 10, font: 'wsb', align: 'right', template: 'MYR 108.58' },
    // The template's own spacing is inconsistent here — `MYR 108.58` on one line
    // and `MYR108.58` on the next. Both are reproduced as it has them.
    { text: `6% on Taxable Amount of MYR${subtotal}`, x: 57, y: 580.7, size: 10, font: 'ws' },
    { text: `MYR ${money(f.taxSen)}`, x: 509.06, y: 580.7, size: 10, font: 'wsb', align: 'right', template: 'MYR 6.51' },
    { text: `MYR ${money(f.totalSen)}`, x: 498.5, y: 562.57, size: 10, font: 'wsb', align: 'right', template: 'MYR 115.09' },
  ];
}

// ── Generation ─────────────────────────────────────────────────────

/**
 * Build the TIME invoice for a case.
 *
 * `now` is injectable so the date rules can be tested across a whole year rather
 * than on whichever day the suite happens to run.
 */
export async function generateTimeInvoice(
  caseData: TimeInvoiceCase,
  now = new Date(),
): Promise<Uint8Array> {
  const fields = computeInvoiceFields(caseData.case_no, now);

  const pdfDoc = await PDFDocument.load(await readFile(TEMPLATE));
  pdfDoc.registerFontkit(fontkit);

  // Embedded whole rather than subset. pdf-lib's subsetter is known to drop
  // characters silently while passing every structural check — the Great Vibes
  // finding from the authorization letter — and a missing glyph here is exactly
  // the failure this generator exists to avoid. The cost is file size.
  const [wsRegular, wsSemiBold] = await Promise.all([
    readFile(path.join(FONT_DIR, 'WorkSans-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'WorkSans-SemiBold.ttf')),
  ]);

  const fonts: Record<FontKey, PDFFont> = {
    ws: await pdfDoc.embedFont(wsRegular, { subset: false }),
    wsb: await pdfDoc.embedFont(wsSemiBold, { subset: false }),
    helv: await pdfDoc.embedFont(StandardFonts.Helvetica),
    helvB: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const customerName = decodeCustomerName(caseData.full_name);
  const name = sanitize(customerName).toUpperCase();
  const address = await buildInvoiceAddress(
    caseData.full_address,
    customerName,
    (text) => fonts.helv.widthOfTextAtSize(text, 9),
    ADDRESS_MAX_WIDTH,
  );

  const pages = pdfDoc.getPages();

  blankLiterals(pdfDoc, pages[0], page1Literals());
  blankLiterals(pdfDoc, pages[1], ['68880723032610', '341341613']);
  blankLiterals(pdfDoc, pages[2], [
    'TBBNB179323G_0350205456',
    `${PLAN_NAME} (30/03/2026 - 01/04/2026)`,
    `${PLAN_NAME} (02/04/2026 - 01/05/2026)`,
    '9.58',
    '99.00',
    'MYR 108.58',
    'Service Charges of MYR 108.58',
    '6% on Taxable Amount of MYR108.58',
    'MYR 6.51',
    'MYR 115.09',
  ]);

  drawAll(pages[0], page1Draws(fields, name, address), fonts);
  drawAll(pages[1], page2Draws(fields), fonts);
  drawAll(pages[2], page3Draws(fields), fonts);

  replaceArtwork(pages[0], caseData.case_no);

  return pdfDoc.save();
}

function drawAll(page: PDFPage, draws: Draw[], fonts: Record<FontKey, PDFFont>): void {
  for (const draw of draws) {
    const font = fonts[draw.font];
    let x = draw.x;

    if (draw.align === 'right' && draw.template) {
      const rightEdge = draw.x + font.widthOfTextAtSize(draw.template, draw.size);
      x = rightEdge - font.widthOfTextAtSize(draw.text, draw.size);
    } else if (draw.align === 'center' && draw.template) {
      const centre = draw.x + font.widthOfTextAtSize(draw.template, draw.size) / 2;
      x = centre - font.widthOfTextAtSize(draw.text, draw.size) / 2;
    }

    page.drawText(draw.text, {
      x,
      y: draw.y,
      size: draw.size,
      font,
      ...(draw.white ? { color: rgb(1, 1, 1) } : {}),
    });
  }
}

/**
 * Replace the payment slip's barcodes and both QR codes with random artwork.
 *
 * Seeded on the case number like everything else, so re-downloading an invoice
 * does not quietly produce a different-looking one. A failure to find any single
 * XObject is survivable: the invoice is still correct in every figure it prints,
 * and losing it over decoration would be the wrong trade.
 */
function replaceArtwork(page: PDFPage, caseNo: string): void {
  const rng = makeRng(hashSeed(`time-artwork:${caseNo}`));

  const vectorQr = lookupXObject(page, 'Xf1');
  if (vectorQr) {
    replaceStreamBytes(
      vectorQr,
      Buffer.from(qrFormContent(randomQrModules(QR_FORM.modules, rng)), 'latin1'),
    );
  }

  for (const [name, extent] of Object.entries(BARCODE_EXTENTS)) {
    const barcode = lookupXObject(page, name);
    if (barcode) {
      replaceStreamBytes(barcode, Buffer.from(barcodeContent(extent, rng), 'latin1'));
    }
  }

  const bitmapQr = lookupXObject(page, 'img3');
  if (bitmapQr) {
    replaceStreamBytes(bitmapQr, qrBitmapRgb(rng));
  }
}

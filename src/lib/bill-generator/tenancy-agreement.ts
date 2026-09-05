/**
 * Tenancy Agreement PDF generator.
 *
 * There is no template in the repo to stamp, so the pages are drawn from scratch
 * with pdf-lib — the same stack the authorization letter uses. Layout follows a
 * standard 13-page Malaysian residential tenancy with a First Schedule.
 *
 * Nothing here is stored. The landlord is generated fresh on every call.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { wrapToWidth } from './authorization-letter';
import { generateRandomLandlord, type OwnerIdentity } from './owner-identity';
import { drawSignature, FLOURISH_DESCENT, SIGNATURE_ASCENT } from './signature';
import { agreementBlocks, firstScheduleRows, type Block } from './tenancy-clauses';
import {
  buildTenancyFields,
  type TenancyCaseData,
  type TenancyFields,
} from './tenancy-fields';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 58;
const MARGIN_BOTTOM = 52;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const FONT_SIZE = 10.5;
const HEADING_SIZE = 11.5;
const TITLE_SIZE = 16;
const LINE_H = 14.6;
const HEADING_GAP = 8;

const INK = rgb(0.08, 0.1, 0.14);

export type { TenancyCaseData };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

class Paginator {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private fonts: Fonts,
  ) {
    this.addPage();
  }

  addPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN_TOP;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN_BOTTOM) this.addPage();
  }

  text(
    line: string,
    opts: { font?: PDFFont; size?: number; x?: number; center?: boolean } = {},
  ): void {
    const size = opts.size ?? FONT_SIZE;
    const font = opts.font ?? this.fonts.regular;
    this.ensure(LINE_H);
    let x = opts.x ?? MARGIN_X;
    if (opts.center) {
      x = (PAGE_W - font.widthOfTextAtSize(line, size)) / 2;
    }
    this.page.drawText(line, { x, y: this.y, size, font, color: INK });
    this.y -= LINE_H;
  }

  para(text: string, opts: { font?: PDFFont; size?: number; indent?: number } = {}): void {
    const size = opts.size ?? FONT_SIZE;
    const font = opts.font ?? this.fonts.regular;
    const indent = opts.indent ?? 0;
    const width = CONTENT_W - indent;
    for (const line of wrapToWidth(text, font, size, width)) {
      this.text(line, { font, size, x: MARGIN_X + indent });
    }
  }

  heading(text: string): void {
    this.y -= HEADING_GAP;
    this.ensure(LINE_H + 4);
    this.text(text, { font: this.fonts.bold, size: HEADING_SIZE });
    const underlineY = this.y + LINE_H - 2;
    this.page.drawLine({
      start: { x: MARGIN_X, y: underlineY },
      end: { x: MARGIN_X + this.fonts.bold.widthOfTextAtSize(text, HEADING_SIZE), y: underlineY },
      thickness: 0.5,
      color: INK,
    });
    this.y -= 2;
  }

  clause(ref: string, text: string): void {
    const label = `${ref}  `;
    const labelW = this.fonts.bold.widthOfTextAtSize(label, FONT_SIZE);
    const lines = wrapToWidth(text, this.fonts.regular, FONT_SIZE, CONTENT_W - labelW);
    if (lines.length === 0) return;
    this.ensure(LINE_H);
    this.page.drawText(label, {
      x: MARGIN_X,
      y: this.y,
      size: FONT_SIZE,
      font: this.fonts.bold,
      color: INK,
    });
    this.page.drawText(lines[0], {
      x: MARGIN_X + labelW,
      y: this.y,
      size: FONT_SIZE,
      font: this.fonts.regular,
      color: INK,
    });
    this.y -= LINE_H;
    for (const line of lines.slice(1)) {
      this.text(line, { x: MARGIN_X + labelW });
    }
    this.y -= 2;
  }

  gap(multiple = 1): void {
    this.y -= LINE_H * multiple;
  }
}

function drawBlocks(pager: Paginator, fonts: Fonts, blocks: Block[]): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'title':
        pager.text(block.text, { font: fonts.bold, size: TITLE_SIZE, center: true });
        break;
      case 'center':
        pager.text(block.text, { font: fonts.regular, size: FONT_SIZE, center: true });
        break;
      case 'para':
        pager.para(block.text);
        pager.gap(0.35);
        break;
      case 'heading':
        pager.heading(block.text);
        break;
      case 'clause':
        pager.clause(block.ref, block.text);
        break;
      case 'gap':
        pager.gap(0.6);
        break;
      case 'page-break':
        pager.addPage();
        break;
    }
  }
}

const SIGN_LINE_W = 200;
const SIGN_W = 160;
const SIGN_H = 20;

function drawSignatures(pager: Paginator, fonts: Fonts, fields: TenancyFields): void {
  pager.addPage();
  pager.heading('EXECUTION');
  pager.para(
    'SIGNED by the Landlord and the Tenant the day and year first above written.',
  );
  pager.gap(0.8);
  pager.text('SIGNED by the Landlord', { font: fonts.bold });
  pager.gap((SIGN_H * SIGNATURE_ASCENT) / LINE_H);
  const landlordLineY = pager.y + LINE_H * 0.3;
  drawSignature(pager.page, fields.landlordName, {
    x: MARGIN_X + 8,
    y: landlordLineY + 2,
    width: SIGN_W,
    height: SIGN_H,
  });
  pager.page.drawLine({
    start: { x: MARGIN_X, y: landlordLineY },
    end: { x: MARGIN_X + SIGN_LINE_W, y: landlordLineY },
    thickness: 0.7,
    color: INK,
  });
  pager.gap(FLOURISH_DESCENT / LINE_H + 0.45);
  pager.text(`Name: ${fields.landlordName}`);
  pager.text(`NRIC No.: ${fields.landlordIc}`);
  pager.gap(1.2);

  pager.ensure(SIGN_H * SIGNATURE_ASCENT + LINE_H * 6 + FLOURISH_DESCENT);
  pager.text('SIGNED by the Tenant', { font: fonts.bold });
  pager.gap((SIGN_H * SIGNATURE_ASCENT) / LINE_H);
  const tenantLineY = pager.y + LINE_H * 0.3;
  drawSignature(pager.page, fields.tenantName, {
    x: MARGIN_X + 8,
    y: tenantLineY + 2,
    width: SIGN_W,
    height: SIGN_H,
  });
  pager.page.drawLine({
    start: { x: MARGIN_X, y: tenantLineY },
    end: { x: MARGIN_X + SIGN_LINE_W, y: tenantLineY },
    thickness: 0.7,
    color: INK,
  });
  pager.gap(FLOURISH_DESCENT / LINE_H + 0.45);
  pager.text(`Name: ${fields.tenantName}`);
  if (fields.tenantIc) pager.text(`NRIC No.: ${fields.tenantIc}`);
  pager.gap(1.4);
  pager.ensure(LINE_H * 8);
  pager.text('In the presence of:', { font: fonts.bold });
  pager.gap(2.2);
  pager.page.drawLine({
    start: { x: MARGIN_X, y: pager.y },
    end: { x: MARGIN_X + SIGN_LINE_W, y: pager.y },
    thickness: 0.7,
    color: INK,
  });
  pager.gap(0.4);
  pager.text('Witness signature');
  pager.text('Name: ________________________________');
  pager.text('NRIC No.: ____________________________');
}

function drawSchedule(pager: Paginator, fonts: Fonts, fields: TenancyFields): void {
  pager.addPage();
  pager.text('FIRST SCHEDULE', { font: fonts.bold, size: TITLE_SIZE, center: true });
  pager.text('(which is to be read as part of this Agreement)', {
    font: fonts.regular,
    size: FONT_SIZE,
    center: true,
  });
  pager.gap(0.8);

  const itemW = 28;
  const labelW = 148;
  const valueX = MARGIN_X + itemW + labelW;
  const valueW = CONTENT_W - itemW - labelW;

  for (const row of firstScheduleRows(fields)) {
    const valueLines = row.value.split('\n').flatMap((part) =>
      wrapToWidth(part, fonts.regular, FONT_SIZE, valueW),
    );
    const labelLines = wrapToWidth(row.label, fonts.bold, FONT_SIZE, labelW - 8);
    const height = Math.max(valueLines.length, labelLines.length) * LINE_H + 8;
    pager.ensure(height);
    const top = pager.y;
    pager.page.drawText(row.item + '.', {
      x: MARGIN_X,
      y: top,
      size: FONT_SIZE,
      font: fonts.bold,
      color: INK,
    });
    for (let i = 0; i < labelLines.length; i++) {
      pager.page.drawText(labelLines[i], {
        x: MARGIN_X + itemW,
        y: top - i * LINE_H,
        size: FONT_SIZE,
        font: fonts.bold,
        color: INK,
      });
    }
    for (let i = 0; i < valueLines.length; i++) {
      pager.page.drawText(valueLines[i], {
        x: valueX,
        y: top - i * LINE_H,
        size: FONT_SIZE,
        font: fonts.regular,
        color: INK,
      });
    }
    pager.y = top - height + 4;
    pager.page.drawLine({
      start: { x: MARGIN_X, y: pager.y + 6 },
      end: { x: PAGE_W - MARGIN_X, y: pager.y + 6 },
      thickness: 0.3,
      color: rgb(0.75, 0.77, 0.8),
    });
  }
}

function stampFooters(pages: PDFPage[], font: PDFFont): void {
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const label = `Tenancy Agreement  ·  Page ${i + 1} of ${total}`;
    const width = font.widthOfTextAtSize(label, 8);
    pages[i].drawText(label, {
      x: (PAGE_W - width) / 2,
      y: 28,
      size: 8,
      font,
      color: rgb(0.35, 0.38, 0.42),
    });
  }
}

export async function generateTenancyAgreement(
  caseData: TenancyCaseData,
  now: Date = new Date(),
  landlord?: OwnerIdentity,
): Promise<Uint8Array> {
  const owner = landlord ?? generateRandomLandlord(now, Math.random, caseData.full_name);
  const fields = buildTenancyFields(caseData, owner, now);

  const pdfDoc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const pager = new Paginator(pdfDoc, fonts);
  drawBlocks(pager, fonts, agreementBlocks(fields));
  drawSignatures(pager, fonts, fields);
  drawSchedule(pager, fonts, fields);
  stampFooters(pager.pages, fonts.regular);

  return pdfDoc.save();
}

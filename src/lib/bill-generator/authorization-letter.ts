/**
 * Authorization Letter PDF generator.
 *
 * A property owner confirming to TM that the case customer resides at the
 * installation address. Unlike the internet and utility bills there is no
 * template to overlay — the page is plain text, so it is drawn from scratch.
 *
 * Layout and wording follow `Sample Authorization Letter Template.pdf`.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  resolveAddressParts,
  sanitize,
  type AddressParts,
} from './address-parts';
import { formatIcDashed, icDigits } from './owner-identity';
import { createDocumentParties, partyFilled, type DocumentParties } from './document-parties';
import type { SignatureImage } from './landlord-signature';
import { effectiveDate, longDate, ordinalDate, slashDate } from './letter-dates';
import { drawSignature, FLOURISH_DESCENT, SIGNATURE_ASCENT } from './signature';

export interface LetterGenerateExtras {
  parties?: DocumentParties;
  signature?: SignatureImage | null;
  rng?: () => number;
}

// ── Page geometry (A4) ─────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2; // 451.28pt
const FONT_SIZE = 11;
const LINE_H = 14;

// The recipient never varies.
const TM_BLOCK = [
  'TM PERSON IN CHARGE',
  'MENARA TM',
  'JALAN PANTAI BHARU',
  '50762 KUALA LUMPUR',
  'WILAYAH PERSEKUTUAN',
];

const SUBJECT = 'Subject: Authorization Letter to confirm on the Residence Information';

// `sanitize` lives in ./address-parts now that the invoice needs it too. It stays
// exported from here because callers and tests already import it from this module.
export { sanitize };
export type { AddressParts };

/**
 * Break text to a measured width. Measured, never character-counted — counting
 * characters is what pushed the utility bill's masked name past its box, because
 * an 'X' is more than twice the width of a space.
 */
export function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface LetterAddress {
  /** Stacked letterhead lines, street first, state last. */
  block: string[];
  /** The same address comma-joined, for the body sentence. */
  inline: string;
}

/**
 * Split the case address into the letterhead block and the inline form.
 *
 * `normalizeAddress` is used only for its parsed postcode / city / state — the
 * parts that must look clean. The street portion is taken from the raw address
 * up to the postcode, which preserves unit prefixes (`A-12-3`) that the parsed
 * components drop.
 *
 * Inherited and not fixed here: the state matcher removes the first occurrence
 * of a state name anywhere in the string, so a city containing one is mangled
 * (`81200 JOHOR BAHRU JOHOR` → `81200 BAHRU JOHOR`). That fix is wider than this
 * letter.
 */
export async function buildLetterAddress(rawAddress: string, fullName: string): Promise<LetterAddress> {
  const { streetSegments, postcode, locality, state, hasTail } = await resolveAddressParts(
    rawAddress,
    fullName,
  );
  if (streetSegments.length === 0 && !hasTail) return { block: [], inline: '' };

  const block: string[] = packStreetLines(streetSegments);
  const inlineParts = [...streetSegments];

  if (hasTail) {
    const localityLine = [postcode, locality].filter(Boolean).join(' ');
    if (localityLine) {
      block.push(localityLine.toUpperCase());
      inlineParts.push(localityLine.toUpperCase());
    }
    if (state) {
      block.push(state.toUpperCase());
      inlineParts.push(state.toUpperCase());
    }
  }

  return { block: block.map((l) => l.toUpperCase()), inline: inlineParts.join(', ').toUpperCase() };
}





// A segment starting with one of these names a housing area rather than a street,
// and the sample letter starts a new line there: "80, JALAN BESAR LUKUT, BATU 4"
// then "TAMAN LUKUT JAYA".
const LOCALITY_KEYWORDS = [
  'TAMAN', 'TMN', 'KAMPUNG', 'KG', 'DESA', 'BANDAR', 'FELDA', 'LADANG',
  'PEKAN', 'PERUMAHAN', 'RESIDENSI', 'FLAT', 'BLOK',
];

function startsLocality(segment: string): boolean {
  const first = segment.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return LOCALITY_KEYWORDS.includes(first.replace(/[.,]/g, ''));
}

/**
 * Comma segments packed into letterhead lines rather than one line each — a
 * house number alone on its own line does not read as an address.
 */
export function packStreetLines(segments: string[]): string[] {
  const lines: string[] = [];
  let current: string[] = [];

  for (const segment of segments) {
    if (current.length && startsLocality(segment)) {
      lines.push(current.join(', '));
      current = [];
    }
    current.push(segment);
  }
  if (current.length) lines.push(current.join(', '));
  return lines;
}

/** A cursor that draws top-down so the layout reads in the order the page does. */
class Cursor {
  y: number;
  constructor(private page: PDFPage, private font: PDFFont, startY: number) {
    this.y = startY;
  }
  text(line: string, opts: { font?: PDFFont; size?: number; x?: number } = {}): void {
    this.page.drawText(line, {
      x: opts.x ?? MARGIN,
      y: this.y,
      size: opts.size ?? FONT_SIZE,
      font: opts.font ?? this.font,
      color: rgb(0, 0, 0),
    });
    this.y -= LINE_H;
  }
  lines(list: string[], opts: { font?: PDFFont } = {}): void {
    for (const line of list) this.text(line, opts);
  }
  gap(multiple = 1): void {
    this.y -= LINE_H * multiple;
  }
}

/**
 * What the letter needs from a case. Narrower than the bills' `CaseData`: no
 * mobile number appears on the letter, and the ID number — which the bills never
 * use — is required, because a residence letter whose resident has no IC is not
 * worth handing to TM.
 */
export interface LetterCaseData {
  case_no: string;
  full_name: string;
  full_address: string;
  id_no: string;
}

export async function generateAuthorizationLetter(
  caseData: LetterCaseData,
  now: Date = new Date(),
  extras?: LetterGenerateExtras,
): Promise<Uint8Array> {
  const customerName = sanitize(caseData.full_name || '');
  const customerIc = icDigits(caseData.id_no || '');
  const rng = extras?.rng ?? Math.random;
  const generated = extras?.parties && partyFilled(extras.parties.landlord)
    ? extras.parties
    : createDocumentParties(now, rng, customerName);
  const fallback = partyFilled(generated.landlordWitness) && partyFilled(generated.tenantWitness)
    ? generated
    : createDocumentParties(now, rng, customerName);
  const parties: DocumentParties = {
    landlord: partyFilled(generated.landlord) ? generated.landlord : fallback.landlord,
    landlordWitness: partyFilled(generated.landlordWitness)
      ? generated.landlordWitness
      : fallback.landlordWitness,
    tenantWitness: partyFilled(generated.tenantWitness)
      ? generated.tenantWitness
      : fallback.tenantWitness,
  };
  const landlord = parties.landlord;
  const address = await buildLetterAddress(caseData.full_address || '', customerName);
  const effective = effectiveDate(caseData.case_no, now);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cur = new Cursor(page, font, PAGE_H - MARGIN);

  cur.text(landlord.name.toUpperCase());
  // Wrapped, not printed as-is: a portal address with no commas is one long
  // segment, and an unwrapped letterhead line runs straight off the page.
  for (const line of address.block) {
    cur.lines(wrapToWidth(line, font, FONT_SIZE, CONTENT_W));
  }

  // Horizontal rule between the sender and the recipient.
  cur.gap(1);
  page.drawLine({
    start: { x: MARGIN, y: cur.y + LINE_H * 0.4 },
    end: { x: PAGE_W - MARGIN, y: cur.y + LINE_H * 0.4 },
    thickness: 0.8,
    color: rgb(0, 0, 0),
  });
  cur.gap(1);

  // ── Recipient ────────────────────────────────────────────────────
  cur.lines(TM_BLOCK);
  cur.gap(1);

  cur.text(ordinalDate(now));
  cur.gap(1);

  cur.text('To Whom it may concern,');
  cur.gap(1);

  // ── Subject: bold, and underlined with a measured rule ───────────
  const subjectY = cur.y;
  cur.text(SUBJECT, { font: bold });
  page.drawLine({
    start: { x: MARGIN, y: subjectY - 2 },
    end: { x: MARGIN + bold.widthOfTextAtSize(SUBJECT, FONT_SIZE), y: subjectY - 2 },
    thickness: 0.7,
    color: rgb(0, 0, 0),
  });
  cur.gap(1);

  // ── Body ─────────────────────────────────────────────────────────
  const premise = address.inline ? `${address.inline}, MALAYSIA` : 'MALAYSIA';
  const body =
    `I hereby authorize ${customerName} with ${customerIc} is the resident at my premise ` +
    `located at ${premise}. effective ${longDate(effective)}.`;
  cur.lines(wrapToWidth(sanitize(body), font, FONT_SIZE, CONTENT_W));
  cur.gap(1);

  cur.text('Herewith attached my Utilities bill for your further reference.');
  cur.gap(2);

  // ── Signature blocks ─────────────────────────────────────────────
  await drawSignatureBlock(page, pdfDoc, cur, font, {
    heading: 'Property Owner Signature,',
    signer: landlord.name,
    ic: landlord.nric,
    date: slashDate(now),
    witnessName: parties.landlordWitness.name,
    witnessNric: parties.landlordWitness.nric,
    landlordImage: extras?.signature ?? null,
  });
  cur.gap(1.5);
  await drawSignatureBlock(page, pdfDoc, cur, font, {
    heading: 'Resident Signature,',
    signer: customerName,
    ic: formatIcDashed(customerIc),
    date: slashDate(now),
    witnessName: parties.tenantWitness.name,
    witnessNric: parties.tenantWitness.nric,
  });

  cur.gap(1.5);
  cur.text('Thank you and best regards.');

  return pdfDoc.save();
}

const SIGNATURE_LINE_W = 150;
const SIGNATURE_W = 142;
// Cap height of the writing, not the height of the whole mark — the opening
// gesture reaches about twice this and the flourish descends below the line.
const SIGNATURE_H = 20;

async function drawSignatureBlock(
  page: PDFPage,
  pdfDoc: PDFDocument,
  cur: Cursor,
  font: PDFFont,
  block: {
    heading: string;
    signer: string;
    ic: string;
    date: string;
    witnessName: string;
    witnessNric: string;
    landlordImage?: SignatureImage | null;
  },
): Promise<void> {
  cur.text(block.heading);

  // Clear the heading. The mark is drawn upward from the line and its opening
  // gesture reaches well past one cap height, so reserve what the signature says
  // it may use rather than guessing from the type size.
  cur.gap((SIGNATURE_H * SIGNATURE_ASCENT) / LINE_H + 0.2);

  const lineY = cur.y + LINE_H * 0.35;
  const isLandlordBlock = block.landlordImage !== undefined;
  if (isLandlordBlock) {
    if (block.landlordImage) {
      await drawLandlordSignatureOnLetter(pdfDoc, page, block.landlordImage, {
        x: MARGIN + 6,
        y: lineY + 2,
      });
    }
  } else {
    drawSignature(page, block.signer, {
      x: MARGIN + 6,
      y: lineY + 2,
      width: SIGNATURE_W,
      height: SIGNATURE_H,
    });
  }

  page.drawLine({
    start: { x: MARGIN, y: lineY },
    end: { x: MARGIN + SIGNATURE_LINE_W, y: lineY },
    thickness: 0.8,
    color: rgb(0, 0, 0),
  });

  // Flourishes reach below the line — a ring thrown round the name, a serpentine
  // sweeping back under it. Reserve exactly what the signature is allowed to use,
  // or the sweep lands on top of the IC number.
  cur.gap(FLOURISH_DESCENT / LINE_H + 0.35);

  cur.text(`IC number: ${block.ic}`);
  cur.text(`Date: ${block.date}`);
  cur.text(`Witness Name: ${block.witnessName}`);
  cur.text(`Witness NRIC: ${block.witnessNric}`);
}

async function drawLandlordSignatureOnLetter(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: SignatureImage,
  at: { x: number; y: number },
): Promise<boolean> {
  try {
    const embedded = image.mime === 'image/png'
      ? await pdfDoc.embedPng(image.bytes)
      : await pdfDoc.embedJpg(image.bytes);
    const maxW = SIGNATURE_W;
    const maxH = SIGNATURE_H * SIGNATURE_ASCENT;
    const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, {
      x: at.x,
      y: at.y,
      width,
      height,
    });
    return true;
  } catch (error) {
    console.error(
      'auth letter landlord signature skipped:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

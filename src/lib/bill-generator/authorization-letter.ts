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
import { normalizeAddress, type UtilityAddressResult } from './address-normalizer';
import postcodeTable from '../malaysia-postcodes.json';
import { generateOwner, formatIcDashed, icDigits } from './owner-identity';
import { effectiveDate, longDate, ordinalDate, slashDate } from './letter-dates';
import { drawSignature, FLOURISH_DESCENT, SIGNATURE_ASCENT } from './signature';

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

/**
 * pdf-lib's standard fonts encode Latin-1 only, and a character outside it
 * throws. Map the punctuation that actually turns up in portal addresses to its
 * ASCII equivalent and drop anything else, so a stray en-dash costs a character
 * rather than the whole letter.
 */
export function sanitize(text: string): string {
  return (text || '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const raw = sanitize(rawAddress);
  if (!raw) return { block: [], inline: '' };

  let components: UtilityAddressResult['components'] = {};
  try {
    const result = (await normalizeAddress(raw, 'utility', fullName)) as UtilityAddressResult;
    components = result.components ?? {};
  } catch {
    // A geocoding failure must not cost the letter — fall through to the raw string.
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
  // and the letter should say what the customer's address says.
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
    // still sitting in the street text, and the letterhead would print each of
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

/** True when `part` is a whole-word fragment of `whole` — "KINABALU" of "KOTA KINABALU". */
function isFragmentOf(part: string, whole: string): boolean {
  const p = part.trim().toUpperCase();
  const w = whole.trim().toUpperCase();
  if (p === w) return true;
  return new RegExp(`(^|\\s)${escapeRegExp(p)}($|\\s)`).test(w);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Peel the city, state and country off the end of the street text.
 *
 * Repeated because they stack — `… KOTA KINABALU SABAH MALAYSIA` sheds three
 * tails, and stopping after one leaves the letterhead printing the state twice.
 */
function stripTrailingLocality(text: string, tails: (string | undefined)[]): string {
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
 * reach the letter.
 */
function dropEmptySegments(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token !== '-' && token !== '--' && token !== ',')
    .join(' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(^[,\s-]+)|([,\s-]+$)/g, '')
    .trim();
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
  now: Date = new Date()
): Promise<Uint8Array> {
  const customerName = sanitize(caseData.full_name || '');
  const customerIc = icDigits(caseData.id_no || '');
  const owner = generateOwner(caseData.case_no, customerName, now);
  const address = await buildLetterAddress(caseData.full_address || '', customerName);
  const effective = effectiveDate(caseData.case_no, now);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cur = new Cursor(page, font, PAGE_H - MARGIN);

  // ── Letterhead: the owner, at the premise they own ───────────────
  cur.text(owner.name.toUpperCase());
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
  drawSignatureBlock(page, cur, font, {
    heading: 'Property Owner Signature,',
    signer: owner.name,
    ic: formatIcDashed(owner.ic),
    date: slashDate(now),
  });
  cur.gap(1.5);
  drawSignatureBlock(page, cur, font, {
    heading: 'Resident Signature,',
    signer: customerName,
    ic: formatIcDashed(customerIc),
    date: slashDate(now),
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

function drawSignatureBlock(
  page: PDFPage,
  cur: Cursor,
  font: PDFFont,
  block: { heading: string; signer: string; ic: string; date: string }
): void {
  cur.text(block.heading);

  // Clear the heading. The mark is drawn upward from the line and its opening
  // gesture reaches well past one cap height, so reserve what the signature says
  // it may use rather than guessing from the type size.
  cur.gap((SIGNATURE_H * SIGNATURE_ASCENT) / LINE_H + 0.2);

  const lineY = cur.y + LINE_H * 0.35;
  drawSignature(page, block.signer, {
    x: MARGIN + 6,
    y: lineY + 2,
    width: SIGNATURE_W,
    height: SIGNATURE_H,
  });

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
}

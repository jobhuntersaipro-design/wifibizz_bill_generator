/**
 * Biz Auth Letter — the business authorisation letter.
 *
 * A company confirming its director, and authorising a TM Authorised Agent to
 * act for it on a Unifi Business application. Layout and wording follow the
 * supplied `EXAMPLE - FORMAT AL` template verbatim.
 *
 * This is NOT the residential `authorization-letter.ts`, which is a property
 * owner confirming that somebody lives at an address. The two are selected by
 * plan type and never both offered: see `generatableDocTypes`.
 *
 * The director is the one WifiBizz records (see `resolveBizDirector`). Three
 * things are left visually empty on purpose: the authorised representative's
 * name and IC, and the company chop. The agent is never pre-assigned and no chop
 * is stamped.
 *
 * The DIRECTOR's signature line carries a random image from the admin pool at
 * /admin/landlord-signature (the pool the tenancy agreement and the residential
 * letter draw from), seeded on the director — but only when the case names one.
 * WifiBizz case data is generated, not real people, so this signs for nobody
 * real. An empty pool or a bad image leaves the line blank, never fails.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BusinessSignals } from '../case-kind';
import { companyLine, resolveBizCompany, resolveBizDirector } from '../biz-director';
import { decodeCustomerName } from '../html-entities';
import { dropEmptySegments, escapeRegExp, resolveAddressParts, sanitize } from './address-parts';
import { packStreetLines, wrapToWidth } from './authorization-letter';
import { longDate } from './letter-dates';
import postcodeTable from '../malaysia-postcodes.json';
import type { SignatureImage } from './landlord-signature';

// Re-exported because the letter is where callers and tests already import it
// from; the rule itself is shared with the Bizz Chat and lives in biz-director.
export { companyLine };

// ── Page geometry (A4) ─────────────────────────────────────────────
// Tighter than the residential letter's: this template carries roughly fifty
// lines, and at that letter's 72pt margin / 14pt leading the footer falls off
// the page. A test pins a worst-case input staying on one sheet.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 64;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FONT_SIZE = 10.5;
const LINE_H = 13.5;
const BULLET_INDENT = 18;
// The footer leaves three blank lines (40.5pt) above the signature rule, so the
// ink is bounded to sit inside that gap rather than climbing into "Yours
// faithfully," above it.
const SIGNATURE_MAX_W = 160;
const SIGNATURE_MAX_H = 36;

/** What the portal itself shows when an agent left the director's Name empty. */
const NO_DIRECTOR = '-';

const TITLE = 'LETTER OF AUTHORISATION FOR TM UNIFI BUSINESS APPLICATION';

const PERMISSIONS = [
  'Submit and manage TM Unifi Business application',
  'Liaise with Telekom Malaysia (TM)',
  'Submit required documents and complete necessary procedures',
];

const VALIDITY = 'This authorisation is valid until the completion of the application process.';

/** What the letter reads off a case row or an order draft. */
export interface BizLetterSource extends BusinessSignals {
  /** The portal's National ID No., printed as the director's IC as-is. */
  id_no?: string | null;
  full_address?: string | null;
  mobile?: string | null;
  /**
   * Stable identity for the case, used only to seed the invented director. The
   * Case List passes `case_no`; Order Entry passes the normalised ID number it
   * already seeds every other generator with.
   */
  case_no?: string | null;
}

/** Every value the template prints, already resolved. Blank means "not known". */
export interface BizLetterFields {
  companyName: string;
  companyReg: string;
  /** `NAME (BRN)`, or just the name, or blank — the header, body and footer all use it. */
  companyLine: string;
  /** The portal's Name, or `-` (its own marker) when it has none. */
  directorName: string;
  /** False when the portal has no name — nobody is named to sign. */
  directorNamed: boolean;
  directorIc: string;
  packageName: string;
  serviceAddress: string;
  contact: string;
}

const present = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * The contact in the template's `+601…` style.
 *
 * A Malaysian number is normalised to `+60…` whether it was stored bare, with a
 * leading zero or already prefixed. Anything else is returned as typed: forcing
 * `+60` onto a foreign number would invent a country code, which the brief
 * forbids.
 */
export function formatContactNumber(raw: string | null | undefined): string {
  const text = present(raw);
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return text;
}

/**
 * Company and BRN resolve through the SAME rules the Bizz Chat uses
 * (`resolveBizzChatFields`), so a customer cannot be one company on the chat and
 * another on the letter. The crawled list view stores a biz customer as
 * `COMPANY(REG)` in `full_name`, which is where the pair comes from when the
 * detail page has not been fetched.
 *
 * The DIRECTOR is the one WifiBizz records, through `resolveBizDirector` — the
 * same resolver the Bizz Chat uses, so the two cannot name different people.
 * The case's original data: a missing name prints the portal's `-`, and the IC
 * prints whatever the case holds. Never invented.
 */
export function resolveBizLetterFields(s: BizLetterSource): BizLetterFields {
  const company = resolveBizCompany(s);
  const director = resolveBizDirector(s);

  return {
    companyName: company.name,
    companyReg: company.reg,
    companyLine: company.line,
    directorName: director.name || NO_DIRECTOR,
    directorNamed: director.name !== '',
    directorIc: director.ic,
    packageName: sanitize(decodeCustomerName(present(s.package))),
    serviceAddress: sanitize(decodeCustomerName(present(s.full_address))).toUpperCase(),
    contact: formatContactNumber(s.mobile),
  };
}

/**
 * The letterhead block: street lines, then `POSTCODE CITY`, then the state —
 *
 *   8 JALAN STR 3
 *   SAUJANA TEKNOLOGI RAWANG
 *   48000 RAWANG
 *   SELANGOR
 *
 * Portal addresses carry no commas; they separate segments with a standalone
 * dash and put the postcode last (`8 JALAN STR 3 - SAUJANA TEKNOLOGI RAWANG
 * RAWANG SELANGOR MALAYSIA 48000`). So each dash segment starts its own line,
 * comma segments within one are packed the way the residential letter packs
 * them, and the city, state and country are peeled off the end.
 *
 * Town and state come from the postcode table — NOT from the address parser,
 * which removes the first state name found anywhere and so turns `81200 JOHOR
 * BAHRU JOHOR` into `81200 BAHRU JOHOR`. The tail is stripped once per name, in
 * portal order, so an area named after its town (`SAUJANA TEKNOLOGI RAWANG` in
 * 48000 RAWANG) keeps its name.
 */
export async function letterheadLines(raw: string | null | undefined): Promise<string[]> {
  const text = sanitize(decodeCustomerName(present(raw))).toUpperCase();
  if (!text) return [];

  const { postcode, locality, state, hasTail } = await resolveAddressParts(text, '');
  // The table's town first: the parsed one inherits the state-matcher bug
  // (`JOHOR BAHRU, JOHOR` parses as `BAHRU JOHOR`) and drops leading words
  // (`SIMPANG AMPAT` as `AMPAT`). The table's is the post office's own name.
  const fromTable = postcode ? (postcodeTable as Record<string, string[]>)[postcode] : undefined;
  const town = (fromTable?.[0] ?? locality)?.toUpperCase();
  const stateName = state?.toUpperCase();

  let street = text;
  if (hasTail && postcode) street = street.replace(new RegExp(`\\b${postcode}\\b`), ' ');

  const groups = street
    .split(/\s+-{1,2}(?=\s|$)|^-{1,2}\s+/)
    .map((group) => group.split(','));
  if (hasTail) stripTail(groups, [['MALAYSIA'], stateSpellings(stateName), town ? [escapeRegExp(town)] : []]);

  const lines = groups.flatMap((group) =>
    packStreetLines(group.map(dropEmptySegments).filter((segment) => segment && segment !== 'NULL')),
  );
  if (hasTail) {
    const localityLine = [postcode, town].filter(Boolean).join(' ');
    if (localityLine) lines.push(localityLine);
    if (stateName) lines.push(printedState(stateName));
  }
  return lines;
}

// The postcode table names the federal territories bare; the portal writes
// them `W.P. KUALA LUMPUR` or `KUALA LUMPUR WILAYAH PERSEKUTUAN`.
const FEDERAL_TERRITORIES = ['KUALA LUMPUR', 'PUTRAJAYA', 'LABUAN'];

// Older English names the portal and agents still type.
const STATE_ALIASES: Record<string, string[]> = {
  'PULAU PINANG': ['PENANG'],
  MELAKA: ['MALACCA'],
};

/** Every spelling of the state that may end an address, as regex sources, longest first. */
function stateSpellings(state: string | undefined): string[] {
  if (!state) return [];
  if (FEDERAL_TERRITORIES.includes(state)) {
    return [`WILAYAH PERSEKUTUAN ${state}`, `W.P. ${state}`, `WP ${state}`, 'WILAYAH PERSEKUTUAN', state].map(
      escapeRegExp,
    );
  }
  // `SELANGOR DARUL EHSAN`, `PERAK DARUL RIDZUAN`, … — the honorific is optional.
  return [state, ...(STATE_ALIASES[state] ?? [])].flatMap((name) => [
    `${escapeRegExp(name)} DARUL \\S+`,
    escapeRegExp(name),
  ]);
}

function printedState(state: string): string {
  return FEDERAL_TERRITORIES.includes(state) ? `W.P. ${state}` : state;
}

/**
 * Remove each step's first matching spelling (a regex source) from the end of
 * the street text — each step at most once, reaching back into an earlier
 * segment when a later one has emptied.
 */
function stripTail(groups: string[][], steps: string[][]): void {
  for (const spellings of steps) {
    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g];
      let i = group.length - 1;
      while (i >= 0 && !dropEmptySegments(group[i])) i--;
      if (i < 0) continue;
      const hit = spellings.find((tail) => new RegExp(`(^|\\s)${tail}\\s*$`).test(group[i].trim()));
      if (hit) group[i] = group[i].trim().replace(new RegExp(`\\s*${hit}\\s*$`), '');
      break;
    }
  }
}

/** A cursor that draws top-down, so the code reads in the order the page does. */
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
  lines(list: string[], opts: { font?: PDFFont; x?: number } = {}): void {
    for (const line of list) this.text(line, opts);
  }
  gap(multiple = 1): void {
    this.y -= LINE_H * multiple;
  }
}

/**
 * A `LABEL : value` row where the label is plain and the value bold, as the
 * template sets them. A blank value prints the label and stops — which is how
 * the authorised representative and the company chop stay empty.
 */
function labelled(
  cur: Cursor,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  label: string,
  value: string,
): void {
  const y = cur.y;
  cur.text(label, { font });
  if (!value) return;
  // Measured from the label WITHOUT its trailing space, then given a fixed gap.
  // Adding a width on top of a label that already ends in a space made the short
  // labels read as a double space ("NAME :  FAISAL") while the long ones still
  // read as none, because the apparent gap also depends on the value's first
  // glyph — a digit carries far less left bearing than a capital.
  const x =
    MARGIN +
    font.widthOfTextAtSize(label.trimEnd(), FONT_SIZE) +
    font.widthOfTextAtSize(' ', FONT_SIZE) * 1.5;
  page.drawText(value, { x, y, size: FONT_SIZE, font: bold, color: rgb(0, 0, 0) });
}

export interface BizLetterExtras {
  /**
   * A signature from the admin pool, stamped on the director's line. Ignored
   * when the case names no director. Null or omitted leaves the line blank —
   * an empty pool must never fail a generate.
   */
  signature?: SignatureImage | null;
}

export async function generateBizAuthorizationLetter(
  source: BizLetterSource,
  now: Date = new Date(),
  extras?: BizLetterExtras,
): Promise<Uint8Array> {
  const f = resolveBizLetterFields(source);

  // The letterhead reuses the installation address: no company registered
  // address is recorded anywhere, and the Bizz Chat already prints
  // "Billing Address : SAME AS ABOVE" for the same reason.
  const addressLines = await letterheadLines(source.full_address);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const cur = new Cursor(page, font, PAGE_H - MARGIN);

  // ── Letterhead ───────────────────────────────────────────────────
  if (f.companyLine) cur.lines(wrapToWidth(f.companyLine, bold, FONT_SIZE, CONTENT_W), { font: bold });
  for (const line of addressLines) {
    cur.lines(wrapToWidth(line, bold, FONT_SIZE, CONTENT_W), { font: bold });
  }

  cur.gap(1);
  cur.text(`DATE : ${longDate(now)}`);

  // Rule under the date, as the template has.
  cur.gap(0.5);
  page.drawLine({
    start: { x: MARGIN, y: cur.y + LINE_H * 0.5 },
    end: { x: PAGE_W - MARGIN, y: cur.y + LINE_H * 0.5 },
    thickness: 0.8,
    color: rgb(0, 0, 0),
  });
  cur.gap(0.5);

  // ── Title: bold and underlined ───────────────────────────────────
  const titleY = cur.y;
  cur.text(TITLE, { font: bold });
  page.drawLine({
    start: { x: MARGIN, y: titleY - 2 },
    end: { x: MARGIN + bold.widthOfTextAtSize(TITLE, FONT_SIZE), y: titleY - 2 },
    thickness: 0.7,
    color: rgb(0, 0, 0),
  });
  cur.gap(1);

  // ── Director block ───────────────────────────────────────────────
  const confirm = `We ${f.companyLine}, hereby confirm that the undersigned :`;
  cur.lines(wrapToWidth(confirm, font, FONT_SIZE, CONTENT_W));
  labelled(cur, page, font, bold, 'NAME : ', f.directorName);
  labelled(cur, page, font, bold, 'IC / PASSPORT NUMBER : ', f.directorIc);
  cur.text('DESIGNATION : DIRECTOR');
  cur.gap(1);
  cur.text('is the Board of Director(BOD) of the company.');
  cur.gap(1);

  // ── Authorised representative — deliberately left empty ──────────
  const authorise =
    `We hereby authorise the following TM Authorised Agent to act on behalf of ${f.companyLine} ` +
    'for matters related to TM Unifi Business application :';
  cur.lines(wrapToWidth(authorise, font, FONT_SIZE, CONTENT_W));
  cur.text('AUTHORISED REPRESENTATIVE : ');
  cur.text('IC NUMBER : ');
  cur.text('DESIGNATION : TM AUTHORISED AGENT');
  cur.gap(1);

  cur.text('The authorised representative is permitted to:');
  for (const item of PERMISSIONS) {
    cur.text(`•  ${item}`, { x: MARGIN + BULLET_INDENT });
  }
  cur.gap(1);

  // ── Package and service address ──────────────────────────────────
  labelled(cur, page, font, bold, 'PACKAGE : ', f.packageName);
  const serviceLines = wrapToWidth(`SERVICE ADDRESS : ${f.serviceAddress}`, font, FONT_SIZE, CONTENT_W);
  cur.lines(serviceLines);
  cur.gap(1);

  cur.text(VALIDITY);
  const clarify = f.contact
    ? `Should you require any further clarification, please contact ${f.contact}.`
    : 'Should you require any further clarification, please contact us.';
  cur.lines(wrapToWidth(clarify, font, FONT_SIZE, CONTENT_W));
  cur.gap(2);

  cur.text('Thank you.');
  cur.gap(1);
  cur.text('Yours faithfully,');

  // ── Footer: the director signs, the chop stays blank ─────────────
  cur.gap(3);
  const signatureBaseline = cur.y;
  cur.text('_________________');
  // Drawn AFTER the rule so the ink sits on the line rather than under it, and
  // only above a named director — a signature over a `-` signs for nobody.
  if (extras?.signature && f.directorNamed) {
    await drawPoolSignature(pdfDoc, page, extras.signature, signatureBaseline);
  }
  cur.text(f.directorName, { font: bold });
  cur.text('DIRECTOR');
  if (f.companyLine) cur.lines(wrapToWidth(f.companyLine, bold, FONT_SIZE, CONTENT_W), { font: bold });
  labelled(cur, page, font, bold, 'IC / PASSPORT NUMBER : ', f.directorIc);
  cur.text('COMPANY CHOP : ');

  return pdfDoc.save();
}

/**
 * Stamp a pool signature on the director's rule.
 *
 * Scaled DOWN only — blowing a small scan up to fill the box turns a signature
 * into a blur — and inset slightly from the margin so it reads as written on the
 * line rather than starting exactly at its left end. A failure here is logged
 * and swallowed: a bad image in the pool must not cost the agent the letter.
 */
async function drawPoolSignature(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: SignatureImage,
  ruleBaseline: number,
): Promise<void> {
  try {
    const embedded = image.mime === 'image/png'
      ? await pdfDoc.embedPng(image.bytes)
      : await pdfDoc.embedJpg(image.bytes);
    const scale = Math.min(
      SIGNATURE_MAX_W / embedded.width,
      SIGNATURE_MAX_H / embedded.height,
      1,
    );
    page.drawImage(embedded, {
      x: MARGIN + 8,
      y: ruleBaseline + 2,
      width: embedded.width * scale,
      height: embedded.height * scale,
    });
  } catch (error) {
    console.error(
      'biz auth letter signature skipped:',
      error instanceof Error ? error.message : error,
    );
  }
}

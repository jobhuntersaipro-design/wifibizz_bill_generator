/**
 * Sabah (SESB) and Sarawak (SESCO) electricity bills.
 *
 * Peninsular utilities are TNB, so a TNB bill for a Kota Kinabalu or Kuching
 * address is wrong on its face. `generateUtilityBill` routes an address in
 * either state here; every other state keeps the TNB bill unchanged.
 *
 * Both templates are real SAP-printed bills (attached to ClickUp z8v9xnhwva).
 * SAP writes every text run as `BT x y Td … <hex>Tj ET`, each with its own Td,
 * so a run is addressed by its "x y" exactly as the stream spells it, and its
 * hex string is swapped in place. The fonts are either standard (Courier,
 * Helvetica) or an embedded Calibri carrying all of ASCII, so new values are
 * drawn in the run's own font and look exactly like the original.
 *
 * Numbers are random per call (Math.random, like the TNB bill), so two bills for
 * one order differ. Charges are recomputed from the units with each sample's own
 * rates, so every line item adds up to the printed total.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFPage } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { resolveAddressParts, sanitize } from './address-parts';
import { barcodeContent, qrFormContent, randomQrModules, BARCODE, QR_FORM } from './time-artwork';
import { decodeCustomerName } from '../html-entities';
import { parseMalaysianAddress } from '../malaysia-address';
import postcodeTable from '../malaysia-postcodes.json';
import type { CaseData } from './internet-bill';

export type BorneoState = 'Sabah' | 'Sarawak';
type Rng = () => number;

/**
 * The postcode decides (it is unambiguous); the address text only when there is
 * no known postcode. Labuan is its own federal territory and is not Sabah, so it
 * stays on the TNB bill.
 */
export function borneoState(address: string): BorneoState | null {
  const { postcode, state } = parseMalaysianAddress(address || '');
  const s = (postcode && (postcodeTable as Record<string, string[]>)[postcode]?.[1]) || state;
  return s === 'Sabah' || s === 'Sarawak' ? s : null;
}

// ── Dates (all UTC midnights, read in Malaysia time) ───────────────

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const two = (n: number) => String(n).padStart(2, '0');
const dmy = (d: Date, sep: string, shortYear = false) =>
  [two(d.getUTCDate()), two(d.getUTCMonth() + 1), shortYear ? two(d.getUTCFullYear() % 100) : d.getUTCFullYear()].join(sep);

/** The 1st of the month two months before today (Malaysia time). 15 Oct 2026 → 1 Aug 2026. */
export function billDateFor(now = new Date()): Date {
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth() - 2, 1));
}

// ── Numbers ────────────────────────────────────────────────────────

const rm = (sen: number) => (sen / 100).toFixed(2);
const randInt = (min: number, max: number, rng: Rng) => min + Math.floor(rng() * (max - min + 1));
const digits = (n: number, rng: Rng) => Array.from({ length: n }, () => randInt(0, 9, rng)).join('');
const round5 = (sen: number) => Math.round(sen / 5) * 5;

/** SESB domestic tiers from the sample, rates in 1/10,000 RM. */
const SESB_TIERS = [
  { upTo: 200, rate: 2202 },
  { upTo: 300, rate: 3776 },
  { upTo: Infinity, rate: 4926 },
];

export type SesbFields = ReturnType<typeof sesbFields>;

export function sesbFields(now = new Date(), rng: Rng = Math.random) {
  const billDate = billDateFor(now);
  const prevReadDate = new Date(Date.UTC(billDate.getUTCFullYear(), billDate.getUTCMonth() - 1, 1));
  let c: ReturnType<typeof sesbCharges>;
  do c = sesbCharges(randInt(250, 600, rng));
  while (c.totalSen < 8000 || c.totalSen > 35000);
  const prevReading = randInt(10_000, 89_999, rng);
  return {
    ...c,
    account: '0' + digits(7, rng),
    invoice: '1' + digits(8, rng),
    meter: randInt(1, 9, rng) + digits(7, rng),
    billDate,
    prevReadDate,
    lastPayDate: addDays(prevReadDate, randInt(3, 20, rng)),
    dueDate: addDays(billDate, 30),
    prevReading,
    curReading: prevReading + c.units,
    prevBillSen: Math.round(c.totalSen * (0.7 + rng() * 0.7)), // paid in full: no arrears
  };
}

export function sesbCharges(units: number) {
  let from = 0;
  const tiers = SESB_TIERS.map(({ upTo, rate }) => {
    const u = Math.max(0, Math.min(units, upTo) - from);
    from = upTo;
    return { units: u, sen: Math.round((u * rate) / 100) };
  });
  const energySen = tiers.reduce((s, t) => s + t.sen, 0);
  const kwtbbSen = Math.round((energySen * 16) / 1000); // KWTBB 1.6%
  return { units, tiers, energySen, kwtbbSen, totalSen: energySen + kwtbbSen };
}

export type SescoFields = ReturnType<typeof sescoFields>;

export function sescoFields(now = new Date(), rng: Rng = Math.random) {
  const billDate = billDateFor(now);
  const periodEnd = addDays(billDate, -3);
  let c: ReturnType<typeof sescoCharges>;
  do c = sescoCharges(randInt(250, 600, rng), 0.4 + rng() * 1.05); // overdue < 1.45x current
  while (c.totalSen < 10000 || c.totalSen > 45000);
  const prevReading = randInt(10_000, 89_999, rng);
  return {
    ...c,
    account: '2010' + digits(8, rng),
    invoice: '75000' + digits(7, rng),
    meter: `5S${digits(6, rng)}:001`,
    billDate,
    periodStart: addDays(periodEnd, -29),
    periodEnd,
    lastPayDate: addDays(billDate, -randInt(2, 10, rng)),
    dueDate: addDays(billDate, 21),
    lastPaySen: randInt(10, 30, rng) * 1000,
    prevReading,
    curReading: prevReading + c.units,
  };
}

export function sescoCharges(units: number, overdueFactor: number) {
  const excessUnits = Math.max(0, units - 600);
  const firstSen = (units - excessUnits) * 31; // RM 0.31/kWh: 186.00 for the first 600
  const excessSen = excessUnits * 31;
  const taxSen = Math.round(excessSen * 0.08); // 8% service tax on the excess only
  const discountSen = -Math.round((firstSen + excessSen) * 0.25); // Sarawak 25%
  const raw = firstSen + excessSen + taxSen + discountSen;
  const currentSen = round5(raw);
  const overdueSen = round5(currentSen * overdueFactor);
  return { units, excessUnits, firstSen, excessSen, taxSen, discountSen, roundingSen: currentSen - raw, currentSen, overdueSen, totalSen: currentSen + overdueSen };
}

// ── Template editing ───────────────────────────────────────────────

type Measure = (font: string, size: number, text: string) => number;
type Edit = string | { text: string; align: 'right' | 'center' };

const hex = (text: string) => Buffer.from(text, 'latin1').toString('hex').toUpperCase();
const RUN = /\/(\w+) ([\d.]+) Tf|BT\s+([\d.]+)\s+([\d.]+)\s+Td([\s\S]*?)ET/g;
const TJ = /<([0-9A-Fa-f\s]*)>\s*Tj/g;

/** Width from the font dict's own /Widths, so alignment matches what the viewer draws. */
function measurer(page: PDFPage): Measure {
  const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  return (font, size, text) => {
    const dict = fonts.lookup(PDFName.of(font), PDFDict);
    const first = dict.lookup(PDFName.of('FirstChar'), PDFNumber).asNumber();
    const widths = dict.lookup(PDFName.of('Widths'), PDFArray);
    let w = 0;
    for (const ch of text) w += (widths.lookup(ch.charCodeAt(0) - first, PDFNumber)).asNumber();
    return (w * size) / 1000;
  };
}

/**
 * Swap the text of the runs named in `edits`. Right/centre-aligned runs keep
 * their edge: the template only gives the left x, so the edge is recovered from
 * the old text's width. A key that matches nothing throws, so a changed template
 * fails loudly instead of printing the sample's own values.
 */
function rewriteRuns(stream: string, edits: Record<string, Edit>, measure: Measure): string {
  let font = '';
  let size = 0;
  const unused = new Set(Object.keys(edits));
  const out = stream.replace(RUN, (m, f, s, x, y, body: string) => {
    if (f) {
      font = f;
      size = Number(s);
      return m;
    }
    const tf = /\/(\w+) ([\d.]+) Tf/.exec(body);
    if (tf) {
      font = tf[1];
      size = Number(tf[2]);
    }
    const key = `${x} ${y}`;
    const edit = edits[key];
    if (edit === undefined) return m;
    unused.delete(key);
    const { text, align } = typeof edit === 'string' ? { text: edit, align: undefined } : edit;
    const old = [...body.matchAll(TJ)].map((h) => Buffer.from(h[1].replace(/\s/g, ''), 'hex').toString('latin1')).join('');
    const shift = align ? measure(font, size, old) - measure(font, size, text) : 0;
    const nx = Number(x) + (align === 'center' ? shift / 2 : shift);
    let first = true;
    const nb = body.replace(TJ, () => (first ? ((first = false), `<${hex(text)}>Tj`) : ''));
    return `BT ${nx.toFixed(2)} ${y} Td${nb}ET`;
  });
  if (unused.size) throw new Error(`Template runs not found: ${[...unused].join(', ')}`);
  return out;
}

/** Greedy word wrap; a word longer than a line is cut. */
export function wrap(text: string, fits: (line: string) => boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (!fits(line)) {
      let n = line.length - 1;
      while (n > 1 && !fits(line.slice(0, n))) n--;
      lines.push(line.slice(0, n));
      line = line.slice(n);
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ponytail: an address too long for its slots loses middle lines; the last
// (postcode/state) line always prints. Shrink the font if that ever shows up.
const clamp = (lines: string[], slots: number) =>
  lines.length <= slots ? lines : [...lines.slice(0, slots - 1), lines[lines.length - 1]];

const ascii = (text: string) => sanitize(text.normalize('NFD').replace(/[̀-ͯ]/g, '')).toUpperCase();

function textOps(lines: { text: string; x: number; y: number; font: string; size: number }[]): string {
  const ops = lines.map((l) => `BT /${l.font} ${l.size} Tf ${l.x} ${l.y.toFixed(2)} Td <${hex(l.text)}>Tj ET`);
  return `\nq 0 g ${ops.join(' ')} Q\n`;
}

async function editTemplate(file: string, edit: (stream: string, page: PDFPage) => string): Promise<Buffer> {
  const pdf = await PDFDocument.load(await readFile(path.join(process.cwd(), 'bill_generator', 'template', file)), {
    updateMetadata: false,
  });
  const page = pdf.getPages()[0];
  for (const entry of getPageStreamRefs(pdf, page)) {
    transformStream(pdf, entry, (buf) => ({ data: Buffer.from(edit(buf.toString('latin1'), page), 'latin1'), count: 1 }));
  }
  return Buffer.from(await pdf.save());
}

// ── SESB (Sabah) ───────────────────────────────────────────────────

const SESB_TOP = { x: 14.15, y: 702.8, cols: 64, slots: 5 };
const SESB_SLIP = { x: 28.35, y: 103.65, cols: 42, slots: 8 };
const SESB_LEADING = 10.3;
const SESB_ADDRESS_RUNS = ['14.15 702.80', '14.15 692.50', '14.15 682.20', '28.35 103.65', '28.35 93.35', '28.35 83.05', '28.35 72.75'];

/** Courier is fixed-pitch, so padding to the sample's own width keeps every column aligned. */
const pad = (s: string | number, w: number) => String(s).padStart(w);
const reading = (n: number) => `${n.toLocaleString('en-US')}.00`;

export function sesbEdits(f: SesbFields): Record<string, Edit> {
  const d = (x: Date) => dmy(x, '.', true);
  const total = rm(f.totalSen);
  const amountRow = (unit: string, a: string) => `${pad(unit, 6)}${pad(a, 15)}${pad('0.00', 17)}${pad(a, 16)} `;
  const edits: Record<string, Edit> = {
    '198.45 774.90': `No. Invois: ${f.invoice}`,
    '99.20 764.60': `: ${f.account}`,
    '14.15 647.35': `Jumlah Perlu Dibayar          : RM${pad(total, 14)} `,
    '297.65 647.35': ` Tarikh Invois : ${d(f.billDate)}`,
    '14.15 637.05': `SILA BAYAR BIL SEMASA SEBELUM : ${d(f.dueDate)}`,
    '127.55 606.15': `RM${pad(rm(f.prevBillSen), 13)} `,
    '240.95 606.15': d(f.prevReadDate),
    '127.55 595.85': `RM${pad(rm(f.prevBillSen), 13)} `,
    '240.95 595.85': d(f.lastPayDate),
    '127.55 585.55': `RM${pad(total, 13)} `,
    '240.95 585.55': d(f.billDate),
    '240.95 566.20': `  ${d(f.prevReadDate)}   ${d(f.billDate)}`,
    '14.15 545.60': `${f.meter}             1 ${d(f.prevReadDate)} ${d(f.billDate)}${pad(reading(f.prevReading), 13)}${pad(reading(f.curReading), 13)}${pad(f.units.toFixed(2), 13)}  `,
    '184.25 385.80': amountRow('kWh', f.units.toFixed(2)),
    '184.25 365.20': amountRow('RM', rm(f.energySen)),
    '14.15 354.90': `ICPT(${pad(f.units.toFixed(2), 13)}  kWh)`,
    '184.25 334.30': amountRow('RM', rm(f.energySen)),
    '382.70 313.70': `${pad(rm(f.kwtbbSen), 17)} `,
    '382.70 272.50': `${pad(total, 17)} `,
    '382.70 210.70': `${pad(total, 17)} `,
    '382.70 190.10': `${pad(total, 17)} `,
    '500.00 289.40': { text: `${total}  subsidi`, align: 'center' },
    '269.30 93.35': `Nombor Akaun         : ${f.account}`,
    '269.30 83.05': `Tarikh Dicetak       : ${d(f.billDate)}`,
    '269.30 72.75': `Nombor Invois        : ${f.invoice}`,
    '269.30 62.45': `Jumlah Perlu Dibayar : RM ${total} `,
  };
  ['514.70', '504.40', '494.10'].forEach((y, i) => {
    edits[`184.25 ${y}`] = `${pad(f.tiers[i].units.toFixed(2), 12)} `;
    edits[`382.70 ${y}`] = `${pad(rm(f.tiers[i].sen), 17)} `;
  });
  for (const key of SESB_ADDRESS_RUNS) edits[key] = '';
  return edits;
}

async function generateSesbBill(caseData: CaseData, f: SesbFields): Promise<Buffer> {
  const name = ascii(decodeCustomerName(caseData.full_name));
  const parts = await resolveAddressParts(caseData.full_address, name);
  const street = ascii(parts.streetSegments.join(', '));
  const locality = ascii([parts.postcode, parts.locality].filter(Boolean).join(', '));
  const block = ({ x, y, cols, slots }: typeof SESB_TOP) => {
    const fits = (l: string) => l.length <= cols;
    const lines = clamp([...wrap(name, fits), ...wrap(street, fits), ...(locality ? [locality] : [])], slots);
    return lines.map((text, i) => ({ text, x, y: y - i * SESB_LEADING, font: 'C002', size: 9 }));
  };
  return editTemplate('sesb_bill.pdf', (stream, page) =>
    rewriteRuns(stream, sesbEdits(f), measurer(page)) + textOps([...block(SESB_TOP), ...block(SESB_SLIP)]),
  );
}

// ── SESCO (Sarawak) ────────────────────────────────────────────────

const SESCO_BLOCK = { x: 17, nameY: 701.2, maxWidth: 260, lowestY: 626 };
const SESCO_ADDRESS_RUNS = ['17.00 701.20', '17.00 689.20', '17.00 677.20', '17.00 665.20', '156.70 665.20', '17.00 653.20'];
/** The two inline images (S Pay QR, kiosk barcode) encode the sample's own account. */
const INLINE_IMAGE = /q ([\d. ]+) cm\s*BI\b[\s\S]*?~>\s*EI\s*Q/g;

export function sescoEdits(f: SescoFields): Record<string, Edit> {
  const slash = (x: Date) => dmy(x, '/');
  const lastPay = slash(f.lastPayDate);
  const right = (sen: number) => ({ text: rm(sen), align: 'right' as const });
  const edits: Record<string, Edit> = {
    '36.00 260.85': `Billing Period ( ${dmy(f.periodStart, '.')} -`,
    '154.95 260.85': `${dmy(f.periodEnd, '.')} ) (30 days)`,
    '17.00 210.65': `${f.meter} `,
    '139.75 210.65': `${f.prevReading.toLocaleString('en-US')}  KWH`,
    '241.80 210.65': `${f.curReading.toLocaleString('en-US')}  KWH`,
    '335.35 210.65': `${f.units}  KWH`,
    '495.95 653.00': f.account,
    '411.50 641.00': `Inv. No: ${f.invoice} | Date: `,
    '526.45 641.00': slash(f.billDate),
    '24.95 592.55': `Last Payment Received - ${lastPay.slice(0, 6)}`,
    '140.90 592.55': lastPay.slice(6),
    '325.45 592.55': `RM ${rm(f.lastPaySen)}`,
    '444.55 547.90': { text: `RM ${rm(f.totalSen)} `, align: 'center' },
    '446.40 448.65': slash(f.dueDate),
    '190.85 526.40': right(f.firstSen),
    '324.65 526.40': right(f.firstSen),
    '30.90 515.15': `Subsequent Charges (${f.excessUnits}kWh)`,
    '193.10 515.15': right(f.excessSen),
    '267.25 515.15': `${rm(f.taxSen)}(8%)`,
    '327.15 515.15': right(f.excessSen + f.taxSen),
    '214.95 503.90': right(f.discountSen),
    '349.00 503.90': right(f.discountSen),
    '329.65 492.65': right(f.roundingSen),
    '324.65 481.40': right(f.currentSen),
    '324.65 464.15': right(f.overdueSen),
    '310.55 445.65': right(f.totalSen),
  };
  for (const key of SESCO_ADDRESS_RUNS) edits[key] = '';
  return edits;
}

/** Random bars and a random QR in the images' exact boxes. Decoration: they do not scan. */
function sescoArtwork(rng: Rng): string {
  const barcodeEnd = BARCODE.x0 + 268.8;
  const sy = 24 / BARCODE.height;
  const qr = randomQrModules(33, rng);
  const s = 54.6 / (33 * QR_FORM.moduleSize);
  return [
    `q 1 0 0 ${sy.toFixed(4)} ${(313 - BARCODE.x0).toFixed(2)} ${(667 - BARCODE.y * sy).toFixed(2)} cm ${barcodeContent(barcodeEnd, rng)} Q`,
    `q ${s.toFixed(4)} 0 0 ${s.toFixed(4)} ${(525.5 - QR_FORM.originX * s).toFixed(2)} ${(709 - QR_FORM.originY * s).toFixed(2)} cm ${qrFormContent(qr)} Q`,
  ].join('\n');
}

async function generateSescoBill(caseData: CaseData, f: SescoFields, rng: Rng): Promise<Buffer> {
  const name = ascii(decodeCustomerName(caseData.full_name));
  const parts = await resolveAddressParts(caseData.full_address, name);
  const address = ascii([parts.streetSegments.join(', '), parts.postcode, parts.locality].filter(Boolean).join(' '));
  return editTemplate('sesco_bill.pdf', (stream, page) => {
    const measure = measurer(page);
    let images = 0;
    const edited = rewriteRuns(
      stream.replace(INLINE_IMAGE, () => (images++, '')),
      sescoEdits(f),
      measure,
    );
    if (images !== 2) throw new Error(`Expected 2 inline images in the SESCO template, found ${images}`);

    const { x, nameY, maxWidth, lowestY } = SESCO_BLOCK;
    const nameLines = wrap(name, (l) => measure('F002', 14, l) <= maxWidth);
    const firstAddrY = nameY - (nameLines.length - 1) * 15 - 12;
    const addrSlots = Math.floor((firstAddrY - lowestY) / 12) + 1;
    const addrLines = clamp([...wrap(address, (l) => measure('F003', 9, l) <= maxWidth), 'SARAWAK'], addrSlots);
    return `${edited}\n${sescoArtwork(rng)}${textOps([
      ...nameLines.map((text, i) => ({ text, x, y: nameY - i * 15, font: 'F002', size: 14 })),
      ...addrLines.map((text, i) => ({ text, x, y: firstAddrY - i * 12, font: 'F003', size: 9 })),
    ])}`;
  });
}

/** The electricity bill for a Sabah or Sarawak address. */
export function generateBorneoBill(state: BorneoState, caseData: CaseData, now = new Date(), rng: Rng = Math.random): Promise<Buffer> {
  return state === 'Sabah'
    ? generateSesbBill(caseData, sesbFields(now, rng))
    : generateSescoBill(caseData, sescoFields(now, rng), rng);
}

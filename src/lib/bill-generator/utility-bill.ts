/**
 * Utility Bill PDF Generator (TypeScript port of generate-utility-bill.py)
 *
 * Takes a TNB template PDF and produces a new PDF with customer data injected —
 * replacing account numbers, dates, invoice numbers, barcode digits, and
 * overlaying formatted address.
 */

import { PDFDocument } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  getPageStreamRefs,
  transformStream,
  replaceStringInStream,
  blankPatternInStream,
  buildOverlayStream,
  appendOverlayToPage,
  registerStandardFont,
} from './pdf-utils';
import { normalizeAddress, type UtilityAddressResult } from './address-normalizer';
import type { CaseData } from './internet-bill';

// ── Original values from utility_bill_template.pdf ────────────────
const ORIGINAL_ACCOUNT = '2202926650XX';
const ORIG_TARIKH_BIL = '03.03.2026';
const ORIG_TEMPOH_START = '02.02.2026';
const ORIG_TEMPOH_END = '01.03.2026';
const ORIG_LAST_PAYMENT_DATE = '10.02.2026';
const ORIG_INVOIS = '000870861263';
const ORIG_DEPOSIT = '204.84';
const ORIG_BAYARAN = '221.80';
const ORIG_BARCODE_TAIL = '000000000032995';

// Original summary amounts from template
const ORIG_CAJ_SEMASA = '161.55';
const ORIG_BAKI_TERDAHULU = '168.40';
const ORIG_JUMLAH_BIL = '329.95';
const ORIG_SILA_BAYAR = '02 Apr 2026';

// Malay month abbreviations for date formatting
const MALAY_MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

// Address patterns to blank out on page 1 (ALAMAT POS)
const PAGE1_NAME_PATTERN = Buffer.from('(XXXXXXXXXXXXXXXXXX)', 'ascii');
const PAGE1_ADDR_PATTERNS = [
  Buffer.from('(XXX XXX, JALAN CEMPEDAK)', 'ascii'),
  Buffer.from('(KAMPUNG KANCHONG DARAT)', 'ascii'),
  Buffer.from('(42700 BANTING)', 'ascii'),
  Buffer.from('(SELANGOR)', 'ascii'),
];

// Address patterns to blank out on page 2 (ALAMAT PREMIS)
const PAGE2_ADDR_PATTERNS = [
  Buffer.from('(XXX XXX, JALAN CEMPEDAK)', 'ascii'),
  Buffer.from('(KAMPUNG KANCHONG DARAT)', 'ascii'),
  Buffer.from('(42700 BANTING)', 'ascii'),
  Buffer.from('(SELANGOR)', 'ascii'),
];

// Kedai Tenaga Terdekat patterns to blank out on page 2
const KEDAI_TENAGA_PATTERNS = [
  Buffer.from('(Kedai Tenaga Terdekat :)', 'ascii'),
  Buffer.from('(TNB BANTING)', 'ascii'),
  Buffer.from('(LOT 4, JLN BUNGA PEKAN)', 'ascii'),
  Buffer.from('(42700 BANTING)', 'ascii'),
  Buffer.from('(SELANGOR)', 'ascii'),
];

// Page 1 overlay coordinates (ALAMAT POS)
const PAGE1_OVERLAY = {
  x: 36.0,
  nameY: 756.668,
  addr1Y: 745.081,
  addr2Y: 733.493,
  addr3Y: 721.906,
  addr4Y: 710.318,
  boxX: 34,
  boxY: 708,
  boxW: 180,
  boxH: 55,
  fontSize: 8.0,
  nameFont: '/F0201',   // Tahoma-Bold
  addrFont: '/F0301',   // Tahoma
  maxChars: 40,
};

// Page 2 overlay coordinates (ALAMAT PREMIS)
const PAGE2_OVERLAY = {
  x: 36.0,
  addr1Y: 730.687,
  addr2Y: 719.100,
  addr3Y: 707.512,
  addr4Y: 695.925,
  addr5Y: 684.337,
  boxX: 34,
  boxY: 682,
  boxW: 152,
  boxH: 53,
  fontSize: 8.0,
  addrFont: '/F0301',
  maxChars: 33,
};

// ── Value computation ───────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => randInt(0, 9)).join('');
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function generateAccount(): string {
  return `2202${randomDigits(6)}XX`;
}

function computeValues() {
  const today = new Date();

  // TARIKH BIL: previous month, random day 01-03
  let prevM = today.getMonth(); // 0-indexed = already T-1
  let prevY = today.getFullYear();
  if (prevM === 0) { prevM = 12; prevY--; }
  // prevM is now 1-indexed for T-1
  const billDay = randInt(1, 3);
  const tarikhBil = new Date(prevY, prevM - 1, billDay);

  // TEMPOH BIL: previous month relative to TARIKH BIL
  let tempohM = prevM - 1;
  let tempohY = prevY;
  if (tempohM === 0) { tempohM = 12; tempohY--; }
  const daysInTempoh = daysInMonth(tempohY, tempohM);
  const tempohStart = new Date(tempohY, tempohM - 1, 1);
  const tempohEnd = new Date(tempohY, tempohM - 1, daysInTempoh);

  // NO. INVOIS: 000870 + 6 random digits
  const newInvois = `000870${randomDigits(6)}`;

  // BAYARAN and DEPOSIT: randomized RM100-250
  const bayaranAmount = (Math.random() * 150 + 100).toFixed(2);
  const depositAmount = (Math.random() * 150 + 100).toFixed(2);

  // Barcode tail
  const newBarcodeTail = `0000000000${randomDigits(5)}`;

  // Last payment date within billing period
  const payDay = randInt(tempohStart.getDate(), tempohEnd.getDate());
  const lastPaymentDate = new Date(tempohY, tempohM - 1, payDay);

  // Caj Semasa: random RM150-250
  const cajSemasa = (Math.random() * 100 + 150).toFixed(2);
  // Baki Terdahulu: random RM150-250
  const bakiTerdahulu = (Math.random() * 100 + 150).toFixed(2);
  // Jumlah Bil Anda = Caj Semasa + Baki Terdahulu
  const jumlahBil = (parseFloat(cajSemasa) + parseFloat(bakiTerdahulu)).toFixed(2);

  // Sila bayar sebelum: TARIKH BIL + 1 month
  let silaBayarM = prevM + 1;
  let silaBayarY = prevY;
  if (silaBayarM > 12) { silaBayarM = 1; silaBayarY++; }
  const silaBayar = `${String(billDay).padStart(2, '0')} ${MALAY_MONTHS[silaBayarM - 1]} ${silaBayarY}`;

  // Caj Bulanan: 5 random monthly values RM150-250, last month = Caj Semasa
  const cajBulanan = Array.from({ length: 5 }, () =>
    (Math.random() * 100 + 150).toFixed(2)
  );
  cajBulanan.push(cajSemasa);

  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getFullYear()}`;
  };

  return {
    tarikhBil: fmt(tarikhBil),
    tempohStart: fmt(tempohStart),
    tempohEnd: fmt(tempohEnd),
    daysInPeriod: String(daysInTempoh),
    newInvois,
    newBayaran: bayaranAmount,
    newDeposit: depositAmount,
    newBarcodeTail,
    lastPaymentDate: fmt(lastPaymentDate),
    cajSemasa,
    bakiTerdahulu,
    jumlahBil,
    silaBayar,
    cajBulanan,
  };
}

// ── Caj Bulanan overlay builder ────────────────────────────────

/**
 * Build a PDF path for a rounded rectangle (matching template Bezier curves).
 */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const k = r * 0.5523; // Bezier control point factor for quarter circle
  const right = x + w;
  const top = y + h;
  return [
    `${x.toFixed(3)} ${(top - r).toFixed(3)} m`,
    `${x.toFixed(3)} ${(top - r + k).toFixed(3)} ${(x + r - k).toFixed(3)} ${top.toFixed(3)} ${(x + r).toFixed(3)} ${top.toFixed(3)} c`,
    `${(right - r).toFixed(3)} ${top.toFixed(3)} l`,
    `${(right - r + k).toFixed(3)} ${top.toFixed(3)} ${right.toFixed(3)} ${(top - r + k).toFixed(3)} ${right.toFixed(3)} ${(top - r).toFixed(3)} c`,
    `${right.toFixed(3)} ${(y + r).toFixed(3)} l`,
    `${right.toFixed(3)} ${(y + r - k).toFixed(3)} ${(right - r + k).toFixed(3)} ${y.toFixed(3)} ${(right - r).toFixed(3)} ${y.toFixed(3)} c`,
    `${(x + r).toFixed(3)} ${y.toFixed(3)} l`,
    `${(x + r - k).toFixed(3)} ${y.toFixed(3)} ${x.toFixed(3)} ${(y + r - k).toFixed(3)} ${x.toFixed(3)} ${(y + r).toFixed(3)} c`,
    'h B*',
  ].join(' ');
}

function buildCajBulananOverlay(cajBulananValues: string[]): string {
  const barX = 63;
  const maxWidth = 215;
  const maxValue = 250;
  const barHeight = 7.9;
  const cornerRadius = 3;

  // barY = bottom of bar, textY = above bar (barY + ~11.6 matching template)
  const monthRows = [
    { barY: 317.5, textY: 329.1 },   // OKT
    { barY: 293.8, textY: 305.5 },   // NOV
    { barY: 270.2, textY: 281.8 },   // DIS
    { barY: 246.5, textY: 258.1 },   // JAN
    { barY: 222.8, textY: 234.5 },   // FEB
    { barY: 199.2, textY: 210.8 },   // MAC (latest - blue)
  ];

  // White-out existing bars and text (extend left to prevent white line artifacts)
  let s = 'q\n1 1 1 rg\n58 186 228 152 re f\nQ\n';

  for (let i = 0; i < 6; i++) {
    const value = parseFloat(cajBulananValues[i]);
    const width = Math.max((value / maxValue) * maxWidth, cornerRadius * 2 + 1);
    const { barY, textY } = monthRows[i];

    // Last bar (latest month) is blue, rest are grey
    const color = i === 5 ? '0.337 0.518 0.761' : '0.804 0.804 0.804';
    s += `${color} rg\n${color} RG\n`;
    s += roundedRectPath(barX, barY, width, barHeight, cornerRadius) + '\n';

    // RM text label (above the bar)
    s += `0.000 0.000 0.000 scn\nBT\n/F0601 8 Tf\n0 g\n65.813 ${textY.toFixed(3)} Td\n(\\(BS\\) RM${cajBulananValues[i]}) Tj\nET\n`;
  }

  return s;
}

// ── Account replacement in streams ──────────────────────────────

function replaceAccountInStream(buf: Buffer, oldAccount: string, newAccount: string): number {
  let count = replaceStringInStream(buf, oldAccount, newAccount);

  // Replace individual barcode chars at y=577.28
  const oldMiddle = oldAccount.slice(4, 10);
  const newMiddle = newAccount.slice(4, 10);

  const barcodePattern = /BT\s+([\d.]+)\s+577\.28\d*\s+Td\s+\/F0401\s+[\d.]+\s+Tf\s+\((.)\)\s+Tj/g;
  const bufStr = buf.toString('ascii');
  const chars: { x: number; charPos: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = barcodePattern.exec(bufStr)) !== null) {
    const x = parseFloat(m[1]);
    // Find the position of the character in the original buffer
    const charOffset = m.index + m[0].indexOf(`(${m[2]})`) + 1;
    chars.push({ x, charPos: charOffset });
  }

  chars.sort((a, b) => a.x - b.x);

  if (chars.length >= 10) {
    for (let i = 4; i < 10 && i < chars.length; i++) {
      const oldChar = oldMiddle.charCodeAt(i - 4);
      const newChar = newMiddle.charCodeAt(i - 4);
      if (buf[chars[i].charPos] === oldChar) {
        buf[chars[i].charPos] = newChar;
        count++;
      }
    }
  }

  return count;
}

function replaceBarcodeInStream(buf: Buffer, newInvois: string, newBarcodeTail: string): number {
  const barcodePattern = /BT\s+([\d.]+)\s+577\.28\d*\s+Td\s+\/F0401\s+[\d.]+\s+Tf\s+\((.)\)\s+Tj/g;
  const bufStr = buf.toString('ascii');
  const chars: { x: number; charPos: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = barcodePattern.exec(bufStr)) !== null) {
    const x = parseFloat(m[1]);
    const charOffset = m.index + m[0].indexOf(`(${m[2]})`) + 1;
    chars.push({ x, charPos: charOffset });
  }

  chars.sort((a, b) => a.x - b.x);
  let count = 0;

  if (chars.length >= 39) {
    // Positions 12-23: invoice
    for (let i = 12; i < 24; i++) {
      buf[chars[i].charPos] = newInvois.charCodeAt(i - 12);
      count++;
    }
    // Positions 24-38: tail
    for (let i = 24; i < 39; i++) {
      buf[chars[i].charPos] = newBarcodeTail.charCodeAt(i - 24);
      count++;
    }
  }

  return count;
}

// ── Annotation replacement ──────────────────────────────────────

function replaceInAnnotations(pdfDoc: PDFDocument, page: import('pdf-lib').PDFPage, oldAccount: string, newAccount: string): number {
  // Annotations are typically handled through the page dict
  // For simplicity, this is handled by replaceInTextObjects at document level
  return 0;
}

// ── Main generator ──────────────────────────────────────────────

export async function generateUtilityBill(caseData: CaseData): Promise<Buffer> {
  const newAccount = generateAccount();
  const vals = computeValues();

  // Normalize address
  const addrResult = await normalizeAddress(
    caseData.full_address,
    'utility',
    caseData.full_name,
  ) as UtilityAddressResult;

  const addrLinesP1 = addrResult.alamat_pos;
  const addrLinesP2 = addrResult.alamat_premis;

  // Load template PDF
  const templatePath = path.join(process.cwd(), 'bill_generator', 'template', 'utility_bill_template.pdf');
  const templateBytes = await readFile(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes, { updateMetadata: false });

  const pages = pdfDoc.getPages();

  // ── Page 1 processing ──
  if (pages.length > 0) {
    const page1 = pages[0];
    const streamEntries1 = getPageStreamRefs(pdfDoc, page1);

    for (const entry of streamEntries1) {
      transformStream(pdfDoc, entry, (buf) => {
        let total = 0;

        // Blank out original name
        total += blankPatternInStream(buf, PAGE1_NAME_PATTERN);

        // Blank out original address lines
        for (const pattern of PAGE1_ADDR_PATTERNS) {
          total += blankPatternInStream(buf, pattern);
        }

        // Replace account number
        total += replaceAccountInStream(buf, ORIGINAL_ACCOUNT, newAccount);

        // Replace dates — tempoh dates BEFORE tarikh_bil to avoid collision
        total += replaceStringInStream(buf, ORIG_TEMPOH_START, vals.tempohStart);
        total += replaceStringInStream(buf, ORIG_TEMPOH_END, vals.tempohEnd);
        total += replaceStringInStream(buf, ORIG_TARIKH_BIL, vals.tarikhBil);

        // Replace invoice number
        total += replaceStringInStream(buf, ORIG_INVOIS, vals.newInvois);

        // Replace BAYARAN amount (pad to same length)
        const newBayaranPadded = vals.newBayaran.padStart(ORIG_BAYARAN.length);
        total += replaceStringInStream(buf, ORIG_BAYARAN, newBayaranPadded);

        // Replace deposit amount
        const newDepositPadded = vals.newDeposit.padStart(ORIG_DEPOSIT.length);
        total += replaceStringInStream(buf, ORIG_DEPOSIT, newDepositPadded);

        // Replace barcode invoice + tail digits
        total += replaceBarcodeInStream(buf, vals.newInvois, vals.newBarcodeTail);

        // Replace Caj Semasa
        total += replaceStringInStream(buf, ORIG_CAJ_SEMASA, vals.cajSemasa);

        // Replace Baki Terdahulu
        total += replaceStringInStream(buf, ORIG_BAKI_TERDAHULU, vals.bakiTerdahulu);

        // Replace Jumlah Bil Anda
        total += replaceStringInStream(buf, ORIG_JUMLAH_BIL, vals.jumlahBil);

        // Replace Sila bayar sebelum date
        total += replaceStringInStream(buf, ORIG_SILA_BAYAR, vals.silaBayar);

        return { data: buf, count: total };
      });
    }

    // Overlay name + address on page 1
    const o1 = PAGE1_OVERLAY;
    const p1YKeys = [o1.nameY, o1.addr1Y, o1.addr2Y, o1.addr3Y, o1.addr4Y];
    const p1Lines: { text: string; x: number; y: number; font: string; fontSize: number }[] = [];

    for (let i = 0; i < addrLinesP1.length && i < p1YKeys.length; i++) {
      p1Lines.push({
        text: addrLinesP1[i],
        x: o1.x,
        y: p1YKeys[i],
        font: i === 0 ? o1.nameFont : o1.addrFont,
        fontSize: o1.fontSize,
      });
    }

    const overlayP1 = buildOverlayStream({
      boxX: o1.boxX, boxY: o1.boxY, boxW: o1.boxW, boxH: o1.boxH,
      lines: p1Lines,
    });
    appendOverlayToPage(pdfDoc, page1, overlayP1);

    // Overlay Caj Bulanan bars and text
    const cajBulananOverlay = buildCajBulananOverlay(vals.cajBulanan);
    appendOverlayToPage(pdfDoc, page1, cajBulananOverlay);
  }

  // ── Page 2 processing ──
  if (pages.length > 1) {
    const page2 = pages[1];
    const streamEntries2 = getPageStreamRefs(pdfDoc, page2);

    for (const entry of streamEntries2) {
      transformStream(pdfDoc, entry, (buf) => {
        let total = 0;

        // Blank out original ALAMAT PREMIS address
        for (const pattern of PAGE2_ADDR_PATTERNS) {
          total += blankPatternInStream(buf, pattern);
        }

        // Blank out Kedai Tenaga Terdekat text
        for (const pattern of KEDAI_TENAGA_PATTERNS) {
          total += blankPatternInStream(buf, pattern);
        }

        // Replace account number
        total += replaceAccountInStream(buf, ORIGINAL_ACCOUNT, newAccount);

        // Replace dates on page 2
        total += replaceStringInStream(buf, ORIG_TEMPOH_START, vals.tempohStart);
        total += replaceStringInStream(buf, ORIG_TEMPOH_END, vals.tempohEnd);
        total += replaceStringInStream(buf, ORIG_LAST_PAYMENT_DATE, vals.lastPaymentDate);

        // Replace BAYARAN on page 2
        const newBayaranPadded = vals.newBayaran.padStart(ORIG_BAYARAN.length);
        total += replaceStringInStream(buf, ORIG_BAYARAN, newBayaranPadded);

        // Replace Caj Semasa on page 2
        total += replaceStringInStream(buf, ORIG_CAJ_SEMASA, vals.cajSemasa);

        return { data: buf, count: total };
      });
    }

    // Overlay address on page 2
    const o2 = PAGE2_OVERLAY;
    const p2YKeys = [o2.addr1Y, o2.addr2Y, o2.addr3Y, o2.addr4Y, o2.addr5Y];
    const p2Lines: { text: string; x: number; y: number; font: string; fontSize: number }[] = [];

    for (let i = 0; i < addrLinesP2.length && i < p2YKeys.length; i++) {
      p2Lines.push({
        text: addrLinesP2[i],
        x: o2.x,
        y: p2YKeys[i],
        font: o2.addrFont,
        fontSize: o2.fontSize,
      });
    }

    const overlayP2 = buildOverlayStream({
      boxX: o2.boxX, boxY: o2.boxY, boxW: o2.boxW, boxH: o2.boxH,
      lines: p2Lines,
    });
    appendOverlayToPage(pdfDoc, page2, overlayP2);
  }

  // Save and return
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Internet Bill PDF Generator (TypeScript port of generate-internet-bill.py)
 *
 * Takes a template PDF and produces a new PDF with customer data injected —
 * replacing placeholder account numbers, dates, and mobile numbers with
 * real activated customer details.
 */

import { PDFDocument } from 'pdf-lib';
import { readFile } from 'fs/promises';
import path from 'path';
import { decodeCustomerName } from '../html-entities';
import {
  getPageStreamRefs,
  transformStream,
  processStream,
  buildOverlayStream,
  appendOverlayToPage,
  replaceInTextObjects,
  registerStandardFont,
} from './pdf-utils';
import { normalizeAddress } from './address-normalizer';

// ── Original values (from the source PDF) ──────────────────────────
const ORIGINAL_ACCOUNT = '30549703647';
const ORIGINAL_BILL_DIGITS = '2025020998273681'; // YYYYMMDD + 8 random

// Original dates as digit sequences (DDMMYYYY as they appear in DD/MM/YYYY)
const ORIG_BILL_DATE = '09022025';
const ORIG_PERIOD_START = '09012025';
const ORIG_PERIOD_END = '08022025';
const ORIG_DUE_DATE = '08032025';
const ORIG_PAYMENT_DATE = '23012025';
const ORIG_PAYMENT_TIME = '151229';

// Original mobile number (page 2)
const ORIGINAL_MOBILE = '601135992046';

// Name/address overlay config
const NAME_ADDR_OVERLAY = {
  x: 48.024,
  nameY: 646.75,
  addr1Y: 635.95,
  addr2Y: 624.91,
  addr3Y: 613.87,
  boxX: 44,
  boxY: 610,
  boxW: 290,
  boxH: 47,
  fontSize: 7.92,
  maxChars: 55,
};

// Original TJ byte patterns to blank out
const BLANK_TJ_PATTERNS = [
  Buffer.from('[(M)] TJ', 'ascii'),
  Buffer.from("[(r)-9( )-6(F)-44(O)-20(O)-48( )-6(G)-48(U)-19(A)-47(N)-19( )-6(Z)-44(H)-19(E)-45(N)-19(G)] TJ", 'ascii'),
  Buffer.from("[(3)-11(0)-11( )-5(J)-39(A)-14(L)-40(A)-14(N)-16( )-33(B)-14(E)-14(L)-40(I)-5(M)-47(B)-14(I)-5(N)-44(G)-16( )-5(I)-33(N)-16(D)-16(A)-42(H)-16( )-33(D)-16(')-7(B)-42(O)-16(U)-16(L)-40(E)-14(V)-42(A)-14(R)-44(D)-16( )] TJ", 'ascii'),
  Buffer.from('[(4)-11(3)-11(3)-11(0)-40(0)-11( )-33(S)-14(E)-14(R)-44(I)-5( )-5(K)-42(E)-14(M)-47(B)-14(A)-42(N)-16(G)-16(A)-42(N)-16( )-33(S)-14(E)-14(L)-40(A)-14(N)-44(G)-16(O)-45(R)-16( )-33(M)-18(A)-14(L)-40(A)-14(Y)-42(S)-14(I)-5(A)] TJ', 'ascii'),
];

// ── Value computation ───────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => randInt(0, 9)).join('');
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${d.getFullYear()}`;
}

function yyyymmdd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

function computeValues(customerMobile: string) {
  const today = new Date();

  // T-1 month
  let billM = today.getMonth(); // 0-indexed, so this is already T-1
  let billY = today.getFullYear();
  if (billM === 0) {
    billM = 12;
    billY--;
  }
  // billM is now 1-indexed month for T-1

  const billDay = randInt(3, 9);
  const billDate = new Date(billY, billM - 1, billDay);

  // Period: bill_day of (T-2) to (bill_day-1) of (T-1)
  let psM = billM - 1;
  let psY = billY;
  if (psM === 0) { psM = 12; psY--; }
  const periodStart = new Date(psY, psM - 1, billDay);
  const periodEnd = new Date(billY, billM - 1, billDay - 1);

  // Due date: (bill_day-1) of T
  const dueDate = new Date(today.getFullYear(), today.getMonth(), billDay - 1);

  // Random payment date within billing period
  const payDays = Math.floor((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const paymentDate = new Date(periodStart.getTime() + randInt(0, payDays) * 24 * 60 * 60 * 1000);

  const payH = randInt(10, 15);
  const payM = randInt(0, 59);
  const payS = randInt(0, 59);

  const newAccount = randomDigits(11);
  const newBillDigits = yyyymmdd(billDate) + randomDigits(8);

  // Customer mobile — strip leading '+', ensure 12 digits
  let mobileDigits = customerMobile.replace(/^\+/, '');
  if (mobileDigits.length < 12) mobileDigits = mobileDigits.padEnd(12, '0');
  else if (mobileDigits.length > 12) mobileDigits = mobileDigits.slice(0, 12);

  return {
    newAccount,
    newBillDigits,
    newMobile: mobileDigits,
    newBillDate: ddmmyyyy(billDate),
    newPeriodStart: ddmmyyyy(periodStart),
    newPeriodEnd: ddmmyyyy(periodEnd),
    newDueDate: ddmmyyyy(dueDate),
    newPaymentDate: ddmmyyyy(paymentDate),
    newPaymentTime: `${String(payH).padStart(2, '0')}${String(payM).padStart(2, '0')}${String(payS).padStart(2, '0')}`,
  };
}

function buildReplacements(v: ReturnType<typeof computeValues>): {
  streamReplacements: [string, string][];
  textReplacements: [string, string][];
} {
  const streamReplacements: [string, string][] = [
    [ORIGINAL_BILL_DIGITS, v.newBillDigits],
    [ORIGINAL_ACCOUNT, v.newAccount],
    [ORIG_BILL_DATE, v.newBillDate],
    [ORIG_PERIOD_START, v.newPeriodStart],
    [ORIG_PERIOD_END, v.newPeriodEnd],
    [ORIG_DUE_DATE, v.newDueDate],
    [ORIG_PAYMENT_DATE, v.newPaymentDate],
    [ORIG_PAYMENT_TIME, v.newPaymentTime],
    [ORIGINAL_MOBILE, v.newMobile],
  ];

  const fmtDate = (s: string) => `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`;
  const fmtTime = (s: string) => `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`;

  const textReplacements: [string, string][] = [
    ['INV' + ORIGINAL_BILL_DIGITS, 'INV' + v.newBillDigits],
    [ORIGINAL_ACCOUNT, v.newAccount],
    [fmtDate(ORIG_BILL_DATE), fmtDate(v.newBillDate)],
    [fmtDate(ORIG_PERIOD_START), fmtDate(v.newPeriodStart)],
    [fmtDate(ORIG_PERIOD_END), fmtDate(v.newPeriodEnd)],
    [fmtDate(ORIG_DUE_DATE), fmtDate(v.newDueDate)],
    [fmtDate(ORIG_PAYMENT_DATE), fmtDate(v.newPaymentDate)],
    [fmtTime(ORIG_PAYMENT_TIME), fmtTime(v.newPaymentTime)],
    [ORIGINAL_MOBILE, v.newMobile],
  ];

  return { streamReplacements, textReplacements };
}

// ── Main generator ──────────────────────────────────────────────

export interface CaseData {
  case_no: string;
  full_name: string;
  full_address: string;
  mobile: string;
}

export async function generateInternetBill(caseData: CaseData): Promise<Buffer> {
  // Compute replacement values
  const v = computeValues(caseData.mobile);
  const { streamReplacements, textReplacements } = buildReplacements(v);

  // Normalize address
  const addrLines = await normalizeAddress(
    caseData.full_address,
    'internet',
    '',
    NAME_ADDR_OVERLAY.maxChars,
  ) as string[];

  // Load template PDF
  const templatePath = path.join(process.cwd(), 'bill_generator', 'template', 'internet_bill.pdf');
  const templateBytes = await readFile(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes, { updateMetadata: false });

  const pages = pdfDoc.getPages();

  // Process each page's content streams
  for (let pageNum = 0; pageNum < pages.length; pageNum++) {
    const page = pages[pageNum];
    const streamEntries = getPageStreamRefs(pdfDoc, page);

    for (const entry of streamEntries) {
      const blanks = pageNum === 0 ? BLANK_TJ_PATTERNS : undefined;
      transformStream(pdfDoc, entry, (buf) =>
        processStream(buf, streamReplacements, blanks)
      );
    }

    // Overlay name and address on page 1
    if (pageNum === 0) {
      // Register standard fonts for overlay
      registerStandardFont(pdfDoc, page, '/FHB', 'Helvetica-Bold');
      registerStandardFont(pdfDoc, page, '/FH', 'Helvetica');

      const o = NAME_ADDR_OVERLAY;
      const addrYKeys = [o.addr1Y, o.addr2Y, o.addr3Y];
      const lines: { text: string; x: number; y: number; font: string; fontSize: number }[] = [
        { text: decodeCustomerName(caseData.full_name), x: o.x, y: o.nameY, font: '/FHB', fontSize: o.fontSize },
      ];

      for (let i = 0; i < addrLines.length && i < addrYKeys.length; i++) {
        lines.push({
          text: addrLines[i],
          x: o.x,
          y: addrYKeys[i],
          font: '/FH',
          fontSize: o.fontSize,
        });
      }

      const overlayContent = buildOverlayStream({
        boxX: o.boxX,
        boxY: o.boxY,
        boxW: o.boxW,
        boxH: o.boxH,
        lines,
      });

      appendOverlayToPage(pdfDoc, page, overlayContent);
    }
  }

  // Replace in all string objects (bookmarks, metadata, annotations)
  replaceInTextObjects(pdfDoc, textReplacements);

  // Save and return as Buffer
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

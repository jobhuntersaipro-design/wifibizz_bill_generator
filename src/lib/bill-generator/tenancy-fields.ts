/**
 * Values a tenancy agreement is allowed to change, plus the sample strings
 * wiped from Chris's template.
 *
 * Stamp set (v3): tenant name + NRIC from the case; demised premises from the
 * case address; a fresh random landlord (every appearance, including the bank
 * account name); agreement / commence dates = generation day (Malaysia UTC+8);
 * expire = commence + 18 months − 1 day; monthly rent in RM800–2000 step 50;
 * security deposit = 2 × rent. Bank account number, term length, utility /
 * access-card / renew / use stay as the sample printed them.
 */

import {
  formatIcDashed,
  generateRandomLandlord,
  icDigits,
} from './owner-identity';
import { sanitize } from './address-parts';

/** Cover / schedule / signature tenant as printed on the sample. */
export const SAMPLE_TENANT_NAME = 'NUR SYAFIQAH BINTI ISMAIL NASRUDDIN';
export const SAMPLE_TENANT_NRIC = '960517-06-5498';

/** Cover-page wrap as the sample set it — two lines, BINTI on the first. */
export const SAMPLE_TENANT_NAME_LINE1 = 'NUR SYAFIQAH BINTI';
export const SAMPLE_TENANT_NAME_LINE2 = 'ISMAIL NASRUDDIN';

export const SAMPLE_LANDLORD_NAME = 'NOR ADIYANTI BINTI ADNAN';
export const SAMPLE_LANDLORD_NRIC = '830419-14-5480';

/** Cover `DATED THIS 15th DAY OF JANUARY 2026` pieces. */
export const SAMPLE_COVER_DAY = '15th';
export const SAMPLE_COVER_MONTH = 'JANUARY';
export const SAMPLE_COVER_YEAR = '2026';

/** First Schedule Section 1 and Section 5b as printed. */
export const SAMPLE_SCHEDULE_DATE = '15TH JANUARY 2026';
/** First Schedule Section 5c as printed (15 Jan 2026 + 18 months − 1 day). */
export const SAMPLE_EXPIRE_DATE = '14TH JULY 2027';

export const SAMPLE_PREMISES_FRAGMENTS = [
  'F-3A-3A, PELANGI UTAMA BLOCK F',
  'JLN MASJID, BANDAR UTAMA,',
  'JLN MASJID, BANDAR UTAMA',
  '47800 PETALING JAYA,',
  '47800 PETALING JAYA',
  'SELANGOR.',
] as const;

export const SAMPLE_RENT_AMOUNT = 'TWO THOUSAND ONLY (RM2,000.00)';
export const SAMPLE_DEPOSIT_AMOUNT = 'FOUR THOUSAND ONLY (RM4,000.00)';
export const SAMPLE_BANK_ACCOUNT = '7015 8357 68';
export const SAMPLE_CAR_PARK = 'ONE HUNDRED ONLY (RM100.00)';

export const RENT_MIN = 800;
export const RENT_MAX = 2000;
export const RENT_STEP = 50;
export const TERM_MONTHS = 18;

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
] as const;

const TEENS = [
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN',
  'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
] as const;

const TENS = [
  '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY',
] as const;

export interface AgreementDate {
  day: number;
  monthIndex: number;
  year: number;
}

export interface TenancyCaseData {
  case_no: string;
  full_name: string;
  full_address?: string;
  id_no: string;
}

export interface TenantStamp {
  name: string;
  nric: string;
  date: AgreementDate;
  expire: AgreementDate;
  premises: string;
  landlordName: string;
  landlordNric: string;
  rentRinggit: number;
}

/**
 * Malaysia calendar date (UTC+8), same offset `dayKeyMYT` uses. Bills otherwise
 * read `new Date()` local parts, which on Vercel is UTC — a late-evening MYT
 * download would still print yesterday. KL has no DST.
 */
export function agreementDateFrom(now = new Date()): AgreementDate {
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    day: myt.getUTCDate(),
    monthIndex: myt.getUTCMonth(),
    year: myt.getUTCFullYear(),
  };
}

/** Commence + 18 months − 1 day. Sample: 15 Jan 2026 → 14 Jul 2027. */
export function expireDateFrom(start: AgreementDate, months = TERM_MONTHS): AgreementDate {
  const commenceUtc = Date.UTC(start.year, start.monthIndex + months, start.day);
  const expire = new Date(commenceUtc - 24 * 60 * 60 * 1000);
  return {
    day: expire.getUTCDate(),
    monthIndex: expire.getUTCMonth(),
    year: expire.getUTCFullYear(),
  };
}

export function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** Cover ordinal: `5th` — suffix stays lowercase like the sample `15th`. */
export function coverDayLabel(date: AgreementDate): string {
  return `${date.day}${ordinalSuffix(date.day)}`;
}

/** First Schedule dates: `5TH SEPTEMBER 2026`. */
export function scheduleDateLabel(date: AgreementDate): string {
  return `${date.day}${ordinalSuffix(date.day).toUpperCase()} ${MONTHS[date.monthIndex]} ${date.year}`;
}

export function coverMonthLabel(date: AgreementDate): string {
  return MONTHS[date.monthIndex];
}

export function pickRentRinggit(rng: () => number = Math.random): number {
  const steps = Math.floor((RENT_MAX - RENT_MIN) / RENT_STEP) + 1;
  return RENT_MIN + Math.floor(rng() * steps) * RENT_STEP;
}

function belowHundred(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]} ${ONES[one]}` : TENS[ten];
}

/** Malaysian legal-style words for whole ringgit in the TA rent/deposit band. */
export function ringgitWords(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0 || amount > 9999) {
    throw new Error(`ringgitWords: unsupported amount ${amount}`);
  }
  if (amount === 0) return 'ZERO';
  const thousands = Math.floor(amount / 1000);
  const rest = amount % 1000;
  const parts: string[] = [];
  if (thousands) parts.push(`${ONES[thousands]} THOUSAND`);
  if (rest >= 100) {
    parts.push(`${ONES[Math.floor(rest / 100)]} HUNDRED`);
    const rem = rest % 100;
    if (rem) parts.push('AND', belowHundred(rem));
  } else if (rest) {
    if (thousands) parts.push('AND');
    parts.push(belowHundred(rest));
  }
  return parts.join(' ');
}

export function formatRm(amount: number): string {
  const whole = Math.round(amount);
  const grouped = whole >= 1000
    ? `${Math.floor(whole / 1000)},${String(whole % 1000).padStart(3, '0')}`
    : String(whole);
  return `RM${grouped}.00`;
}

export function ringgitAmountLabel(amount: number): string {
  return `${ringgitWords(amount)} ONLY (${formatRm(amount)})`;
}

export function tenancyStampFrom(
  caseData: TenancyCaseData,
  now = new Date(),
  rng: () => number = Math.random,
): TenantStamp {
  const digits = icDigits(caseData.id_no);
  const name = sanitize(caseData.full_name || '').toUpperCase();
  const landlord = generateRandomLandlord(now, rng, name);
  return {
    name,
    nric: digits.length === 12 ? formatIcDashed(digits) : sanitize(caseData.id_no || ''),
    date: agreementDateFrom(now),
    expire: expireDateFrom(agreementDateFrom(now)),
    premises: sanitize(caseData.full_address || '').toUpperCase(),
    landlordName: landlord.name.toUpperCase(),
    landlordNric: formatIcDashed(landlord.ic),
    rentRinggit: pickRentRinggit(rng),
  };
}

/** @deprecated use tenancyStampFrom — kept so existing imports keep compiling. */
export function tenantStampFrom(
  caseData: TenancyCaseData,
  now = new Date(),
  rng: () => number = Math.random,
): TenantStamp {
  return tenancyStampFrom(caseData, now, rng);
}

export const TEMPLATE_CANDIDATES = [
  'assets/tenancy-agreement-template.pdf',
  'bill_generator/template/tenancy_agreement.pdf',
  'src/lib/bill-generator/templates/tenancy-agreement.pdf',
] as const;

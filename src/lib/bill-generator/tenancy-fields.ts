/**
 * Values a tenancy agreement is allowed to change, plus the sample strings
 * wiped from Chris's template.
 *
 * Stamp set (v3): tenant name + NRIC from the case; demised premises from the
 * case address; a fresh random landlord (every appearance, including the bank
 * account name); agreement / commence dates = a random day in
 * [generation day − 6 months, generation day − 3 months] (Malaysia UTC+8);
 * expire = commence + 18 months − 1 day; monthly rent in RM800–2000 step 50;
 * security deposit = 2 × rent; bank account number is a fresh 10-digit
 * Malaysian-style grouping (`XXXX XXXX XX`) each download. Term length,
 * utility / access-card / renew / use stay as the sample printed them.
 */

import {
  formatIcDashed,
  generateRandomLandlord,
  icDigits,
} from './owner-identity';
import { type DocumentParties } from './document-parties';
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
/** Agreement date is this many months *before* generation day (inclusive window). */
export const AGREEMENT_LAG_MIN_MONTHS = 3;
export const AGREEMENT_LAG_MAX_MONTHS = 6;

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
  landlordWitnessName: string;
  landlordWitnessNric: string;
  tenantWitnessName: string;
  tenantWitnessNric: string;
  rentRinggit: number;
  bankAccount: string;
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

/** Same overflow-to-next-month rule `expireDateFrom` uses (`Date.UTC` day). */
export function addCalendarMonths(start: AgreementDate, months: number): AgreementDate {
  const d = new Date(Date.UTC(start.year, start.monthIndex + months, start.day));
  return {
    day: d.getUTCDate(),
    monthIndex: d.getUTCMonth(),
    year: d.getUTCFullYear(),
  };
}

export function agreementDateUtc(date: AgreementDate): number {
  return Date.UTC(date.year, date.monthIndex, date.day);
}

/** Uniform calendar day in [today−6 months, today−3 months] inclusive, MYT. */
export function pickAgreementDate(
  now = new Date(),
  rng: () => number = Math.random,
): AgreementDate {
  const today = agreementDateFrom(now);
  const start = addCalendarMonths(today, -AGREEMENT_LAG_MAX_MONTHS);
  const end = addCalendarMonths(today, -AGREEMENT_LAG_MIN_MONTHS);
  const startMs = agreementDateUtc(start);
  const endMs = agreementDateUtc(end);
  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  const offset = Math.min(days - 1, Math.max(0, Math.floor(rng() * days)));
  const picked = new Date(startMs + offset * 86_400_000);
  return {
    day: picked.getUTCDate(),
    monthIndex: picked.getUTCMonth(),
    year: picked.getUTCFullYear(),
  };
}

export function isAgreementDateInWindow(date: AgreementDate, now = new Date()): boolean {
  const today = agreementDateFrom(now);
  const t = agreementDateUtc(date);
  return (
    t >= agreementDateUtc(addCalendarMonths(today, -AGREEMENT_LAG_MAX_MONTHS)) &&
    t <= agreementDateUtc(addCalendarMonths(today, -AGREEMENT_LAG_MIN_MONTHS))
  );
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

/** 10 digits grouped like the template (`7015 8357 68`). Never the sample. */
export function pickBankAccount(rng: () => number = Math.random): string {
  const digit = () => String(Math.floor(rng() * 10));
  const group = (n: number) => Array.from({ length: n }, digit).join('');
  for (let i = 0; i < 32; i++) {
    const formatted = `${group(4)} ${group(4)} ${group(2)}`;
    if (formatted !== SAMPLE_BANK_ACCOUNT) return formatted;
  }
  return '4829 1063 75';
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

/** Prefer concatAddress / a complete paste over a short list-table fragment. */
export function orderInstallationAddress(o: {
  addressFull?: string | null;
  street?: string | null;
  postcode?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const full = (o.addressFull || '').trim();
  if (full) return full;
  const street = (o.street || '').trim();
  if (o.postcode && street.includes(o.postcode)) return street;
  return [street, [o.postcode, o.city].filter(Boolean).join(' '), o.state]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function pickFullestAddress(...candidates: (string | undefined | null)[]): string {
  return candidates
    .map((c) => sanitize(c || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

/** A list/control-app fragment is usually missing the postcode. */
export function looksCompleteAddress(address: string): boolean {
  const t = (address || '').trim();
  return t.length >= 24 && /\b\d{5}\b/.test(t);
}

export function tenancyStampFrom(
  caseData: TenancyCaseData,
  now = new Date(),
  rng: () => number = Math.random,
  parties?: DocumentParties,
): TenantStamp {
  const digits = icDigits(caseData.id_no);
  const name = sanitize(caseData.full_name || '').toUpperCase();
  const landlord = parties?.landlord
    ? { name: parties.landlord.name, nric: parties.landlord.nric }
    : (() => {
        const drawn = generateRandomLandlord(now, rng, name);
        return { name: drawn.name.toUpperCase(), nric: formatIcDashed(drawn.ic) };
      })();
  const date = pickAgreementDate(now, rng);
  const rentRinggit = pickRentRinggit(rng);
  const bankAccount = pickBankAccount(rng);
  // Witnesses after rent/bank so existing stamp rng sequences stay stable.
  const used = `${name} ${landlord.name}`;
  const landlordWitness = parties?.landlordWitness ?? (() => {
    const drawn = generateRandomLandlord(now, rng, used);
    return { name: drawn.name.toUpperCase(), nric: formatIcDashed(drawn.ic) };
  })();
  const tenantWitness = parties?.tenantWitness ?? (() => {
    const drawn = generateRandomLandlord(now, rng, `${used} ${landlordWitness.name}`);
    return { name: drawn.name.toUpperCase(), nric: formatIcDashed(drawn.ic) };
  })();
  return {
    name,
    nric: digits.length === 12 ? formatIcDashed(digits) : sanitize(caseData.id_no || ''),
    date,
    expire: expireDateFrom(date),
    premises: sanitize(caseData.full_address || '').toUpperCase(),
    landlordName: landlord.name.toUpperCase(),
    landlordNric: landlord.nric,
    landlordWitnessName: landlordWitness.name,
    landlordWitnessNric: landlordWitness.nric,
    tenantWitnessName: tenantWitness.name,
    tenantWitnessNric: tenantWitness.nric,
    rentRinggit,
    bankAccount,
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

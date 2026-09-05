/**
 * The values a tenancy agreement is allowed to change, plus the sample strings
 * that must be wiped from Chris's template.
 *
 * Landlord, premises, term commence/expire, rent, deposits and bank stay as the
 * 13-page sample printed them. Tenant name, tenant NRIC, and the agreement date
 * (cover + First Schedule §1) are stamped from the case and the generation day.
 */

import { formatIcDashed, icDigits } from './owner-identity';
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

/** First Schedule Section 1 as printed. */
export const SAMPLE_SCHEDULE_DATE = '15TH JANUARY 2026';

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
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

/** First Schedule §1: `5TH SEPTEMBER 2026`. */
export function scheduleDateLabel(date: AgreementDate): string {
  return `${date.day}${ordinalSuffix(date.day).toUpperCase()} ${MONTHS[date.monthIndex]} ${date.year}`;
}

export function coverMonthLabel(date: AgreementDate): string {
  return MONTHS[date.monthIndex];
}

/** The tenant + generation date the template should print. */
export function tenantStampFrom(caseData: TenancyCaseData, now = new Date()): TenantStamp {
  const digits = icDigits(caseData.id_no);
  return {
    name: sanitize(caseData.full_name || '').toUpperCase(),
    nric: digits.length === 12 ? formatIcDashed(digits) : sanitize(caseData.id_no || ''),
    date: agreementDateFrom(now),
  };
}

export const TEMPLATE_CANDIDATES = [
  'assets/tenancy-agreement-template.pdf',
  'bill_generator/template/tenancy_agreement.pdf',
  'src/lib/bill-generator/templates/tenancy-agreement.pdf',
] as const;

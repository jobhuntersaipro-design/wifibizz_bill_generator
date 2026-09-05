/**
 * Every value a tenancy agreement prints, computed in one place.
 *
 * The agreement restates the same particulars on the parties page and in the
 * First Schedule. They cannot disagree, so both read this object. Nothing here
 * touches pdf-lib, so the date rules and frozen sample text are testable alone.
 */

import { addMonths } from './time-invoice-fields';
import { formatIcDashed, icDigits, type OwnerIdentity } from './owner-identity';
import { sanitize } from './address-parts';

export const TERM_MONTHS = 18;
export const TERM_LABEL = '18 MONTHS';
export const MONTHLY_RENTAL_TEXT =
  'Ringgit Malaysia: TWO THOUSAND ONLY (RM2,000.00). EXTRA CAR PARK PER MONTH ONE HUNDRED ONLY (RM100.00)';
export const RENT_DUE = 'on or before the 7th day of each month';
export const BANK_NAME = 'MAYBANK BERHAD';
export const BANK_ACCOUNT_NAME = 'NOR ADIYANTI BINTI ADNAN';
export const BANK_ACCOUNT_NO = '7015 8357 68';
export const SECURITY_DEPOSIT = 'RM4,000.00';
export const SECURITY_DEPOSIT_NOTE = 'equivalent to two (2) months\' rent';
export const UTILITY_DEPOSIT = 'RM1,000.00';
export const ACCESS_CARD_DEPOSIT = 'RM150.00';
export const RENEWAL_LABEL = 'ONE (1) year';
export const PERMITTED_USE = 'RESIDENTIAL purpose use only';

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'TH';
  switch (day % 10) {
    case 1: return 'ST';
    case 2: return 'ND';
    case 3: return 'RD';
    default: return 'TH';
  }
}

/** `15TH JANUARY 2026` — the form the sample agreement uses for every date. */
export function agreementDateLabel(d: Date): string {
  const day = d.getDate();
  return `${day}${ordinalSuffix(day)} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The last day of an 18-month term that began on `commence`.
 *
 * 15 January 2026 + 18 months is 15 July 2027; the tenancy expires the day
 * before, matching the sample's `14TH JULY 2027`.
 */
export function expireFrom(commence: Date): Date {
  const end = addMonths(commence, TERM_MONTHS);
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
}

export interface TenancyCaseData {
  case_no: string;
  full_name: string;
  full_address: string;
  id_no: string;
}

export interface TenancyFields {
  agreementDate: string;
  commenceDate: string;
  expireDate: string;
  landlordName: string;
  landlordIc: string;
  tenantName: string;
  tenantIc: string;
  premises: string;
}

export function buildTenancyFields(
  caseData: TenancyCaseData,
  landlord: OwnerIdentity,
  now: Date,
): TenancyFields {
  const commence = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tenantIc = formatIcDashed(icDigits(caseData.id_no) || caseData.id_no);
  return {
    agreementDate: agreementDateLabel(commence),
    commenceDate: agreementDateLabel(commence),
    expireDate: agreementDateLabel(expireFrom(commence)),
    landlordName: sanitize(landlord.name).toUpperCase(),
    landlordIc: formatIcDashed(landlord.ic),
    tenantName: sanitize(caseData.full_name || '').toUpperCase(),
    tenantIc: tenantIc ? sanitize(tenantIc) : '',
    premises: sanitize(caseData.full_address || '').toUpperCase(),
  };
}

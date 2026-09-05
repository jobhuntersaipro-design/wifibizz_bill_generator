/**
 * The only values a tenancy agreement is allowed to change, plus the sample
 * strings that must be wiped from Chris's template.
 *
 * Landlord, dates, premises, term, rent, deposits and bank stay exactly as the
 * 13-page sample printed them. This module does not invent replacements for those.
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

export interface TenancyCaseData {
  case_no: string;
  full_name: string;
  full_address?: string;
  id_no: string;
}

export interface TenantStamp {
  name: string;
  nric: string;
}

/** The tenant the template should print. Name is uppercased like the sample. */
export function tenantStampFrom(caseData: TenancyCaseData): TenantStamp {
  const digits = icDigits(caseData.id_no);
  return {
    name: sanitize(caseData.full_name || '').toUpperCase(),
    nric: digits.length === 12 ? formatIcDashed(digits) : sanitize(caseData.id_no || ''),
  };
}

export const TEMPLATE_CANDIDATES = [
  'bill_generator/template/tenancy_agreement.pdf',
  'assets/tenancy-agreement-template.pdf',
  'src/lib/bill-generator/templates/tenancy-agreement.pdf',
] as const;

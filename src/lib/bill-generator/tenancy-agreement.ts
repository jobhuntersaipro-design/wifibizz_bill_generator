/**
 * Tenancy Agreement: stamp Chris’s 13-page sample.
 *
 * Tenant name, tenant NRIC, and the agreement date (cover + First Schedule §1)
 * change. Landlord, premises, term commence/expire, rent, deposits and bank stay
 * as the template printed them. The 7-page from-scratch recreate is not the
 * product PDF.
 *
 * Template path (first file that exists wins):
 *   TENANCY_TEMPLATE_PATH (env, optional)
 *   assets/tenancy-agreement-template.pdf
 *   bill_generator/template/tenancy_agreement.pdf
 *   src/lib/bill-generator/templates/tenancy-agreement.pdf
 */

import { access, readFile } from 'fs/promises';
import path from 'path';
import { stampTenancyAgreement } from './tenancy-stamp';
import {
  TEMPLATE_CANDIDATES,
  tenantStampFrom,
  type TenancyCaseData,
} from './tenancy-fields';

export type { TenancyCaseData };

export const TEMPLATE_MISSING =
  'Tenancy agreement template is missing. Add Chris’s 13-page sample PDF at ' +
  'assets/tenancy-agreement-template.pdf.';

export async function resolveTenancyTemplatePath(
  cwd: string = process.cwd(),
): Promise<string | null> {
  const envPath = process.env.TENANCY_TEMPLATE_PATH?.trim();
  const candidates = [
    ...(envPath ? [envPath] : []),
    ...TEMPLATE_CANDIDATES.map((rel) => path.join(cwd, rel)),
  ];
  for (const abs of candidates) {
    try {
      await access(abs);
      return abs;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function loadTenancyTemplate(templatePath?: string): Promise<Uint8Array> {
  if (templatePath) return readFile(templatePath);
  const found = await resolveTenancyTemplatePath();
  if (!found) throw new Error(TEMPLATE_MISSING);
  return readFile(found);
}

export async function generateTenancyAgreement(
  caseData: TenancyCaseData,
  templatePath?: string,
  now?: Date,
): Promise<Uint8Array> {
  const template = await loadTenancyTemplate(templatePath);
  return stampTenancyAgreement(template, tenantStampFrom(caseData, now));
}

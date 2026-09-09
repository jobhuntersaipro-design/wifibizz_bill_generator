/**
 * Tenancy Agreement: stamp Chris’s 13-page sample.
 *
 * Stamp set (v3): tenant from the case; premises from the case address; a
 * random landlord on every appearance (including the bank account name);
 * agreement + commence = random day in [generation day − 6 months,
 * generation day − 3 months] (Malaysia UTC+8); expire = +18 months − 1 day;
 * rent RM800–2000 step 50; deposit = 2 × rent; bank account number is a
 * fresh 10-digit Malaysian-style grouping each download. Drops the TENANT
 * IDENTIFICATION / MyKad pages.
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
  tenancyStampFrom,
  type TenancyCaseData,
} from './tenancy-fields';
import type { DocumentParties } from './document-parties';
import type { SignatureImage } from './landlord-signature';

export interface TenancyGenerateExtras {
  parties?: DocumentParties;
  signature?: SignatureImage | null;
  signatures?: SignatureImage[];
}

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
  rng?: () => number,
  extras?: TenancyGenerateExtras,
): Promise<Uint8Array> {
  const template = await loadTenancyTemplate(templatePath);
  return stampTenancyAgreement(
    template,
    tenancyStampFrom(caseData, now, rng, extras?.parties),
    extras?.signatures ?? (extras?.signature ? [extras.signature] : undefined),
  );
}

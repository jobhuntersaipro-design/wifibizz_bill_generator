// The company and the director a business case prints.
//
// Both the Bizz Chat's "Business Owner Name" and the Biz Auth Letter's director
// come from here, because the two documents are generated from one case and
// routinely travel together — the Combine dialog puts them in one PDF. Two
// generators would eventually name two different people for one company, and
// the mismatch would be visible side by side.

import { parseCompanyPair, resolveBizzChatFields, type BusinessSignals } from "./case-kind";
import { decodeCustomerName } from "./html-entities";
import { sanitize } from "./bill-generator/address-parts";
import { hashSeed, makeRng } from "./bill-generator/owner-identity";
import { directorIdNumber, realText } from "./director-id";

export { directorIdNumber, isMyKad } from "./director-id";

/** A case row or an order draft, plus whatever stable id the caller has. */
export interface BizIdentitySource extends BusinessSignals {
  case_no?: string | null;
}

export interface BizCompany {
  name: string;
  /** Company Registration No / BRN. Never an NRIC. */
  reg: string;
  /** `NAME (BRN)` — what the letterhead, both body paragraphs and the footer print. */
  line: string;
}

const present = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * `NAME (BRN)`. A company with no BRN prints its name alone rather than an empty
 * bracket, which would read as a missing value somebody should chase.
 */
export function companyLine(name: string, reg: string): string {
  if (!name) return reg ? `(${reg})` : "";
  return reg ? `${name} (${reg})` : name;
}

/**
 * The company, through the same rules the Bizz Chat has always used. The crawled
 * list view stores a biz customer as `COMPANY(REG)` in `full_name`, which is
 * where the pair comes from when the detail page has not been fetched.
 */
export function resolveBizCompany(s: BizIdentitySource): BizCompany {
  const pair = parseCompanyPair(s.full_name);
  const name = sanitize(
    decodeCustomerName(present(s.company_name) || pair?.companyName || ""),
  ).toUpperCase();
  const reg = sanitize(present(resolveBizzChatFields(s).customerId));
  return { name, reg, line: companyLine(name, reg) };
}

export interface BizDirector {
  /** The portal's Name; blank when it has only its dash. Never invented. */
  name: string;
  /** The portal's National ID No., as the case holds it (see `directorIdNumber`). */
  ic: string;
}

/**
 * The director, as WifiBizz records it: the Customer-tab Name and National ID No.
 *
 * Both the Bizz Chat's "Business Owner Name" and the Biz Auth Letter's director
 * come from here, because the two documents are generated from one case and
 * routinely travel together — the Combine dialog puts them in one PDF — so they
 * must name the same person.
 *
 * NOTHING IS INVENTED OR FILTERED: the case's original data (user, 2026-09-19).
 * The ID prints even under a missing name, and even when it is really the
 * company registration number.
 */
export function resolveBizDirector(s: BizIdentitySource & { id_no?: string | null }): BizDirector {
  return {
    name: sanitize(decodeCustomerName(realText(s.director_name))).toUpperCase(),
    ic: directorIdNumber(s),
  };
}

/**
 * Which admin-pool signature (/admin/landlord-signature) the director signs
 * with, as an rng for `loadRandomLandlordSignature` — or null when the case
 * names no director, because a signature above a blank name signs for nobody.
 *
 * WifiBizz case data is generated test data, not real people (user, 2026-09-19),
 * so stamping a pool image on the director's line forges nobody.
 *
 * SEEDED on the director, so one person signs in one hand across every download
 * and every case they direct — two downloads in two different hands is what gets
 * a document queried.
 */
export function bizSignatureRng(
  s: BizIdentitySource & { id_no?: string | null },
): (() => number) | null {
  const director = resolveBizDirector(s);
  if (!director.name) return null;
  return makeRng(hashSeed(`biz-signature:${director.name}:${director.ic}`));
}

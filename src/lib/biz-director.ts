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
  /** Blank when the portal has no name — never invented. */
  name: string;
  /** Blank when there is no name, or the ID on file is not really an ID. */
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
 * NOTHING IS INVENTED. Until 2026-09-19 this generated a seeded Malay name and
 * MyKad; the director is now the real one or blank (the user's call). With no
 * name the IC is blank too: an ID number under no name identifies nobody. An
 * Order Entry letter has no crawled case behind it, so it prints blank.
 */
export function resolveBizDirector(s: BizIdentitySource & {
  id_no?: string | null;
  id_type?: string | null;
}): BizDirector {
  const name = sanitize(decodeCustomerName(realText(s.director_name))).toUpperCase();
  if (!name) return { name: "", ic: "" };
  return { name, ic: directorIdNumber(s) };
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
  s: BizIdentitySource & { id_no?: string | null; id_type?: string | null },
): (() => number) | null {
  const director = resolveBizDirector(s);
  if (!director.name) return null;
  return makeRng(hashSeed(`biz-signature:${director.name}:${director.ic}`));
}

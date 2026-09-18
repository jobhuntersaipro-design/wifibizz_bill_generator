// The company and the invented director a business case prints.
//
// Both the Bizz Chat's "Business Owner Name" and the Biz Auth Letter's director
// come from here, because the two documents are generated from one case and
// routinely travel together — the Combine dialog puts them in one PDF. Two
// generators would eventually name two different people for one company, and
// the mismatch would be visible side by side.

import { parseCompanyPair, resolveBizzChatFields, type BusinessSignals } from "./case-kind";
import { decodeCustomerName } from "./html-entities";
import { sanitize } from "./bill-generator/address-parts";
import {
  generateRandomLandlord,
  hashSeed,
  makeRng,
  type OwnerIdentity,
} from "./bill-generator/owner-identity";

/** A case row or an order draft, plus whatever stable id the caller has. */
export interface BizIdentitySource extends BusinessSignals {
  /**
   * Only ever used to seed the director when the company is unknown. The Case
   * List passes `case_no`; Order Entry passes the normalised ID number it
   * already seeds every other generator with.
   */
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

/**
 * What the director is seeded on: the company where one is known, so every
 * document for that company names the same person however many cases it has.
 * Falls back to the case identity and then the customer name.
 */
export function directorSeedKey(s: BizIdentitySource): string {
  return resolveBizCompany(s).line || present(s.case_no) || present(s.full_name);
}

/**
 * The invented director.
 *
 * A Malay name and a MyKad-shaped number from `generateRandomLandlord`, the same
 * pools the tenancy agreement's landlord comes from — one generator for invented
 * Malaysians rather than two that can drift. That also brings the rule this
 * needs for free: the number's final-digit parity matches the name's BIN or
 * BINTI, so the IC cannot contradict the person it belongs to.
 *
 * SEEDED, unlike that landlord. The tenancy agreement is deliberately a fresh
 * person on every click, but these documents name an officer of a real, named
 * company. Nothing is stored, so two downloads handing back two different
 * directors would let an agent submit both — the trap `generateOwner` is seeded
 * to avoid.
 *
 * `now` only moves the IC's birth year, never the name: the rng is drawn for the
 * name first. So a chat and a letter generated either side of midnight still
 * agree on who the director is.
 */
export function resolveBizDirector(s: BizIdentitySource, now: Date = new Date()): OwnerIdentity {
  const company = resolveBizCompany(s);
  const rng = makeRng(hashSeed(`biz-director:${directorSeedKey(s)}`));
  // The company name goes where the tenancy agreement passes the tenant's, so a
  // father's name already appearing in the company is redrawn — an invented
  // director sharing a name with the business reads as a real officer.
  return generateRandomLandlord(now, rng, company.name);
}

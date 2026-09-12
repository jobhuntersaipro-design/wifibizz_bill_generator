// Business vs normal for Closing Script.
//
// Two generate paths only: Conversation Chat (residential) and Bizz Chat.
// This module decides which cases may open Bizz Chat, and which values the
// Bizz template prints for Customer ID (BRN) and Business Owner Name.

export interface BusinessSignals {
  provider?: string | null;
  package?: string | null;
  case_url?: string | null;
  company_name?: string | null;
  company_reg?: string | null;
  /** WifiBizz Customer-tab Name — the director, not the company. */
  director_name?: string | null;
  full_name?: string | null;
  /** Order Entry offer category, e.g. "unifi Biz Bundle Sale Catg". */
  offer_category?: string | null;
  /** Comma/semicolon-separated tags; a token "Bizz" counts. */
  tags?: string | null;
}

export interface CompanyPair {
  companyName: string;
  companyReg: string;
}

/**
 * The list-view `customer_name` for a biz case is `COMPANY(REG)`, e.g.
 * `MONBLEU CAFE(JM0920662-D)`. The crawler stores that as `full_name`.
 */
export function parseCompanyPair(fullName: string | null | undefined): CompanyPair | null {
  const m = (fullName ?? "").trim().match(/^(.*)\(([^)]+)\)\s*$/);
  if (!m) return null;
  const companyName = m[1].trim();
  const companyReg = m[2].trim();
  if (!companyName || !companyReg) return null;
  return { companyName, companyReg };
}

function present(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function hasBizzTag(tags: string | null | undefined): boolean {
  if (!tags) return false;
  return tags.split(/[,;/|]/).some((t) => t.trim().toLowerCase() === "bizz");
}

/**
 * Final rule used in code (starting rule + two product-specific signals):
 *
 * Business if any of:
 * 1. provider or package matches Unifi Business / Business Fibre (`\bbusiness(\s+fibre)?\b`)
 * 2. case_url is the WifiBizz Bizz module (`module=biz_fibre`)
 * 3. Order Entry offer category is the Biz catalogue (`\bbiz\b`)
 * 4. an explicit tag token `Bizz`
 * 5. Company Name or Company Registration No is set, including the crawled
 *    `COMPANY(REG)` shape in `full_name`
 *
 * Otherwise normal.
 */
export function isBusinessCase(s: BusinessSignals): boolean {
  const product = `${s.provider ?? ""} ${s.package ?? ""}`;
  if (/\bbusiness(\s+fibre)?\b/i.test(product)) return true;
  if (s.case_url && /[?&]module=biz_fibre\b/i.test(s.case_url)) return true;
  if (s.offer_category && /\bbiz\b/i.test(s.offer_category)) return true;
  if (hasBizzTag(s.tags)) return true;
  if (present(s.company_name) || present(s.company_reg)) return true;
  if (parseCompanyPair(s.full_name)) return true;
  return false;
}

export interface BizzChatFields {
  /** Company Registration No / BRN. Never NRIC. */
  customerId: string | null;
  /** Customer-tab Name / director. Never the company name. */
  businessOwnerName: string | null;
}

/**
 * Bizz Chat map for the two fields the residential row cannot supply:
 * Customer ID (BRN) → company_reg (or the REG in `COMPANY(REG)`), never `id_no`.
 * Business Owner → director_name, or `full_name` only when it is not a company pair.
 */
export function resolveBizzChatFields(s: BusinessSignals): BizzChatFields {
  const pair = parseCompanyPair(s.full_name);
  const customerId = present(s.company_reg) || pair?.companyReg || null;
  const director = present(s.director_name);
  const owner = director || (pair ? null : present(s.full_name) || null);
  return {
    customerId,
    businessOwnerName: owner,
  };
}

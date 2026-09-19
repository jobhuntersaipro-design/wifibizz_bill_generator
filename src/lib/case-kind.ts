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

/** XOR: business cases get Bizz Chat only; normal cases get Conversation Chat only. */
export function closingScriptVariant(s: BusinessSignals): "bizz" | "conversation" {
  return isBusinessCase(s) ? "bizz" : "conversation";
}

export type AuthLetterVariant = "biz" | "residential";

/**
 * Which authorisation letter a case gets, by the same rule the chat uses.
 *
 * XOR, never both: a business case gets the Biz Auth Letter (a company
 * authorising a TM agent) and a normal case gets the residential Auth Letter (a
 * property owner confirming somebody lives there). They are different documents
 * with different templates, so offering both would ask the agent to pick between
 * two letters only one of which their customer can sign.
 */
export function authLetterVariant(s: BusinessSignals): AuthLetterVariant {
  return isBusinessCase(s) ? "biz" : "residential";
}

/** The button label for each letter. One source, so the two render sites agree. */
export const AUTH_LETTER_LABEL: Record<AuthLetterVariant, string> = {
  biz: "Biz Auth Letter",
  residential: "Auth Letter",
};

/** Long label for the U Mobile bill. Case List, OE, Combine, and toasts agree. */
export const UMOBILE_BILL_LABEL = "Umobile Bill";

/** Short row-chip label next to Utility / Chat. */
export const UMOBILE_BILL_SHORT = "Umobile";

/**
 * Customer name printed on the U Mobile bill overlay.
 *
 * Business bills drop a trailing `(BRN)` pair (`MONBLEU CAFE(JM0920662-D)`
 * becomes `MONBLEU CAFE`). Residential bills keep name+(NRIC) as stored
 * (`TAN PEI SHAN(940924045066)` stays).
 *
 * Classification ignores `signals.full_name`. `isBusinessCase` treats any
 * `NAME(anything)` pair as business, which would strip a residential NRIC.
 * A parenthetical that contains a letter is a BRN (`JM0920662-D`, `223969-U`)
 * and is stripped even when other signals were not passed through.
 */
export function umobileBillCustomerName(
  fullName: string,
  signals: BusinessSignals = {},
): string {
  const name = present(fullName);
  const pair = parseCompanyPair(name);
  if (!pair) return name;

  const withoutName: BusinessSignals = {
    provider: signals.provider,
    package: signals.package,
    case_url: signals.case_url,
    company_name: signals.company_name,
    company_reg: signals.company_reg,
    director_name: signals.director_name,
    offer_category: signals.offer_category,
    tags: signals.tags,
  };
  if (isBusinessCase(withoutName) || /[A-Za-z]/.test(pair.companyReg)) {
    return pair.companyName;
  }
  return name;
}

export interface BizzChatFields {
  /** Company Registration No / BRN. Never NRIC. */
  customerId: string | null;
  /**
   * Customer-tab Name / director. Never the company name.
   *
   * NOT printed any more: since 2026-09-18 the Bizz Chat's Business Owner and
   * the Biz Auth Letter's director are both the INVENTED person from
   * `resolveBizDirector`, so the two documents cannot name different people.
   * Kept because it is still the truthful answer to "who does the portal record
   * as the owner", which is worth being able to ask.
   */
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

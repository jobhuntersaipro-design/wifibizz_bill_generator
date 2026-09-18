// The Bizz Chat closing script, built from a case or an order draft.
//
// One template for every Bizz customer regardless of provider; the labels,
// the four consent clauses and the closing "i agreed" are the ticket's text
// verbatim, so the PNG the agent sends reads exactly as the ticket does.

import { resolveBizzChatFields } from "./case-kind";
import { resolveBizDirector } from "./biz-director";
import { formatCustomerName, formatInstallDate, formatMobileRaw, formatPackage, type ChatScript } from "./chat-script";

/** The case fields the Bizz template prints. A CaseRow satisfies it as-is. */
export interface BizzChatSource {
  full_name: string | null;
  mobile: string | null;
  id_no: string | null;
  email: string | null;
  full_address: string | null;
  package: string | null;
  case_created_at: string | null;
  company_name?: string | null;
  company_reg?: string | null;
  director_name?: string | null;
  /** Only used to seed the invented Business Owner when no company is known. */
  case_no?: string | null;
}

export interface BizzChatScript extends ChatScript {
  agreement: "i agreed";
}

const MISSING = "—";

const present = (value: string | null): string => (value ?? "").trim() || MISSING;

export function buildBizzChatScript(c: BizzChatSource, installOffsetDays: number): BizzChatScript {
  const name = formatCustomerName(c.full_name);
  const biz = resolveBizzChatFields(c);
  // The Business Owner is INVENTED, and is the same person the Biz Auth Letter
  // names as director — the two documents are generated from one case and travel
  // together in a Combine bundle, so naming two different people would be visible
  // side by side. The rule lives in biz-director for exactly that reason.
  const director = resolveBizDirector(c);
  return {
    // Numbered 1-10 the way the Conversation Chat numbers its own fields, with
    // the same word joiners around the space after the number.
    lines: [
      { label: "1.\u2060 \u2060Customer Name (as per NRIC/Passport) : ", value: name },
      { label: "2.\u2060 \u2060Contact Number : ", value: formatMobileRaw(c.mobile) || MISSING },
      { label: "3.\u2060 \u2060Customer ID ( i.e BRN): ", value: present(biz.customerId) },
      { label: "4.\u2060 \u2060Business Owner Name: ", value: director.name },
      { label: "5.\u2060 \u2060Email Address : ", value: present(c.email) },
      { label: "6.\u2060 \u2060Installation Address: ", value: present(c.full_address) },
      // Literal, not a copy of the address: the product has no billing address to print.
      { label: "7.\u2060 \u2060Billing Address : ", value: "SAME AS ABOVE" },
      { label: "8.\u2060 \u2060Package to be subscribed : ", value: formatPackage(c.package?.trim() || null) },
      { label: "9.\u2060 \u2060Preferred Installation Date : ", value: formatInstallDate(c.case_created_at, installOffsetDays) },
      // Always a dash. The crawler's agent (e.g. "AI CHAT BOT") is not the customer's representative.
      { label: "10.\u2060 \u2060Representative Name ( if any) : ", value: "-" },
    ],
    terms: [
      "I hereby consent to subscribed the service with subscription contract of 24/36months.",
      "I have been informed on the Terms & Condition as at https://biz.unifi.com.my/business/biz-tnc and Privacy Notice of TM",
      "I agree to pay advance payment of RM 100 within 10 days after installation complete",
      "I hereby consent TM representative to proceed and process my order. Kindly notify me if there is any issues pertaining to my request.",
    ],
    agreement: "i agreed",
  };
}

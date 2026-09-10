// The Bizz Chat closing script, built from a case or an order draft.
//
// One template for every Bizz customer regardless of provider; the labels,
// the four consent clauses and the closing "i agreed" are the ticket's text
// verbatim, so the PNG the agent sends reads exactly as the ticket does.

import { formatInstallDate, formatMobileRaw, formatPackage, type ChatScript } from "./chat-script";

/** The case fields the Bizz template prints. A CaseRow satisfies it as-is. */
export interface BizzChatSource {
  full_name: string | null;
  mobile: string | null;
  id_no: string | null;
  email: string | null;
  full_address: string | null;
  package: string | null;
  case_created_at: string | null;
}

export interface BizzChatScript extends ChatScript {
  agreement: "i agreed";
}

const MISSING = "—";

const present = (value: string | null): string => (value ?? "").trim() || MISSING;

export function buildBizzChatScript(c: BizzChatSource, installOffsetDays: number): BizzChatScript {
  const name = present(c.full_name);
  return {
    lines: [
      { label: "Customer Name (as per NRIC/Passport) : ", value: name },
      { label: "Contact Number : ", value: formatMobileRaw(c.mobile) || MISSING },
      { label: "Customer ID ( i.e BRN): ", value: present(c.id_no) },
      // Nothing in the product records a director separately from the customer.
      { label: "Business Owner Name: ", value: name },
      { label: "Email Address : ", value: present(c.email) },
      { label: "Installation Address: ", value: present(c.full_address) },
      // Literal, not a copy of the address: the product has no billing address to print.
      { label: "Billing Address : ", value: "SAME AS ABOVE" },
      { label: "Package to be subscribed : ", value: formatPackage(c.package?.trim() || null) },
      { label: "Preferred Installation Date : ", value: formatInstallDate(c.case_created_at, installOffsetDays) },
      // Always a dash. The crawler's agent (e.g. "AI CHAT BOT") is not the customer's representative.
      { label: "Representative Name ( if any) : ", value: "-" },
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

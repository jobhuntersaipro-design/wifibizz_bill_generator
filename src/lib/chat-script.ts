// The closing script the WhatsApp chrome renders, and the field formatting
// every template shares.
//
// One shape for every variant, so the chrome prints whatever the script holds
// and carries no per-template branches. The Conversation Chat and the Bizz Chat
// print the same customer fields under different labels, so the rules for a
// phone number, a package name and the preferred installation date live here
// once rather than once per template.

import { decodeCustomerName } from "./html-entities";
import { formatPhone } from "./order-types";

/** Which template a chat prints. Conversation is residential only; Bizz is the business path. */
export type ChatScriptVariant = "conversation" | "bizz";

export interface ScriptLine {
  /** Printed first, including its colon and trailing space; the value follows on the same line. */
  label: string;
  value: string;
}

export interface ChatScript {
  /** Printed above the fields. The home conversation says "UNIFI"; the other templates have none. */
  heading?: string;
  lines: ScriptLine[];
  /** Without the leading ✅. The chrome adds it. */
  terms: string[];
  /** The sentence between the terms and the customer's reply, where the template has one. */
  consent?: string;
  /** The customer's reply that closes the script. */
  agreement: string;
}

/**
 * A Malaysian mobile as `+60 14-889 3212`, whatever shape it arrived in.
 *
 * The two entry points hand this different strings for the same customer — the
 * Case List passes the portal's `+60137089093`, Order Entry concatenates its
 * prefix and number field into `60137089093` — and a leading `0` turns up in
 * both. Normalising to one canonical form HERE is what stops a chat generated
 * from an order reading differently from the same customer's chat generated
 * from their case.
 *
 * Grouped by `formatPhone`, not by a second copy of the rule: the orders table
 * already prints phone numbers and the two must not drift apart.
 *
 * A number that is not a Malaysian mobile is returned as its bare digits rather
 * than being stamped `+60`, which would put an authoritative and wrong country
 * code on a foreign number — the same rule `formatPhone` follows for a length
 * it does not recognise.
 */
export function formatMobileRaw(mobile: string | null): string {
  if (!mobile) return "—";
  const digits = mobile.replace(/[^0-9]/g, "");
  if (!digits) return "—";
  const national = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
  // Malaysian mobiles are 1X… at 9 or 10 national digits, so a national number
  // can never itself begin "60" and the strip above is unambiguous.
  return /^1\d{8,9}$/.test(national) ? (formatPhone("60", national) ?? digits) : digits;
}

/** Portal-escaped names print as `YA'ASAK`, never `YA&#039;ASAK`. */
export function formatCustomerName(name: string | null | undefined): string {
  return decodeCustomerName(name) || "—";
}

/** Drops the bundled hardware: "Unifi Home 500Mbps + Router" prints as "Unifi Home 500Mbps". */
export function formatPackage(pkg: string | null): string {
  if (!pkg) return "—";
  const plusIndex = pkg.indexOf("+");
  if (plusIndex > 0) {
    return pkg.slice(0, plusIndex).trim();
  }
  return pkg;
}

/** Residential Conversation Chat only — never the Bizz BRN/owner T&C template. */
export function buildConversationChatScript(
  c: {
    full_name: string | null;
    mobile: string | null;
    id_no: string | null;
    email: string | null;
    full_address: string | null;
    package: string | null;
    case_created_at: string | null;
  },
  installOffsetDays: number,
): ChatScript {
  const name = formatCustomerName(c.full_name);
  const mobile = formatMobileRaw(c.mobile);
  const idNo = c.id_no || "—";
  const email = c.email || "—";
  const address = c.full_address || "—";
  const pkg = formatPackage(c.package);
  const installDate = formatInstallDate(c.case_created_at, installOffsetDays);

  return {
    heading: "UNIFI",
    lines: [
      { label: "1.\u2060 \u2060Customer Name (as per NRIC/Passport): ", value: name },
      { label: "2.\u2060 \u2060Contact Number: ", value: mobile },
      { label: "3.\u2060 \u2060Customer IC/Passport No.: ", value: idNo },
      { label: "4.\u2060 \u2060Email Address:", value: "" },
      { label: "", value: email },
      { label: "5.\u2060 \u2060Installation Address: ", value: address },
      { label: "6.\u2060 \u2060Package to be Subscribed: ", value: pkg },
      { label: "7.\u2060 \u2060Preferred Installation Date: ", value: installDate },
    ],
    terms: [
      "I hereby consent to subscribed the service with subscription contract of 24/27/30/36 months.",
      "I agree to pay advance payment of RM100 for Malaysian within 10 days after installation complete or Deposit RM500 for foreigner before installation",
      "I have been informed on the Terms & Condition as at https://unifi.com.my/personal/home/fibre-broadband/tnc and Privacy Notice of TM",
      "I hereby consent TM representative to proceed and process my order. Kindly notify me if there is any issues pertaining to my request.",
      "I acknowledge that the package order cannot be cancelled once the order has been submitted. Where applicable, I agree to bear any device penalty or related charges arising from cancellation, including where the device has already been processed for delivery.",
      "I acknowledge and agree to be liable for all applicable costs, charges, device penalties and expenses arising from any cancellation, early termination or breach of the applicable subscription terms.",
      "I hereby authorise the *TM representative* to proceed with and process my order based on the information provided.",
    ],
    consent: "By replying \u201CYES\u201D , I hereby acknowledge, confirm and agree to the following.",
    agreement: "YES I AGREED",
  };
}

/** The case's creation date (or today) plus the randomised offset, as DD/MM/YYYY. */
export function formatInstallDate(caseCreatedAt: string | null, offsetDays: number): string {
  const base = caseCreatedAt ? new Date(caseCreatedAt) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

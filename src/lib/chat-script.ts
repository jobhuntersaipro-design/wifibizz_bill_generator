// The closing script the WhatsApp chrome renders, and the field formatting
// every template shares.
//
// One shape for every variant, so the chrome prints whatever the script holds
// and carries no per-template branches. The Conversation Chat and the Bizz Chat
// print the same customer fields under different labels, so the rules for a
// phone number, a package name and the preferred installation date live here
// once rather than once per template.

import { decodeCustomerName } from "./html-entities";

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

/** Digits only, e.g. "+60 14-889 3212" prints as 60148893212. */
export function formatMobileRaw(mobile: string | null): string {
  if (!mobile) return "—";
  return mobile.replace(/[^0-9]/g, "");
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

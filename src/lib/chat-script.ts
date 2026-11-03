// The TM consent chat the WhatsApp chrome renders, and the field formatting it uses.
//
// One template for every customer (ClickUp z8v9xnjzb8). It replaced the residential
// Conversation Chat and the business Bizz Chat; the two buttons stay, and `variant`
// now only decides what field 3 prints and the PNG's filename.

import { decodeCustomerName } from "./html-entities";
import { formatPhone } from "./order-types";
import { resolveBizzChatFields } from "./case-kind";
import { formatFee } from "./plan-offer";

/** Which button generated the chat. Conversation = residential, Bizz = business. */
export type ChatScriptVariant = "conversation" | "bizz";

/** The message the chat bubble prints, then the customer's reply. */
export interface ChatScript {
  /** The TM consent template, filled. Tabs and spacing are the template's own. */
  text: string;
  /** The customer's reply that closes the script. */
  agreement: string;
}

/**
 * A Malaysian mobile as `+60 14-889 3212`, whatever shape it arrived in.
 *
 * The Case List passes the portal's `+60137089093`, Order Entry passes
 * `60137089093`, and a leading `0` turns up in both: one canonical form here.
 * A number that is not a Malaysian mobile is returned as its bare digits rather
 * than being stamped `+60`.
 */
export function formatMobileRaw(mobile: string | null): string {
  if (!mobile) return "—";
  const digits = mobile.replace(/[^0-9]/g, "");
  if (!digits) return "—";
  const national = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
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

// The TM consent template, verbatim. {n} = field n's value; {months} and {fee}
// fill the two "[XX]" in the terms. Spacing after each ✅ (one or two spaces)
// and the tabs are the template's own: do not tidy them.
export const CONSENT_TEMPLATE = [
  "1.\tCustomer Name (as per NRIC/Passport/BRN) :{1}",
  "2.\tContact Number :{2}",
  "3.\tCustomer IC (NRIC/Passport/BRN) :{3}",
  "4.\tEmail Address :{4}",
  "5.\tInstallation Address :{5}",
  "6.\tBilling Address :{6}",
  "7.\tOrder Type (New Install / Upgrade / Add-On / Other) :{7}",
  "8.\tPackage / Service to be Subscribed :{8}",
  "9.\tMonthly Subscription Fee :{9}",
  "10.\tContract Period (if applicable) :{10}",
  "11.\tPreferred Installation Date (if applicable) :{11}",
  "12.\tRepresentative Name (for Business customers, if applicable) :{12}",
  "13.\tExisting Service Login ID / Account Number (for Upgrade or Add-On orders, if applicable) :{13}",
  "",
  "Terms & Conditions:",
  "✅ I hereby consent to subscribe to the above service/package with a contract period of *{months} months* (if applicable).",
  "✅  I acknowledge that I have been informed, understood and agree to be bound by the applicable Terms & Conditions and TM Privacy Notice available at:",
  "•\tConsumer Customers: https://unifi.com.my/personal/home/fibre-broadband/tnc",
  "•\tBusiness Customers: https://biz.unifi.com.my/business/biz-tnc",
  "✅  As a Business Customer representative, I confirm that I am authorised to act on behalf of the Company and in a capacity to request the subscription, upgrade or any add on with regards to the service.",
  "✅  I agree to subscribe to the service/package at the monthly fee of *RM{fee}* (if applicable).",
  "✅  For new installations, customers are required to pay any applicable advance payment starting from RM100, in accordance with TM's prevailing policies. Foreign customers shall be subject to a mandatory deposit of RM500. The deposit must be paid prior to the submission of the installation order, while the advance payment must be settled within fourteen (14) days after the completion of the installation order.",
  "✅  I understand and agree that early termination of the service/package may result to early termination penalty based on the remaining contract commitment including any outstanding fees, device penalty (including where the device has already been processed, dispatched or delivered) and/or other applicable charges (if applicable).",
  "✅  I acknowledge and agree that the service/package order cannot be cancelled once the order has been submitted for processing.",
  "✅ I acknowledge that free installation covers up to 50 meters under Standard Installation. Additional charges may apply for cabling beyond 50 meters or any Non-Standard Installation works. For details, refer to the https://unifi.com.my/support/installation",
  "✅  I confirm that all information and supporting documents provided to TM is true, accurate, complete and genuine.",
  "✅  I hereby authorize TM and its representatives to verify and process my order. Kindly notify me if there are any issues pertaining to my request.",
  "✅  I acknowledge that this confirmation, whether provided electronically, digitally, verbally through recorded channels, or by any other method accepted by TM, shall constitute valid evidence of my consent and agreement to the service/package subscription and applicable contractual obligation",
].join("\n");

/** The 13 field values (index 0 = field 1) and the two term placeholders. "" = blank. */
export interface ConsentValues {
  fields: string[];
  months: string;
  fee: string;
}

/** Fill the template. A blank field leaves the label ending at its colon. */
export function fillConsentTemplate(v: ConsentValues): string {
  return CONSENT_TEMPLATE.replace(/\{(\d+|months|fee)\}/g, (_, k: string) => {
    if (k === "months") return v.months;
    if (k === "fee") return v.fee;
    const value = (v.fields[Number(k) - 1] ?? "").trim();
    return value ? ` ${value}` : "";
  });
}

/** "Unifi Home 300Mbps Premium Value (36M)" → "36". Blank when the name has no "(NNM)". */
export function contractMonths(pkg: string | null): string {
  return pkg?.match(/\((\d+)\s*M\)/i)?.[1] ?? "";
}

/** The case fields the consent chat prints. A CaseRow satisfies it as-is. */
export interface ConsentSource {
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
  /** "YYYY-MM-DD" from an Order Entry draft. Wins over the +3 days default. */
  preferred_install_date?: string | null;
}

/** Days after the case/order date the install date defaults to when none was chosen. */
export const DEFAULT_INSTALL_OFFSET_DAYS = 3;

const orBlank = (s: string) => (s === "—" ? "" : s);

/**
 * The TM consent chat for one case or order. `variant: "bizz"` prints the BRN in
 * field 3 (as the Bizz Chat did); otherwise the IC. `monthlyFee` is RM, e.g.
 * "189": the caller makes sure it is set, so the fee is never blank.
 */
export function buildConsentChatScript(
  c: ConsentSource,
  opts: { variant: ChatScriptVariant; monthlyFee: string },
): ChatScript {
  const customerId =
    opts.variant === "bizz" ? resolveBizzChatFields(c).customerId || c.id_no : c.id_no;
  const months = contractMonths(c.package);
  // "189.00" prints as "189"; a real fraction keeps two decimals ("139.50").
  const raw = opts.monthlyFee.trim();
  const fee = /^\d+(\.\d+)?$/.test(raw) ? formatFee(Number(raw)) : raw;
  const pref = c.preferred_install_date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const installDate = pref
    ? `${pref[3]}/${pref[2]}/${pref[1]}`
    : formatInstallDate(c.case_created_at, DEFAULT_INSTALL_OFFSET_DAYS);
  return {
    text: fillConsentTemplate({
      fields: [
        orBlank(formatCustomerName(c.full_name)),
        orBlank(formatMobileRaw(c.mobile)),
        customerId ?? "",
        c.email ?? "",
        c.full_address ?? "",
        "SAME AS ABOVE",
        "New Install",
        orBlank(formatPackage(c.package?.trim() || null)),
        fee ? `RM${fee}` : "",
        months ? `${months} months` : "",
        installDate,
        "",
        "",
      ],
      months,
      fee,
    }),
    agreement: "YES I AGREED",
  };
}

/** The case's creation date (or today) plus the offset, as DD/MM/YYYY. */
export function formatInstallDate(caseCreatedAt: string | null, offsetDays: number): string {
  const base = caseCreatedAt ? new Date(caseCreatedAt) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface BizzScriptInput {
  customerName: string | null;
  contactNumber: string | null;
  customerId: string | null;
  businessOwnerName: string | null;
  email: string | null;
  installationAddress: string | null;
  packageName: string | null;
  createdAt: string | null;
  installOffsetDays: number;
  representativeName: string | null;
}

export interface BizzScriptLine {
  label: string;
  value: string;
}

const MISSING = "—";

export const BIZZ_TERMS: string[] = [
  "I hereby consent to subscribed the service with subscription contract of 24/36months.",
  "I have been informed on the Terms & Condition as at https://biz.unifi.com.my/business/biz-tnc and Privacy Notice of TM",
  "I agree to pay advance payment of RM 100 within 10 days after installation complete",
  "I hereby consent TM representative to proceed and process my order. Kindly notify me if there is any issues pertaining to my request.",
];

export const BIZZ_AGREEMENT_REPLY = "i agreed";

function present(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t || MISSING;
}

function formatBizzMobile(mobile: string | null | undefined): string {
  const digits = (mobile ?? "").replace(/[^0-9]/g, "");
  return digits || MISSING;
}

function formatBizzPackage(pkg: string | null | undefined): string {
  const t = (pkg ?? "").trim();
  if (!t) return MISSING;
  const plusIndex = t.indexOf("+");
  if (plusIndex > 0) return t.slice(0, plusIndex).trim();
  return t;
}

/** Same calendar arithmetic as Conversation Chat: createdAt (or now) plus offsetDays, DD/MM/YYYY. */
export function formatBizzInstallDate(
  createdAt: string | null | undefined,
  offsetDays: number,
): string {
  const base = createdAt ? new Date(createdAt) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function buildBizzScriptLines(input: BizzScriptInput): BizzScriptLine[] {
  const representative = (input.representativeName ?? "").trim();
  return [
    { label: "Customer Name (as per NRIC/Passport) :", value: present(input.customerName) },
    { label: "Contact Number :", value: formatBizzMobile(input.contactNumber) },
    { label: "Customer ID ( i.e BRN):", value: present(input.customerId) },
    { label: "Business Owner Name:", value: present(input.businessOwnerName) },
    { label: "Email Address :", value: present(input.email) },
    { label: "Installation Address:", value: present(input.installationAddress) },
    { label: "Billing Address :", value: "SAME AS ABOVE" },
    { label: "Package to be subscribed :", value: formatBizzPackage(input.packageName) },
    {
      label: "Preferred Installation Date :",
      value: formatBizzInstallDate(input.createdAt, input.installOffsetDays),
    },
    { label: "Representative Name ( if any) :", value: representative || "-" },
  ];
}

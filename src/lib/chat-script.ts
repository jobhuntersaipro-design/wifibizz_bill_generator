// The closing script the WhatsApp chrome renders, and the field formatting
// every template shares.
//
// One shape for every variant, so the chrome prints whatever the script holds
// and carries no per-template branches. The Conversation Chat and the Bizz Chat
// print the same customer fields under different labels, so the rules for a
// phone number, a package name and the preferred installation date live here
// once rather than once per template.

/** Which template a chat prints. The conversation splits further into home and business by provider. */
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

/** Drops the bundled hardware: "Unifi Home 500Mbps + Router" prints as "Unifi Home 500Mbps". */
export function formatPackage(pkg: string | null): string {
  if (!pkg) return "—";
  const plusIndex = pkg.indexOf("+");
  if (plusIndex > 0) {
    return pkg.slice(0, plusIndex).trim();
  }
  return pkg;
}

/** The case's creation date (or today) plus the randomised offset, as DD/MM/YYYY. */
export function formatInstallDate(caseCreatedAt: string | null, offsetDays: number): string {
  const base = caseCreatedAt ? new Date(caseCreatedAt) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Field formatting shared by every closing script the WhatsApp chrome renders.
//
// The Conversation Chat and the Bizz Chat print the same customer fields under
// different labels, so the rules for a phone number, a package name and the
// preferred installation date live here once rather than once per template.

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

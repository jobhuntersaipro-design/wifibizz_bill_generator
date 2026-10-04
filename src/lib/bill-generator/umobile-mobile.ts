/**
 * Mobile No. printed on a Umobile bill (Home and Business share this).
 *
 * Malaysian mobiles: prefix `6011` plus 8 digits is 12 total. Every other
 * prefix (`6012`, `6013`, `6014`, `6016`, `6017`, `6018`, `6019`, …) plus 7
 * digits is 11 total. The prefix is the first four digits of the case mobile
 * — this does not choose a different prefix.
 */

export function umobileMobileSuffixLength(prefix: string): number {
  return prefix === "6011" ? 8 : 7;
}

export function umobileMobileDigitLength(prefix: string): number {
  return prefix.length + umobileMobileSuffixLength(prefix);
}

/**
 * The one Mobile No. for a bill.
 *
 * Digits the case already supplied are kept, then cut or filled so the suffix
 * is 8 after `6011` and 7 after any other prefix. A value that is not a digit
 * run stays on the template's 12-wide slot.
 */
export function generateUmobileMobile(
  raw: string,
  randomDigits: (count: number) => string,
): string {
  const digits = raw.replace(/^\+/, "");
  if (!/^\d{4,}$/.test(digits)) {
    return digits.padEnd(12, "0").slice(0, 12);
  }
  const prefix = digits.slice(0, 4);
  const suffixLength = umobileMobileSuffixLength(prefix);
  const supplied = digits.slice(4);
  if (supplied.length >= suffixLength) return prefix + supplied.slice(0, suffixLength);
  return prefix + supplied + randomDigits(suffixLength - supplied.length);
}

/**
 * The template draws the Mobile No. as 12 in-place digit slots. An 11-digit
 * number leaves the last slot blank so the extra zero is not printed.
 */
export function umobileMobileStreamToken(mobile: string): string {
  return mobile.padEnd(12, " ").slice(0, 12);
}

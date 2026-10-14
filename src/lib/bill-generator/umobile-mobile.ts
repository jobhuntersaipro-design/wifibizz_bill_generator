/**
 * Mobile No. printed on a Umobile bill (Home and Business share this): a new
 * U Mobile number, `011` + 8 random digits (ClickUp z8v9xnhhkh). The case's own
 * mobile is not used.
 */
export function generateUmobileMobile(randomDigits: (count: number) => string): string {
  return "011" + randomDigits(8);
}

/**
 * The template draws the Mobile No. as 12 in-place digit slots. An 11-digit
 * number leaves the last slot blank so the extra zero is not printed.
 */
export function umobileMobileStreamToken(mobile: string): string {
  return mobile.padEnd(12, " ").slice(0, 12);
}

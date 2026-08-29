/**
 * Who a notification goes to.
 *
 * One address per user, and the fallback is deliberate: `notificationEmail` is
 * nullable so a blank Settings field means "use my login email" rather than a
 * copy of it. Copying would freeze today's address into a second column and keep
 * mailing it after the login address changes.
 *
 * Pure, so the rule can be tested without a database or a mail provider.
 */
export function resolveRecipient(user: {
  notificationEmail?: string | null;
  email?: string | null;
}): string | null {
  // Trimmed, because a field holding only spaces is a blank field — treating it
  // as an address would send every notification into a provider error.
  const chosen = user.notificationEmail?.trim();
  if (chosen) return chosen;
  const login = user.email?.trim();
  return login || null;
}

/**
 * Is this a plausible destination address?
 *
 * Intentionally loose — one @, something either side, no whitespace. Resend is
 * the real validator; this exists so Settings can refuse an obvious typo at save
 * time instead of storing an address that silently swallows every notification.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Where a TEST email should go, given what the agent has typed.
 *
 * The typed value wins over the saved one on purpose: the point of the test is
 * to check an address BEFORE committing to it, and testing the stored value
 * while a different one sits unsaved in the box would answer a question nobody
 * asked. A blank box is not an error — it is the fallback `resolveRecipient`
 * really applies, so the test follows it to the login email.
 *
 * Returns the address or the reason there isn't one; pure, so the rule is
 * testable without a mail provider.
 */
export function testTargetFor(
  typed: string,
  user: { email?: string | null },
): { to: string } | { error: string } {
  const value = typed.trim();
  if (value) {
    if (!isValidEmail(value)) {
      return { error: "That doesn't look like an email address." };
    }
    return { to: value };
  }
  const login = user.email?.trim();
  if (!login) {
    return { error: "No address to send to — enter one above." };
  }
  return { to: login };
}

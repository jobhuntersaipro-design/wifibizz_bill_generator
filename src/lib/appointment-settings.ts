/**
 * The appointment lead time — the one thing the agent decides about booking.
 *
 * Shared by the order form, the zod schema that saves it and the payload that
 * carries it to the scraper, so all three agree on what a valid lead time is.
 * Pure: no Prisma, no `next/*`, so it can be unit tested directly.
 *
 * This used to be a global policy an admin set for everyone. The lead time is
 * now the agent's own choice per order, and an order with a preferred
 * installation date books that day (`fixed_date`) instead. The scraper already
 * understood both strategies, so it needed no change.
 */

/** What shipped before any of this was configurable. */
export const DEFAULT_LEAD_HOURS = 12;

/** Lead times outside this are a typo, not a choice. */
export const MIN_LEAD_HOURS = 0;
export const MAX_LEAD_HOURS = 24 * 30;

/** The shape the scraper reads. A fixed date comes only from the order's own
 *  preferred installation date — the scraper then books that day's first slot
 *  or fails, never another day. */
export type AppointmentPolicy =
  | { strategy: "first_available"; leadHours: number; fixedDate: null }
  | { strategy: "fixed_date"; leadHours: number; fixedDate: string };

/** Today in Malaysia time as "YYYY-MM-DD" — the portal's calendar clock. */
export function todayMyt(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** A real calendar date, "YYYY-MM-DD", not before today in Malaysia time. */
export function isValidPreferredDate(value: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  return value >= todayMyt(now);
}

export type LeadHoursValidation =
  | { ok: true; leadHours: number }
  | { ok: false; error: string };

/**
 * Validate a lead time as typed into the order form.
 *
 * An empty string is NOT valid here — the form always sends a number, and a
 * blank arriving at the boundary means something went wrong rather than "use
 * the default". Absence is expressed by omitting the field entirely.
 */
export function validateLeadHours(input: number | string): LeadHoursValidation {
  const trimmed = typeof input === "string" ? input.trim() : input;
  if (trimmed === "") {
    return { ok: false, error: "Enter how many hours ahead the slot must be." };
  }
  const leadHours = Number(trimmed);
  if (
    !Number.isInteger(leadHours) ||
    leadHours < MIN_LEAD_HOURS ||
    leadHours > MAX_LEAD_HOURS
  ) {
    return {
      ok: false,
      error: `Lead time must be a whole number of hours between ${MIN_LEAD_HOURS} and ${MAX_LEAD_HOURS}.`,
    };
  }
  return { ok: true, leadHours };
}

/**
 * The lead time an order actually submits with.
 *
 * Null is a real state, not a bug: every draft written before this column
 * existed has no lead time, and so does anything `scripts/bulk_create_order`
 * writes. Resolved in one place so the sentence the form prints and the number
 * the scraper receives cannot disagree. A stored value outside the range is
 * treated the same way as absent — a submit must never fail on it.
 */
export function leadHoursOrDefault(stored: number | null | undefined): number {
  if (stored === null || stored === undefined) return DEFAULT_LEAD_HOURS;
  const parsed = validateLeadHours(stored);
  return parsed.ok ? parsed.leadHours : DEFAULT_LEAD_HOURS;
}

/** The policy object the scraper payload carries. */
export function appointmentPolicyFor(
  stored: number | null | undefined,
  preferredDate?: string | null,
): AppointmentPolicy {
  const leadHours = leadHoursOrDefault(stored);
  if (preferredDate) return { strategy: "fixed_date", leadHours, fixedDate: preferredDate };
  return {
    strategy: "first_available",
    leadHours: leadHoursOrDefault(stored),
    fixedDate: null,
  };
}

/** Sentence describing the lead time, for the order form and the order detail. */
export function describeLeadTime(leadHours: number): string {
  if (leadHours === 0) {
    return "Books the earliest slot the portal offers, however soon it is.";
  }
  return `Books the earliest slot at least ${leadHours} hour${leadHours === 1 ? "" : "s"} from submit time.`;
}

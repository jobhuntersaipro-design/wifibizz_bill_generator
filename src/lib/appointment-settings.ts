/**
 * The appointment lead time — the one thing the agent decides about booking.
 *
 * Shared by the order form, the zod schema that saves it and the payload that
 * carries it to the scraper, so all three agree on what a valid lead time is.
 * Pure: no Prisma, no `next/*`, so it can be unit tested directly.
 *
 * This used to be a global policy an admin set for everyone, with a second
 * `fixed_date` strategy for watched test runs. Both are gone: the lead time is
 * now the agent's own choice per order, and a strategy that fails the order
 * outright when a named day has no slots is not one to hand to every agent.
 * The payload still names the strategy explicitly so the scraper — which still
 * understands both — needs no change.
 */

/** What shipped before any of this was configurable. */
export const DEFAULT_LEAD_HOURS = 12;

/** Lead times outside this are a typo, not a choice. */
export const MIN_LEAD_HOURS = 0;
export const MAX_LEAD_HOURS = 24 * 30;

/** The shape the scraper reads. `strategy`/`fixedDate` are pinned here rather
 *  than chosen anywhere, so nothing in the app can send a fixed date again. */
export interface AppointmentPolicy {
  strategy: "first_available";
  leadHours: number;
  fixedDate: null;
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
export function appointmentPolicyFor(stored: number | null | undefined): AppointmentPolicy {
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

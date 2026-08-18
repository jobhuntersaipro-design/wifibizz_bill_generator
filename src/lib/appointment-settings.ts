/**
 * The appointment booking policy — shape, defaults and validation.
 *
 * Shared by the admin Settings form, the server action that saves it, and the
 * payload that carries it to the scraper, so all three agree on what a valid
 * policy is. Pure: no Prisma, no `next/*`, so it can be unit tested directly.
 */

export const APPOINTMENT_STRATEGIES = ["first_available", "fixed_date"] as const;
export type AppointmentStrategy = (typeof APPOINTMENT_STRATEGIES)[number];

export interface AppointmentPolicy {
  strategy: AppointmentStrategy;
  /**
   * Earliest slot allowed, measured from submit time. Applies to
   * `first_available` only — a fixed date is an explicit override of the policy,
   * not something the lead time gets to veto.
   */
  leadHours: number;
  /** "YYYY-MM-DD", or null. Required when strategy is `fixed_date`. */
  fixedDate: string | null;
}

export const DEFAULT_APPOINTMENT_POLICY: AppointmentPolicy = {
  strategy: "first_available",
  leadHours: 12,
  fixedDate: null,
};

/** Lead times outside this are a typo, not a policy. */
export const MIN_LEAD_HOURS = 0;
export const MAX_LEAD_HOURS = 24 * 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as "YYYY-MM-DD" — NOT toISOString(), which is UTC and so
 *  rolls the date over for anyone east of Greenwich. Malaysia is UTC+8, where
 *  that would reject today as "past" for the whole working day. */
export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type PolicyValidation =
  | { ok: true; policy: AppointmentPolicy }
  | { ok: false; field: "strategy" | "leadHours" | "fixedDate"; error: string };

/**
 * Validate a policy as entered in admin.
 *
 * `today` is injected so the "no past dates" rule is testable without freezing
 * the clock, and so the check happens against the admin's own calendar day.
 */
export function validateAppointmentPolicy(
  input: { strategy?: string; leadHours?: number | string; fixedDate?: string | null },
  today: Date = new Date(),
): PolicyValidation {
  const strategy = String(input.strategy ?? "").trim() as AppointmentStrategy;
  if (!APPOINTMENT_STRATEGIES.includes(strategy)) {
    return { ok: false, field: "strategy", error: "Choose how the slot is picked." };
  }

  const leadHours = Number(input.leadHours);
  if (!Number.isInteger(leadHours) || leadHours < MIN_LEAD_HOURS || leadHours > MAX_LEAD_HOURS) {
    return {
      ok: false,
      field: "leadHours",
      error: `Lead time must be a whole number of hours between ${MIN_LEAD_HOURS} and ${MAX_LEAD_HOURS}.`,
    };
  }

  const fixedDate = (input.fixedDate ?? "").trim() || null;

  if (strategy === "fixed_date") {
    if (!fixedDate) {
      return { ok: false, field: "fixedDate", error: "Pick the date to book." };
    }
    if (!DATE_RE.test(fixedDate) || Number.isNaN(Date.parse(fixedDate))) {
      return { ok: false, field: "fixedDate", error: "Enter the date as YYYY-MM-DD." };
    }
    // Refused here rather than at submit time: a past fixed date fails every
    // order, one stranded order at a time, and the person who could fix it
    // never sees the error.
    if (fixedDate < toDateKey(today)) {
      return { ok: false, field: "fixedDate", error: "That date has already passed." };
    }
  }

  return {
    ok: true,
    // A stale date left behind by a strategy switch is dropped rather than
    // stored, so nothing can later read a fixed date the policy doesn't use.
    policy: { strategy, leadHours, fixedDate: strategy === "fixed_date" ? fixedDate : null },
  };
}

/** Sentence describing the policy, for the admin form and the drafts UI. */
export function describeAppointmentPolicy(p: AppointmentPolicy): string {
  if (p.strategy === "fixed_date" && p.fixedDate) {
    return `Books the earliest slot on ${p.fixedDate}. Submits fail if that day has no slots.`;
  }
  return `Books the earliest slot at least ${p.leadHours} hour${p.leadHours === 1 ? "" : "s"} from submit time.`;
}

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEAD_HOURS,
  MAX_LEAD_HOURS,
  MIN_LEAD_HOURS,
  appointmentPolicyFor,
  describeLeadTime,
  leadHoursOrDefault,
  validateLeadHours,
  isValidPreferredDate,
  todayMyt,
} from "@/lib/appointment-settings";
import { resolveErrorCode } from "@/lib/portal-error-rules";
import { retryVerdict } from "@/lib/retry-policy";

describe("validateLeadHours", () => {
  it("accepts a whole number inside the range, from a string or a number", () => {
    expect(validateLeadHours("24")).toEqual({ ok: true, leadHours: 24 });
    expect(validateLeadHours(24)).toEqual({ ok: true, leadHours: 24 });
    expect(validateLeadHours(" 6 ")).toEqual({ ok: true, leadHours: 6 });
  });

  it("accepts both ends of the range", () => {
    expect(validateLeadHours(MIN_LEAD_HOURS).ok).toBe(true);
    expect(validateLeadHours(MAX_LEAD_HOURS).ok).toBe(true);
  });

  it("refuses anything outside it", () => {
    expect(validateLeadHours(-1).ok).toBe(false);
    expect(validateLeadHours(MAX_LEAD_HOURS + 1).ok).toBe(false);
  });

  it("refuses a fraction — half an hour is a typo, not a lead time", () => {
    expect(validateLeadHours("12.5").ok).toBe(false);
  });

  it("refuses text and a blank box", () => {
    expect(validateLeadHours("soon").ok).toBe(false);
    // Blank is NOT silently the default: the form always sends a number, so a
    // blank at the boundary means something went wrong.
    expect(validateLeadHours("").ok).toBe(false);
    expect(validateLeadHours("   ").ok).toBe(false);
  });
});

describe("leadHoursOrDefault", () => {
  it("returns the stored value when it is usable", () => {
    expect(leadHoursOrDefault(50)).toBe(50);
    expect(leadHoursOrDefault(0)).toBe(0);
  });

  it("falls back for a draft that has none", () => {
    expect(leadHoursOrDefault(null)).toBe(DEFAULT_LEAD_HOURS);
    expect(leadHoursOrDefault(undefined)).toBe(DEFAULT_LEAD_HOURS);
  });

  it("falls back rather than throwing on a value outside the range", () => {
    // A submit must never fail on a stored number, however it got there.
    expect(leadHoursOrDefault(-5)).toBe(DEFAULT_LEAD_HOURS);
    expect(leadHoursOrDefault(MAX_LEAD_HOURS + 100)).toBe(DEFAULT_LEAD_HOURS);
  });
});

describe("appointmentPolicyFor", () => {
  it("always names first_available with no fixed date", () => {
    // Pinned: the scraper still understands a fixed date, but nothing in the
    // app may send one — it fails the order outright when the day has no slots.
    expect(appointmentPolicyFor(48)).toEqual({
      strategy: "first_available",
      leadHours: 48,
      fixedDate: null,
    });
    expect(appointmentPolicyFor(null)).toEqual({
      strategy: "first_available",
      leadHours: DEFAULT_LEAD_HOURS,
      fixedDate: null,
    });
  });
});

describe("describeLeadTime", () => {
  it("agrees in number with what it describes", () => {
    expect(describeLeadTime(1)).toContain("1 hour from");
    expect(describeLeadTime(12)).toContain("12 hours from");
  });

  it("says what zero means instead of printing '0 hours'", () => {
    expect(describeLeadTime(0)).toContain("however soon");
  });
});

describe("preferred installation date", () => {
  // 2026-10-10 17:00 UTC = 2026-10-11 01:00 in Malaysia.
  const now = new Date("2026-10-10T17:00:00Z");

  it("measures 'today' on the Malaysia clock", () => {
    expect(todayMyt(now)).toBe("2026-10-11");
  });

  it("refuses past dates and non-dates, accepts today and later", () => {
    expect(isValidPreferredDate("2026-10-10", now)).toBe(false);
    expect(isValidPreferredDate("2026-10-11", now)).toBe(true);
    expect(isValidPreferredDate("2026-10-12", now)).toBe(true);
    expect(isValidPreferredDate("2026-02-30", now)).toBe(false);
    expect(isValidPreferredDate("12/10/2026", now)).toBe(false);
  });

  it("a date makes the policy fixed_date; blank keeps first_available", () => {
    expect(appointmentPolicyFor(12, "2026-10-12")).toEqual({
      strategy: "fixed_date", leadHours: 12, fixedDate: "2026-10-12",
    });
    expect(appointmentPolicyFor(12, null).strategy).toBe("first_available");
    expect(appointmentPolicyFor(12, "").strategy).toBe("first_available");
  });

  it("the scraper's no-slots-on-date failure gets its own, non-retried code", () => {
    expect(resolveErrorCode("appointment_failed", "no slots on 2026-10-12 (the portal offered 2026-10-13)"))
      .toBe("appointment_date_unavailable");
    expect(resolveErrorCode("appointment_failed", "the portal offered no slots")).toBe("appointment_failed");
    expect(retryVerdict({ status: "failed", errorCode: "appointment_date_unavailable", errorMessage: null, autoRetries: 0, attempt: 1 } as never).retry)
      .toBe(false);
  });
});

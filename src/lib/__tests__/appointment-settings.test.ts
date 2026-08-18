import { describe, it, expect } from "vitest";
import {
  DEFAULT_APPOINTMENT_POLICY,
  MAX_LEAD_HOURS,
  describeAppointmentPolicy,
  toDateKey,
  validateAppointmentPolicy,
} from "@/lib/appointment-settings";

const TODAY = new Date("2026-08-17T09:00:00+08:00");

describe("validateAppointmentPolicy", () => {
  it("accepts the shipped default", () => {
    const r = validateAppointmentPolicy(DEFAULT_APPOINTMENT_POLICY, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.policy).toEqual({ strategy: "first_available", leadHours: 12, fixedDate: null });
  });

  it("accepts a future fixed date", () => {
    const r = validateAppointmentPolicy(
      { strategy: "fixed_date", leadHours: 12, fixedDate: "2026-08-31" },
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.policy.fixedDate).toBe("2026-08-31");
  });

  it("accepts today as a fixed date — the day has not passed yet", () => {
    const r = validateAppointmentPolicy(
      { strategy: "fixed_date", leadHours: 12, fixedDate: "2026-08-17" },
      TODAY,
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a past fixed date", () => {
    const r = validateAppointmentPolicy(
      { strategy: "fixed_date", leadHours: 12, fixedDate: "2026-08-16" },
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("fixedDate");
    expect(r.error).toMatch(/passed/i);
  });

  it("refuses fixed_date with no date", () => {
    const r = validateAppointmentPolicy(
      { strategy: "fixed_date", leadHours: 12, fixedDate: "" },
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("fixedDate");
  });

  it("refuses a malformed date", () => {
    const r = validateAppointmentPolicy(
      { strategy: "fixed_date", leadHours: 12, fixedDate: "31/08/2026" },
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("fixedDate");
  });

  it("refuses an unknown strategy", () => {
    const r = validateAppointmentPolicy({ strategy: "whenever", leadHours: 12 }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("strategy");
  });

  it.each([[-1], [MAX_LEAD_HOURS + 1], [1.5]])("refuses lead hours %s", (h) => {
    const r = validateAppointmentPolicy({ strategy: "first_available", leadHours: h }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("leadHours");
  });

  it("allows a zero lead time — same-day booking is a legitimate policy", () => {
    const r = validateAppointmentPolicy({ strategy: "first_available", leadHours: 0 }, TODAY);
    expect(r.ok).toBe(true);
  });

  it("drops a stale fixed date when the strategy is first_available", () => {
    // Otherwise a date left behind by a strategy switch stays in the row, and
    // a later reader can act on a fixed date the policy doesn't use.
    const r = validateAppointmentPolicy(
      { strategy: "first_available", leadHours: 12, fixedDate: "2026-08-31" },
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.policy.fixedDate).toBeNull();
  });
});

describe("toDateKey", () => {
  it("uses the local calendar day, not UTC", () => {
    // 08:00 in Malaysia (UTC+8) is the previous day in UTC. toISOString() would
    // report 2026-08-16 and make today look like a past date all morning.
    expect(toDateKey(new Date("2026-08-17T08:00:00+08:00"))).toBe("2026-08-17");
  });
});

describe("describeAppointmentPolicy", () => {
  it("names the date under fixed_date, and warns it can fail", () => {
    const s = describeAppointmentPolicy({
      strategy: "fixed_date",
      leadHours: 12,
      fixedDate: "2026-08-31",
    });
    expect(s).toContain("2026-08-31");
    expect(s).toMatch(/fail/i);
  });

  it("names the lead time under first_available", () => {
    expect(
      describeAppointmentPolicy({ strategy: "first_available", leadHours: 12, fixedDate: null }),
    ).toContain("12 hours");
  });
});

import { describe, it, expect } from "vitest";
import {
  collapseStageDetails,
  stageTimestamp,
  type JobStage,
} from "@/lib/order-submit";
import {
  LEGACY_PAGE1_CAPTURE_STAGE,
  isUnsetStep,
  type StageDetail,
} from "@/lib/order-types";

const d = (
  value: string,
  outcome: StageDetail["outcome"] = "ok",
  note?: string,
): StageDetail => ({ value, outcome, ...(note ? { note } : {}) });

const s = (name: string, detail?: StageDetail | null): JobStage => ({
  name,
  detail: detail ?? null,
  at: "2026-08-16T01:00:00Z",
});

describe("collapseStageDetails", () => {
  it("keeps the resolved value from the second emission of a stage", () => {
    // Every stage is reported twice: bare when it starts, again once the portal
    // answers. The answer is the whole point — it must win.
    const out = collapseStageDetails([
      s("checking_address"),
      s("checking_address", d("A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7")),
    ]);
    expect(out.checking_address.value).toBe("A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7");
  });

  it("does not let a later bare emission erase a resolved value", () => {
    // A stage can be re-entered (a retried sub-step). Blanking the address the
    // agent already saw would look like the run lost it.
    const out = collapseStageDetails([
      s("checking_plan", d("Unifi Home 500Mbps Premium Value With Device (36M)")),
      s("checking_plan"),
    ]);
    expect(out.checking_plan.value).toContain("500Mbps");
  });

  it("returns an empty map for a scraper that sends no history", () => {
    // Older droplet builds emit names only. The checklist must still render.
    expect(collapseStageDetails(undefined)).toEqual({});
    expect(collapseStageDetails([])).toEqual({});
  });

  it("ignores malformed entries instead of throwing", () => {
    const out = collapseStageDetails([
      { name: "" } as JobStage,
      s("checking_address", { value: "", outcome: "ok" }),
      s("placing_order", d("Order clicked")),
    ]);
    expect(out).toEqual({ placing_order: d("Order clicked") });
  });

  it("carries the failure outcome and the portal's own note", () => {
    const out = collapseStageDetails([
      s("checking_address", d("No serviceable address returned.", "failed", "address_not_found")),
    ]);
    expect(out.checking_address.outcome).toBe("failed");
    expect(out.checking_address.note).toBe("address_not_found");
  });

  it("surfaces a capture's key under its own stage", () => {
    const key = "order-screenshots/u1/o1/submit-2-broadband.jpg";
    const out = collapseStageDetails([s("capture_broadband", d(key))]);
    expect(out.capture_broadband.value).toBe(key);
  });

  it("still surfaces a Phase-1 capture, which older rows are recorded under", () => {
    const key = "order-screenshots/u1/o1/submit-2-page1.png";
    const out = collapseStageDetails([s(LEGACY_PAGE1_CAPTURE_STAGE, d(key))]);
    expect(out[LEGACY_PAGE1_CAPTURE_STAGE].value).toBe(key);
  });
});

describe("stageTimestamp", () => {
  it("reads an explicit UTC timestamp", () => {
    expect(stageTimestamp("2026-08-16T01:23:45.678Z")?.toISOString()).toBe(
      "2026-08-16T01:23:45.678Z",
    );
  });

  it("treats a bare timestamp as UTC, not local", () => {
    // Older droplet builds send utcnow().isoformat() with no offset. Trusting
    // new Date() there would shift every step by the server's timezone — this
    // test fails on any machine that is not on UTC if the guard is removed.
    expect(stageTimestamp("2026-08-16T01:23:45.678")?.toISOString()).toBe(
      "2026-08-16T01:23:45.678Z",
    );
  });

  it("keeps a timestamp that already carries an offset", () => {
    expect(stageTimestamp("2026-08-16T09:23:45+08:00")?.toISOString()).toBe(
      "2026-08-16T01:23:45.000Z",
    );
  });

  it("falls back to undefined rather than an Invalid Date", () => {
    // undefined lets Prisma default to now(): late, but never wrong by hours.
    expect(stageTimestamp(undefined)).toBeUndefined();
    expect(stageTimestamp("not a date")).toBeUndefined();
  });
});

describe("isUnsetStep", () => {
  it("treats a skipped mandatory field as unset, not done", () => {
    // Winback Tagging left at "---Please select---" is the case this exists for:
    // the run moves on, and a green tick would claim work that never happened.
    expect(isUnsetStep(d("Not selected", "skipped"))).toBe(true);
  });

  it("is false for a resolved or failed step, and for no detail at all", () => {
    expect(isUnsetStep(d("HSBA Wireless Access"))).toBe(false);
    expect(isUnsetStep(d("boom", "failed"))).toBe(false);
    expect(isUnsetStep(undefined)).toBe(false);
  });
});

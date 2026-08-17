import { describe, it, expect } from "vitest";
import { groupByAttempt, type StatusEventView } from "@/lib/order-history";
import { needsVoiding } from "@/lib/order-types";

const ev = (
  attempt: number,
  status: string,
  createdAt: string,
  stage: string | null = null,
  message: string | null = null,
): StatusEventView => ({ id: `${attempt}-${createdAt}`, attempt, status, stage, message, createdAt });

describe("groupByAttempt", () => {
  it("returns newest attempt first", () => {
    // The agent is asking about the attempt that just failed, not the first one.
    const out = groupByAttempt([
      ev(1, "submitting", "2026-08-15T01:00:00Z"),
      ev(2, "submitting", "2026-08-15T02:00:00Z"),
      ev(3, "submitting", "2026-08-15T03:00:00Z"),
    ]);
    expect(out.map((a) => a.attempt)).toEqual([3, 2, 1]);
  });

  it("keeps events within an attempt in chronological order", () => {
    // Within a run the order IS the story — it must never be reversed.
    const out = groupByAttempt([
      ev(1, "failed", "2026-08-15T01:00:30Z", "selecting_device"),
      ev(1, "submitting", "2026-08-15T01:00:00Z", "validating_draft"),
      ev(1, "submitting", "2026-08-15T01:00:15Z", "checking_address"),
    ]);
    expect(out[0].events.map((e) => e.stage)).toEqual([
      "validating_draft",
      "checking_address",
      "selecting_device",
    ]);
  });

  it("reports the terminal status as the attempt outcome", () => {
    const out = groupByAttempt([
      ev(1, "submitting", "2026-08-15T01:00:00Z"),
      ev(1, "warning", "2026-08-15T01:05:00Z", "selecting_device", "device refused"),
    ]);
    expect(out[0].outcome).toBe("warning");
    expect(out[0].endedAt).toBe("2026-08-15T01:05:00Z");
  });

  it("treats a run with no terminal event as still running", () => {
    // A live attempt has no end time — the UI shows it as running rather than
    // inventing an outcome.
    const out = groupByAttempt([
      ev(4, "submitting", "2026-08-15T01:00:00Z", "creating_customer"),
    ]);
    expect(out[0].outcome).toBe("submitting");
    expect(out[0].endedAt).toBeNull();
  });

  it("handles an empty stream", () => {
    expect(groupByAttempt([])).toEqual([]);
  });
});

describe("needsVoiding", () => {
  it("flags an order that exists in the portal but didn't complete", () => {
    // The portal mints the order number before the device is even selectable,
    // so a mid-flow failure always strands a real order.
    expect(needsVoiding({ status: "warning", orderId: "2608000121108732" })).toBe(true);
    expect(needsVoiding({ status: "failed", orderId: "2608000121108732" })).toBe(true);
  });

  it("does not flag a completed order", () => {
    expect(needsVoiding({ status: "submitted", orderId: "2608000121108732" })).toBe(false);
  });

  it("does not flag a failure that never reached the portal", () => {
    // Preflight failures (bad address, dead session) leave nothing behind.
    expect(needsVoiding({ status: "failed", orderId: null })).toBe(false);
    expect(needsVoiding({ status: "draft", orderId: null })).toBe(false);
  });
});

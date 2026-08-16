import { describe, it, expect } from "vitest";
import {
  SUBMIT_STEPS,
  elapsedLabel,
  formatDuration,
  heroFor,
  initialsFor,
  stepsCompleted,
  toneForStatus,
} from "@/lib/order-types";

describe("initialsFor", () => {
  it("takes the first and LAST name, not the first two", () => {
    // Names here run long and the first two words are often a shared given-name
    // pair, so "MU" would collide across unrelated customers.
    expect(initialsFor("MUHAMMAD SAHINU BIN INSANU")).toBe("MI");
    expect(initialsFor("WOJAK LANG")).toBe("WL");
  });

  it("handles one word, extra whitespace and nothing at all", () => {
    expect(initialsFor("Cher")).toBe("CH");
    expect(initialsFor("  ahmad   kamarul  ")).toBe("AK");
    expect(initialsFor("")).toBe("?");
  });
});

describe("toneForStatus", () => {
  it("maps every order status onto a colour family", () => {
    expect(toneForStatus("submitting")).toBe("running");
    expect(toneForStatus("submitted")).toBe("submitted");
    // order_entered is a resting SUCCESS state, not an in-flight one.
    expect(toneForStatus("order_entered")).toBe("submitted");
    expect(toneForStatus("warning")).toBe("warning");
    expect(toneForStatus("failed")).toBe("failed");
    expect(toneForStatus("draft")).toBe("draft");
  });

  it("falls back to draft for a status this build has never seen", () => {
    expect(toneForStatus("some_future_status")).toBe("draft");
  });
});

describe("heroFor", () => {
  it("leads with the order number — the value agents copy out", () => {
    const h = heroFor({ status: "submitted", orderId: "2608000121177971" });
    expect(h.value).toBe("2608000121177971");
    expect(h.isOrderNumber).toBe(true);
    expect(h.tone).toBe("submitted");
  });

  it("falls back to the status word when the portal has minted nothing", () => {
    const h = heroFor({ status: "draft", orderId: null });
    expect(h.value).toBe("Draft");
    expect(h.isOrderNumber).toBe(false);
  });

  it("keeps the failure tone on an order that failed WITH a number", () => {
    // The portal mints the number before the flow can fail, so this pairing is
    // common and must not read as a success.
    const h = heroFor({ status: "failed", orderId: "2608000121177971" });
    expect(h.isOrderNumber).toBe(true);
    expect(h.tone).toBe("failed");
  });

  it("treats a whitespace-only order id as absent", () => {
    expect(heroFor({ status: "submitting", orderId: "   " }).isOrderNumber).toBe(false);
  });
});

describe("stepsCompleted", () => {
  it("counts a stage once even though it is reported twice", () => {
    // Every stage is emitted bare, then again with its resolved detail.
    expect(stepsCompleted(["checking_address", "checking_address", "checking_plan"])).toBe(2);
  });

  it("collapses coarse aliases onto the step they begin", () => {
    // `feasibility` and `checking_address` are the same step; counting both
    // would let the total exceed 16.
    expect(stepsCompleted(["feasibility", "checking_address"])).toBe(1);
  });

  it("ignores unknown stages and nulls rather than inflating the count", () => {
    expect(stepsCompleted([null, undefined, "page1_captured", "not_a_step"])).toBe(0);
  });

  it("never exceeds the number of steps", () => {
    const all = SUBMIT_STEPS.map((s) => s.key);
    expect(stepsCompleted([...all, ...all])).toBe(SUBMIT_STEPS.length);
  });
});

describe("elapsedLabel / formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(38_000)).toBe("38s");
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });

  it("returns null for a run with no end, so the caller can tick live", () => {
    // A frozen number on a running submit would read as finished.
    expect(elapsedLabel("2026-08-16T01:00:00Z", null)).toBeNull();
  });

  it("returns null rather than a negative label on clock skew", () => {
    expect(elapsedLabel("2026-08-16T01:05:00Z", "2026-08-16T01:00:00Z")).toBeNull();
    expect(elapsedLabel("nonsense", "2026-08-16T01:00:00Z")).toBeNull();
  });

  it("measures a real run end to end", () => {
    expect(elapsedLabel("2026-08-16T01:00:00Z", "2026-08-16T01:04:12Z")).toBe("4m 12s");
  });
});

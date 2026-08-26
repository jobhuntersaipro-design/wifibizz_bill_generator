import { describe, expect, it } from "vitest";
import {
  CANCEL_STEPS,
  canCancel,
  canPortalCancel,
  canResubmit,
  canSubmit,
  captureLabel,
  progressReading,
  submitErrorCopy,
} from "@/lib/order-types";
import { groupByAttempt, type StatusEventView } from "@/lib/order-history";

describe("canPortalCancel", () => {
  it("admits a submitted order with a real portal order number", () => {
    expect(canPortalCancel({ status: "submitted", orderId: "2608000121750632" })).toBe(true);
  });

  it("is a sibling of canCancel, never a loosening: non-submitted stays out", () => {
    for (const status of ["draft", "warning", "order_entered", "failed", "cancelled", "submitting"]) {
      expect(canPortalCancel({ status, orderId: "2608000121750632" })).toBe(false);
      // Everything canPortalCancel admits, canCancel must admit too.
      if (canPortalCancel({ status, orderId: "2608000121750632" })) {
        expect(canCancel({ status })).toBe(true);
      }
    }
  });

  it("refuses a submitted order with no number to aim at", () => {
    expect(canPortalCancel({ status: "submitted", orderId: null })).toBe(false);
    expect(canPortalCancel({ status: "submitted", orderId: undefined })).toBe(false);
    // The capturing_order_no failure sentence must never count as a target.
    expect(
      canPortalCancel({
        status: "submitted",
        orderId: "Portal did not show a Customer Order Number",
      }),
    ).toBe(false);
  });
});

describe("groupByAttempt with a portal-cancel run", () => {
  const ev = (
    attempt: number,
    status: string,
    createdAt: string,
    stage: string | null = null,
  ): StatusEventView => ({
    id: `${attempt}-${status}-${createdAt}`,
    attempt,
    stage,
    status,
    message: null,
    errorCode: null,
    createdAt,
  });

  it("treats the cancelled event as terminal, not as still running", () => {
    const attempts = groupByAttempt([
      ev(2, "submitting", "2026-08-26T01:00:00Z", "opening_query"),
      ev(2, "submitting", "2026-08-26T01:00:10Z", "capturing_proof"),
      ev(2, "cancelled", "2026-08-26T01:00:30Z"),
    ]);
    expect(attempts[0].outcome).toBe("cancelled");
    expect(attempts[0].endedAt).toBe("2026-08-26T01:00:30Z");
  });

  it("keeps a failed cancel attempt reading as failed while the submit attempt keeps its own outcome", () => {
    const attempts = groupByAttempt([
      ev(1, "submitting", "2026-08-26T00:00:00Z", "creating_customer"),
      ev(1, "submitted", "2026-08-26T00:10:00Z"),
      ev(2, "submitting", "2026-08-26T01:00:00Z", "opening_query"),
      ev(2, "failed", "2026-08-26T01:01:00Z"),
    ]);
    expect(attempts.map((a) => [a.attempt, a.outcome])).toEqual([
      [2, "failed"],
      [1, "submitted"],
    ]);
  });
});

describe("the cancelling status locks every other action", () => {
  const cancelling = { status: "cancelling", orderId: "2608000121750632" };
  it("cannot submit, resubmit, or cancel again while the run is live", () => {
    expect(canSubmit(cancelling)).toBe(false);
    expect(canResubmit(cancelling)).toBe(false);
    expect(canCancel(cancelling)).toBe(false);
    expect(canPortalCancel(cancelling)).toBe(false);
  });
});

describe("progressReading against the cancel checklist", () => {
  it("places a known cancel stage on its step of 7", () => {
    const r = progressReading("locating_order", "cancelling", [], CANCEL_STEPS);
    expect(r.current).toBe(3);
    expect(r.heading).toBe("Step 4 of 7");
  });

  it("reads a confirmed cancel as all steps complete", () => {
    const r = progressReading("capturing_proof", "cancelled", [], CANCEL_STEPS);
    expect(r.done).toBe(CANCEL_STEPS.length);
    expect(r.pct).toBe(100);
    expect(r.heading).toBe(`All ${CANCEL_STEPS.length} steps complete`);
  });

  it("holds at the furthest observed step on an unknown stage instead of collapsing to step 1", () => {
    const r = progressReading(
      "capture_cancel_query",
      "cancelling",
      ["opening_query", "querying_customer"],
      CANCEL_STEPS,
    );
    expect(r.current).toBe(1);
    expect(r.heading).toBe("Step 2 of 7");
  });

  it("says Working… when nothing has been observed yet", () => {
    const r = progressReading("capture_cancel_query", "cancelling", [], CANCEL_STEPS);
    expect(r.heading).toBe("Working…");
  });

  it("leaves the default submit checklist arithmetic untouched", () => {
    const r = progressReading("creating_customer", "submitting");
    expect(r.heading).toBe("Step 3 of 17");
  });
});

describe("cancel vocabulary", () => {
  it("has agent-facing copy for every scraper cancel code", () => {
    for (const code of [
      "cancel_customer_not_found",
      "cancel_order_not_found",
      "cancel_option_missing",
      "cancel_confirm_unrecognised",
      "cancel_unconfirmed",
    ]) {
      expect(submitErrorCopy(code), code).not.toBeNull();
    }
  });

  it("labels the cancel capture slots instead of humanising them blindly", () => {
    expect(captureLabel("cancel_confirm")).toBe("Cancel — confirmation dialog");
    expect(captureLabel("cancel_proof")).toBe("Cancel — proof");
    expect(captureLabel("cancel_query")).toBe("Cancel — customer search");
    expect(captureLabel("cancel_order_tab")).toBe("Cancel — Order tab");
  });
});

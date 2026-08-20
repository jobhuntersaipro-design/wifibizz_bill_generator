import { describe, expect, it } from "vitest";
import { canResubmit, canSubmit, needsVoiding } from "@/lib/order-types";

/**
 * Which orders a row will offer to run.
 *
 * This is the only gate in the app in front of an action that can create real,
 * chargeable duplicate work in a third-party system: the Unifi portal mints an
 * order number BEFORE the device is even selectable, so a mid-flow failure
 * leaves a genuine order behind. Getting `canResubmit` wrong by one status is
 * how an agent ends up creating a second order for a customer who already has
 * one, so the whole truth table is pinned here rather than spot-checked.
 */

const STATUSES = [
  "draft",
  "submitting",
  "order_entered",
  "submitted",
  "warning",
  "failed",
] as const;

const o = (status: string, orderId: string | null) => ({ status, orderId });

describe("canSubmit — a draft the portal has never numbered", () => {
  it("allows every status except an in-flight run, while there is no order id", () => {
    for (const status of STATUSES) {
      expect(canSubmit(o(status, null))).toBe(status !== "submitting");
    }
  });

  it("is false for every status once an order id exists", () => {
    for (const status of STATUSES) {
      expect(canSubmit(o(status, "2603000102554652"))).toBe(false);
    }
  });

  it("treats a missing orderId field the same as null", () => {
    expect(canSubmit({ status: "draft" })).toBe(true);
  });
});

describe("canResubmit — a stranded order", () => {
  it("is offered ONLY for failed and warning rows that carry an order id", () => {
    for (const status of STATUSES) {
      const expected = status === "failed" || status === "warning";
      expect(canResubmit(o(status, "2603000102554652"))).toBe(expected);
    }
  });

  it("is never offered without an order id — that is plain canSubmit's job", () => {
    for (const status of STATUSES) {
      expect(canResubmit(o(status, null))).toBe(false);
    }
  });

  it("never offers to re-run a fully submitted order", () => {
    // The most consequential single case: this row's order is live and correct
    // in the portal, and a second run would duplicate a real customer order.
    expect(canResubmit(o("submitted", "2603000102554652"))).toBe(false);
  });

  it("agrees with needsVoiding, which is what flags the row visually", () => {
    for (const status of STATUSES) {
      for (const id of [null, "2603000102554652"]) {
        const row = o(status, id);
        // The badge and the button must never disagree: a row marked "Needs
        // voiding" with no way to act on it is a dead end, and a Resubmit
        // button on an unflagged row is unexplained.
        if (status !== "submitting") {
          expect(canResubmit(row)).toBe(needsVoiding(row));
        }
      }
    }
  });
});

describe("the two predicates never both fire", () => {
  it("offers at most one action per row", () => {
    for (const status of STATUSES) {
      for (const id of [null, "2603000102554652"]) {
        const row = o(status, id);
        expect(canSubmit(row) && canResubmit(row)).toBe(false);
      }
    }
  });
});

// ── Manual cancel: one way in, no way out ────────────────────────────────────
//
// "cancelled" is terminal bookkeeping for a submitted order. What these pin:
// only a submitted row offers the door, and once through it every submit-shaped
// action stays refused — a cancelled row that became submittable again would
// resurrect a live portal order from a state the agent was told was final.

import { STATUS_LABELS, STATUS_FILTERS, canCancel, toneForStatus } from "@/lib/order-types";

describe("canCancel", () => {
  it("offers cancel to submitted rows only", () => {
    expect(canCancel({ status: "submitted" })).toBe(true);
    for (const status of ["draft", "submitting", "order_entered", "warning", "failed", "cancelled"]) {
      expect(canCancel({ status })).toBe(false);
    }
  });
});

describe("a cancelled order is terminal", () => {
  const cancelled = { status: "cancelled", orderId: "2608000121750632" };

  it("can never be submitted or resubmitted", () => {
    expect(canSubmit(cancelled)).toBe(false);
    expect(canResubmit(cancelled)).toBe(false);
  });

  it("is not flagged as needing voiding — the agent explicitly chose its state", () => {
    expect(needsVoiding(cancelled)).toBe(false);
  });

  it("has its own label, filter option and tone", () => {
    expect(STATUS_LABELS.cancelled).toBe("Cancelled");
    expect(STATUS_FILTERS).toContain("cancelled");
    expect(toneForStatus("cancelled")).toBe("cancelled");
  });
});

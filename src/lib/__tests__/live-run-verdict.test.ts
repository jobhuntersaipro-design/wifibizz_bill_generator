import { describe, expect, it } from "vitest";
import { liveRunVerdict } from "@/lib/live-run-verdict";

const ORDER = "2609000000000001";

describe("liveRunVerdict mirrors applyResult", () => {
  it("submitted with an order number and an e-RF succeeded", () => {
    expect(liveRunVerdict({ status: "done", result_status: "submitted", order_id: ORDER, erf: true })).toBe("succeeded");
    expect(liveRunVerdict({ status: "done", result_status: "success", order_id: ORDER, erf: true })).toBe("succeeded");
  });

  it("submitted without an e-RF needs attention", () => {
    expect(liveRunVerdict({ status: "done", result_status: "submitted", order_id: ORDER, erf: false })).toBe("attention");
  });

  it("a Stop-before-Pay run (ready_to_pay with an order) needs attention", () => {
    expect(liveRunVerdict({ status: "done", result_status: "ready_to_pay", order_id: ORDER, erf: false })).toBe("attention");
  });

  it("an error with an order number needs attention; without one it failed", () => {
    expect(liveRunVerdict({ status: "done", result_status: "error", order_id: ORDER })).toBe("attention");
    expect(liveRunVerdict({ status: "done", result_status: "error", order_id: null })).toBe("failed");
  });

  it("a warning alone needs attention", () => {
    expect(liveRunVerdict({ status: "done", result_status: "ok", order_id: null, warning: "duplicate customer" })).toBe("attention");
  });

  it("a job that errored failed, whatever it carries", () => {
    expect(liveRunVerdict({ status: "error", result_status: null, order_id: null })).toBe("failed");
    expect(liveRunVerdict({ status: "error", result_status: "submitted", order_id: ORDER, erf: true })).toBe("failed");
  });

  it("a finished run with no order and no warning failed", () => {
    expect(liveRunVerdict({ status: "done", result_status: "success", order_id: null, erf: false })).toBe("failed");
  });
});

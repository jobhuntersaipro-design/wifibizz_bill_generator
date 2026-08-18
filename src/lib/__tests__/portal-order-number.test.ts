import { describe, it, expect } from "vitest";
import { POINT_OF_NO_RETURN, isPortalOrderNumber } from "@/lib/order-types";

describe("isPortalOrderNumber", () => {
  it("accepts a real Customer Order Number", () => {
    expect(isPortalOrderNumber("2608000121429283")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isPortalOrderNumber("  2608000121429283 ")).toBe(true);
  });

  it("rejects the capture stage's own failure sentence", () => {
    // `capturing_order_no` reports the number on success and this on failure, in
    // the SAME field. Writing it to Order.orderId would make the row claim a
    // portal order that does not exist — and mark it as needing voiding.
    expect(isPortalOrderNumber("Portal did not show a Customer Order Number")).toBe(false);
  });

  it("rejects empty, null and undefined", () => {
    expect(isPortalOrderNumber("")).toBe(false);
    expect(isPortalOrderNumber(null)).toBe(false);
    expect(isPortalOrderNumber(undefined)).toBe(false);
  });

  it("rejects anything non-numeric or the wrong length", () => {
    expect(isPortalOrderNumber("ORD-0012")).toBe(false);
    expect(isPortalOrderNumber("12345")).toBe(false); // too short to be one
    expect(isPortalOrderNumber("2608000121429283x")).toBe(false);
    expect(isPortalOrderNumber("260800012142928300000")).toBe(false); // too long
  });

  it("is keyed to the stage the drain actually reads", () => {
    // The order id is persisted off POINT_OF_NO_RETURN's stage detail. If that
    // key is ever renamed, the drain silently stops updating the number and a
    // resubmit goes back to showing the previous attempt's order — the exact bug
    // this guards.
    expect(POINT_OF_NO_RETURN).toBe("capturing_order_no");
  });
});

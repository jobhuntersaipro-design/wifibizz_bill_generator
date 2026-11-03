import { describe, expect, it } from "vitest";
import { checkPlanDetail } from "../plan-detail";

describe("checkPlanDetail", () => {
  it("accepts a plan and tidies the name", () => {
    expect(checkPlanDetail({ name: "  Unifi  Home 500Mbps ", price: "RM 189", contractMonths: "24" })).toEqual({
      ok: true, name: "Unifi Home 500Mbps", price: 189, contractMonths: 24,
    });
  });

  it("refuses a blank name, a bad price and bad months", () => {
    expect(checkPlanDetail({ name: " ", price: "189", contractMonths: "24" }).ok).toBe(false);
    expect(checkPlanDetail({ name: "A", price: "abc", contractMonths: "24" }).ok).toBe(false);
    expect(checkPlanDetail({ name: "A", price: "0", contractMonths: "24" }).ok).toBe(false);
    expect(checkPlanDetail({ name: "A", price: "189", contractMonths: "" }).ok).toBe(false);
    expect(checkPlanDetail({ name: "A", price: "189", contractMonths: "1.5" }).ok).toBe(false);
    expect(checkPlanDetail({ name: "A", price: "189", contractMonths: "0" }).ok).toBe(false);
  });
});

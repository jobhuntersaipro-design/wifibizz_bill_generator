import { describe, expect, it } from "vitest";
import { checkPlanDetail, parseCsv, readPlanCsv, PLAN_CSV_TEMPLATE } from "../plan-detail";

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


describe("readPlanCsv", () => {
  it("reads the template", () => {
    expect(readPlanCsv(PLAN_CSV_TEMPLATE)).toEqual({
      ok: true,
      rows: [{ name: "Unifi Home 500Mbps", price: "189", contractMonths: "24" }],
    });
  });

  it("accepts any column order, quoted commas, CRLF, a BOM and '24 months'", () => {
    const csv = '﻿Contract,Price,Plan name\r\n24 months,RM 139.50,"Unifi Biz, 300Mbps"\r\n36M,99,Plain\r\n';
    expect(readPlanCsv(csv)).toEqual({
      ok: true,
      rows: [
        { name: "Unifi Biz, 300Mbps", price: "RM 139.50", contractMonths: "24" },
        { name: "Plain", price: "99", contractMonths: "36" },
      ],
    });
  });

  it("names every bad line and refuses the file", () => {
    const r = readPlanCsv("Plan name,Price,Contract months\nA,abc,24\nB,10,x\nb,10,12\n");
    expect(r).toEqual({
      ok: false,
      errors: [
        "Line 2: Enter the price as a number, e.g. 189 or 189.50.",
        "Line 3: Enter the contract in whole months, e.g. 24 or 36.",
      ],
    });
  });

  it("refuses a duplicate name in the file, ignoring case", () => {
    const r = readPlanCsv("Plan name,Price,Contract months\nPlan A,10,12\nplan  a,20,24\n");
    expect(r).toEqual({ ok: false, errors: ['Line 3: "plan a" is also on line 2.'] });
  });

  it("refuses a file without the three headers", () => {
    expect(readPlanCsv("name,price\nA,1\n").ok).toBe(false);
    expect(readPlanCsv("").ok).toBe(false);
  });

  it("parses quoted quotes", () => {
    expect(parseCsv('a,"b ""c"""\n')).toEqual([["a", 'b "c"']]);
  });
});

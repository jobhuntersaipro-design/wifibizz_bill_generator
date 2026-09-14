import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  NO_STAFF_CODE,
  filterOptions,
  filterOrders,
  matchesStaffCode,
  resolveStaffCode,
  staffCodeOptions,
  type OrderListItem,
} from "../order-types";

const row = (id: string, staffCode: string | null) =>
  ({ id, status: "draft", createdAt: "2026-09-14T00:00:00Z", staffCode }) as unknown as OrderListItem;

describe("resolveStaffCode", () => {
  it("prefers the code recorded at submit over the owner's current code", () => {
    // The owner reconnected under another code after submitting: the record wins.
    expect(resolveStaffCode("TMRS00517", "TMRS00999")).toEqual({ code: "TMRS00517", recorded: true });
  });

  it("falls back to the owner's current code for a never-submitted row, flagged unrecorded", () => {
    expect(resolveStaffCode(null, "TMRS00517")).toEqual({ code: "TMRS00517", recorded: false });
    expect(resolveStaffCode("  ", "TMRS00517")).toEqual({ code: "TMRS00517", recorded: false });
  });

  it("is null when there is neither", () => {
    expect(resolveStaffCode(null, null)).toEqual({ code: null, recorded: false });
  });
});

describe("matchesStaffCode", () => {
  it("all passes everything, including rows with no code", () => {
    expect(matchesStaffCode(null, "all")).toBe(true);
    expect(matchesStaffCode("TMRS00517", "all")).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(matchesStaffCode(" tmrs00517 ", "TMRS00517")).toBe(true);
    expect(matchesStaffCode("TMRS00518", "TMRS00517")).toBe(false);
  });

  it("the no-code sentinel matches only rows without a code", () => {
    expect(matchesStaffCode(null, NO_STAFF_CODE)).toBe(true);
    expect(matchesStaffCode("", NO_STAFF_CODE)).toBe(true);
    expect(matchesStaffCode("TMRS00517", NO_STAFF_CODE)).toBe(false);
  });

  it("a code is not a substring match — TMRS0051 must not catch TMRS00517", () => {
    expect(matchesStaffCode("TMRS00517", "TMRS0051")).toBe(false);
  });
});

describe("staffCodeOptions", () => {
  it("dedupes across case, sorts, and reports rows with no code", () => {
    expect(staffCodeOptions(["tmrs00517", "TMRS00517", "TMRS00100", null])).toEqual({
      codes: ["TMRS00100", "TMRS00517"],
      hasNone: true,
    });
    expect(staffCodeOptions(["TMRS00517"]).hasNone).toBe(false);
  });
});

describe("filterOrders by staff code", () => {
  const rows = [row("a", "TMRS00517"), row("b", "TMRS00100"), row("c", null)];

  it("narrows to one code", () => {
    expect(filterOrders(rows, { ...EMPTY_FILTERS, staffCode: "TMRS00517" }).map((o) => o.id)).toEqual(["a"]);
  });

  it("narrows to rows with no code", () => {
    expect(filterOrders(rows, { ...EMPTY_FILTERS, staffCode: NO_STAFF_CODE }).map((o) => o.id)).toEqual(["c"]);
  });

  it("offers the codes present in the rows", () => {
    const opts = filterOptions(rows);
    expect(opts.staffCodes).toEqual(["TMRS00100", "TMRS00517"]);
    expect(opts.hasNoStaffCode).toBe(true);
  });
});

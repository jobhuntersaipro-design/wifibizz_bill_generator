import { describe, expect, it } from "vitest";
import {
  caseDateFilterBounds,
  isInvalidCaseDateRange,
  parseCaseDateField,
  setCaseListQueryParams,
} from "@/lib/case-list-filters";

describe("parseCaseDateField", () => {
  it("defaults to Created At", () => {
    expect(parseCaseDateField(null)).toBe("case_created_at");
    expect(parseCaseDateField("")).toBe("case_created_at");
    expect(parseCaseDateField("case_created_at")).toBe("case_created_at");
    expect(parseCaseDateField("created_at")).toBe("case_created_at");
  });

  it("accepts Updated At", () => {
    expect(parseCaseDateField("updated_at")).toBe("updated_at");
  });
});

describe("isInvalidCaseDateRange", () => {
  it("accepts a valid or open-ended range", () => {
    expect(isInvalidCaseDateRange("2026-01-01", "2026-01-31")).toBe(false);
    expect(isInvalidCaseDateRange("2026-09-10", "2026-09-10")).toBe(false);
    expect(isInvalidCaseDateRange("2026-09-10", "")).toBe(false);
    expect(isInvalidCaseDateRange("", "2026-09-01")).toBe(false);
    expect(isInvalidCaseDateRange("", "")).toBe(false);
  });

  it("flags To before From without rewriting either value", () => {
    expect(isInvalidCaseDateRange("2026-09-10", "2026-09-01")).toBe(true);
  });
});

describe("caseDateFilterBounds", () => {
  it("applies From/To only to the selected column", () => {
    expect(caseDateFilterBounds("case_created_at", "2026-01-01", "2026-01-31")).toEqual({
      createdFrom: "2026-01-01",
      createdTo: "2026-01-31",
      updatedFrom: "",
      updatedTo: "",
    });
    expect(caseDateFilterBounds("updated_at", "2026-01-01", "2026-01-31")).toEqual({
      createdFrom: "",
      createdTo: "",
      updatedFrom: "2026-01-01",
      updatedTo: "2026-01-31",
    });
  });
});

describe("setCaseListQueryParams", () => {
  it("always sends date_field so the toggle is visible on the wire", () => {
    const params = new URLSearchParams();
    setCaseListQueryParams(params, { search: "sahinu", dateField: "updated_at" });
    expect(params.get("search")).toBe("sahinu");
    expect(params.get("date_field")).toBe("updated_at");
  });
});

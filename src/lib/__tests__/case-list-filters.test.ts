import { describe, expect, it } from "vitest";
import {
  caseDateFilterBounds,
  clampCaseDateRange,
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

describe("clampCaseDateRange", () => {
  it("leaves a valid range alone", () => {
    expect(clampCaseDateRange("2026-01-01", "2026-01-31")).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });

  it("corrects To when it is before From", () => {
    expect(clampCaseDateRange("2026-09-10", "2026-09-01")).toEqual({
      dateFrom: "2026-09-10",
      dateTo: "2026-09-10",
    });
  });

  it("allows an open-ended range", () => {
    expect(clampCaseDateRange("2026-09-10", "")).toEqual({
      dateFrom: "2026-09-10",
      dateTo: "",
    });
    expect(clampCaseDateRange("", "2026-09-01")).toEqual({
      dateFrom: "",
      dateTo: "2026-09-01",
    });
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

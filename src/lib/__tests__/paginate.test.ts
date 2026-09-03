import { describe, expect, it } from "vitest";
import {
  PAGE_SIZES, DEFAULT_PAGE_SIZE, pageCount, clampPage, pageSlice, pageRangeLabel,
} from "../paginate";

const rows = Array.from({ length: 32 }, (_, i) => i + 1);

describe("pageCount", () => {
  it("rounds up and never reports zero pages", () => {
    expect(pageCount(32, 10)).toBe(4);
    expect(pageCount(30, 10)).toBe(3);
    expect(pageCount(0, 10)).toBe(1); // "Page 1 of 1", never "of 0"
    expect(pageCount(1, 50)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps a valid page and clamps both ends", () => {
    expect(clampPage(2, 32, 10)).toBe(2);
    expect(clampPage(0, 32, 10)).toBe(1);
    expect(clampPage(99, 32, 10)).toBe(4);
    expect(clampPage(NaN, 32, 10)).toBe(1);
  });

  it("lands a stranded page on the LAST real page after a filter shrinks the set", () => {
    // On page 3 of 60 rows, then a search narrows to 8: the view must show
    // the 8 rows, not a blank page 3.
    expect(clampPage(3, 8, 25)).toBe(1);
  });
});

describe("pageSlice", () => {
  it("slices without dropping or duplicating across pages", () => {
    const all = [10, 25, 50].flatMap(() => []);
    for (const per of PAGE_SIZES) {
      const seen: number[] = [];
      for (let p = 1; p <= pageCount(rows.length, per); p++) {
        seen.push(...pageSlice(rows, p, per));
      }
      expect(seen).toEqual(rows);
    }
    expect(all).toEqual([]);
  });

  it("last page holds the remainder", () => {
    expect(pageSlice(rows, 4, 10)).toEqual([31, 32]);
  });

  it("an out-of-range page clamps instead of returning nothing", () => {
    expect(pageSlice(rows, 99, 10)).toEqual([31, 32]);
  });
});

describe("pageRangeLabel", () => {
  it("prints the shown range", () => {
    expect(pageRangeLabel(1, 32, 25)).toBe("1–25 of 32");
    expect(pageRangeLabel(2, 32, 25)).toBe("26–32 of 32");
    expect(pageRangeLabel(1, 0, 25)).toBe("0 of 0");
  });
});

describe("page sizes", () => {
  it("offers exactly 10/25/50 with 25 as default", () => {
    expect([...PAGE_SIZES]).toEqual([10, 25, 50]);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });
});

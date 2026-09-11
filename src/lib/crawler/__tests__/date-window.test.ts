import { describe, expect, it } from "vitest";
import {
  crawlLookbackStart,
  formatCrawlDate,
  isCrawlDateInLookback,
  splitCrawlDateRange,
  toPortalCreatedAtFilter,
} from "../date-window";

const now = new Date("2026-03-15T12:00:00.000Z");

describe("crawl date lookback", () => {
  it("formats the same way as the crawl page helper", () => {
    expect(formatCrawlDate(now)).toBe("2026-03-15");
  });

  it("allows the calendar day 12 months before now", () => {
    expect(formatCrawlDate(crawlLookbackStart(now))).toBe("2025-03-15");
    expect(isCrawlDateInLookback("2025-03-15", now)).toBe(true);
  });

  it("rejects the day before the 12-month floor", () => {
    expect(isCrawlDateInLookback("2025-03-14", now)).toBe(false);
  });

  it("allows a date 11 months before now", () => {
    expect(isCrawlDateInLookback("2025-04-15", now)).toBe(true);
  });
});

describe("toPortalCreatedAtFilter", () => {
  it("formats the WifiBizz Advanced Search created_at range", () => {
    expect(toPortalCreatedAtFilter("2025-09-11", "2026-09-11")).toBe(
      "11/09/2025 - 11/09/2026"
    );
  });
});

describe("splitCrawlDateRange", () => {
  it("keeps a short range as one chunk", () => {
    expect(splitCrawlDateRange("2026-08-01", "2026-08-20")).toEqual([
      { from: "2026-08-01", to: "2026-08-20" },
    ]);
  });

  it("splits a year into oldest-first 31-day chunks covering every day", () => {
    const chunks = splitCrawlDateRange("2025-09-11", "2026-09-11");
    expect(chunks[0]).toEqual({ from: "2025-09-11", to: "2025-10-11" });
    expect(chunks.at(-1)?.to).toBe("2026-09-11");
    expect(chunks.length).toBeGreaterThan(10);

    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = Date.parse(chunks[i - 1].to + "T00:00:00Z");
      const nextStart = Date.parse(chunks[i].from + "T00:00:00Z");
      expect(nextStart - prevEnd).toBe(86_400_000);
    }
  });

  it("returns empty when to is before from", () => {
    expect(splitCrawlDateRange("2026-09-11", "2025-09-11")).toEqual([]);
  });
});

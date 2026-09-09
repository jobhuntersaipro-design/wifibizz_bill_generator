import { describe, expect, it } from "vitest";
import {
  crawlLookbackStart,
  formatCrawlDate,
  isCrawlDateInLookback,
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

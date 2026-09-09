export const CRAWL_LOOKBACK_MONTHS = 12;

export type CrawlDateWindow = {
  start: string;
  end: string;
};

export function formatCrawlDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function crawlLookbackStart(now: Date): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - CRAWL_LOOKBACK_MONTHS);
  return d;
}

export function crawlDateWindow(now: Date): CrawlDateWindow {
  return {
    start: formatCrawlDate(crawlLookbackStart(now)),
    end: formatCrawlDate(now),
  };
}

export function isCrawlDateInLookback(isoDate: string, now: Date): boolean {
  return isoDate >= crawlDateWindow(now).start;
}

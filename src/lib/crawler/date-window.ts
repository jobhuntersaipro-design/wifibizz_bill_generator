export const CRAWL_LOOKBACK_MONTHS = 12;

/** Max calendar days per crawl request so a chunk finishes under Vercel's 300s cap. */
export const CRAWL_CHUNK_DAYS = 31;

export type CrawlDateWindow = {
  start: string;
  end: string;
};

export type CrawlDateChunk = {
  from: string;
  to: string;
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

/** WifiBizz Advanced Search expects `created_at=DD/MM/YYYY - DD/MM/YYYY`. */
export function toPortalCreatedAtFilter(fromIso: string, toIso: string): string {
  const toDmy = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${toDmy(fromIso)} - ${toDmy(toIso)}`;
}

/**
 * Split an inclusive YYYY-MM-DD range into oldest-first chunks of at most
 * `maxDays` calendar days each. Long ranges (e.g. Last 1 year) must be crawled
 * in separate requests — one unfiltered year is ~40k rows and exceeds maxDuration.
 */
export function splitCrawlDateRange(
  fromIso: string,
  toIso: string,
  maxDays: number = CRAWL_CHUNK_DAYS
): CrawlDateChunk[] {
  const parseUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const start = parseUtc(fromIso);
  const end = parseUtc(toIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const dayMs = 86_400_000;
  const chunks: CrawlDateChunk[] = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + (maxDays - 1) * dayMs, end);
    chunks.push({ from: fmtUtc(cursor), to: fmtUtc(chunkEnd) });
    cursor = chunkEnd + dayMs;
  }
  return chunks;
}

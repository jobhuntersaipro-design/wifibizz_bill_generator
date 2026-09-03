/**
 * Client-side pagination over an already-loaded, already-filtered row set.
 *
 * Pure on purpose: the admin Orders table slices with these, and a slice that
 * silently drops or duplicates a row looks exactly like "the order is gone".
 */

export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;

export function pageCount(total: number, perPage: number): number {
  // An empty set still has one (empty) page, so "Page 1 of 1" never reads
  // as "Page 1 of 0".
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, perPage)));
}

/**
 * The page actually shown for a requested page number.
 *
 * Clamping at render time (rather than resetting state in an effect) is what
 * keeps a filter change from stranding the view on a page that no longer
 * exists: narrow 60 rows on page 3 down to 8 and the view lands on the last
 * real page, not a blank one.
 */
export function clampPage(page: number, total: number, perPage: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, perPage));
}

export function pageSlice<T>(rows: T[], page: number, perPage: number): T[] {
  const p = clampPage(page, rows.length, perPage);
  return rows.slice((p - 1) * perPage, p * perPage);
}

/** "1–25 of 32" — what the footer prints. Empty set reads "0 of 0". */
export function pageRangeLabel(page: number, total: number, perPage: number): string {
  if (total === 0) return "0 of 0";
  const p = clampPage(page, total, perPage);
  const start = (p - 1) * perPage + 1;
  const end = Math.min(p * perPage, total);
  return `${start}–${end} of ${total}`;
}

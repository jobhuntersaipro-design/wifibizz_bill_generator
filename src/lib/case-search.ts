// The Case List search box matches every text column of a case (see the SQL in
// /api/cases and /api/cases/ids). This builds the ILIKE pattern: the input is a
// literal, so %, _ and \ are escaped, and runs of spaces match any spacing.

export function caseSearchPattern(search: string): string {
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return `%${words.map((w) => w.replace(/[\\%_]/g, "\\$&")).join("%")}%`;
}

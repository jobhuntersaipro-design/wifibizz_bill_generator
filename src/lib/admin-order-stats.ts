/**
 * Shaping the admin oversight numbers.
 *
 * Pure on purpose: these rules decide what an admin believes about an agent's
 * workload, and every one of them is a place where a wrong answer looks exactly
 * like a right one. They are unit-tested rather than eyeballed on a chart.
 *
 * Three of them come from measuring the real data (dev, 2026-08-30: 4 orders ->
 * 140 status events) rather than from reasoning about the schema.
 */

/** A status event, reduced to what the statistics actually need. */
export interface StatEvent {
  orderId: string;
  userId: string;
  attempt: number;
  status: string;
  errorCode: string | null;
  createdAt: Date;
}

/** Failures the portal never classified. Shown, never dropped — see below. */
export const UNCLASSIFIED = "unclassified";

/**
 * Terminal statuses — the ones that end an attempt.
 *
 * `submitting` is deliberately absent even though it is by far the most common
 * status in the table: a single run emits one per portal milestone (134 of 140
 * events in the sample). Anything that counted those would overcount attempts
 * roughly 35-fold.
 */
const TERMINAL = new Set(["submitted", "failed", "warning"]);
const FAILED = new Set(["failed", "warning"]);

/**
 * The day an event belongs to, in **Malaysia time**.
 *
 * Not UTC. Malaysia is UTC+8, so a UTC day boundary falls at 8am local — an
 * evening submit would land on the next day's bar and the totals would disagree
 * with what the agent remembers doing. This is the same class of bug the
 * appointment lead time had, where a container running on UTC made a 12-hour
 * lead behave as 4.
 */
export function dayKeyMYT(at: Date): string {
  // +8h then read the UTC calendar date: no DST in Malaysia, so a fixed offset
  // is exact rather than an approximation.
  const shifted = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Attempts, counted as distinct (order, attempt) pairs.
 *
 * NOT a row count. See TERMINAL above — rows are per-milestone, attempts are
 * not, and the two differ by more than an order of magnitude.
 */
export function countAttempts(events: StatEvent[]): number {
  return new Set(events.map((e) => `${e.orderId}:${e.attempt}`)).size;
}

/** Successful submits per day (MYT), for the trend. */
export function submitsPerDay(events: StatEvent[]): { day: string; count: number }[] {
  const byDay = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.status !== "submitted") continue;
    const day = dayKeyMYT(e.createdAt);
    // Distinct (order, attempt) even here: a duplicated terminal event must not
    // inflate a day's total.
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day)!.add(`${e.orderId}:${e.attempt}`);
  }
  return [...byDay.entries()]
    .map(([day, set]) => ({ day, count: set.size }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Fill the gaps between the first and last day of the range.
 *
 * A trend drawn only from days that had activity compresses a quiet week into a
 * single step and reads as steady work. Days with nothing get an explicit zero.
 */
export function fillDays(
  rows: { day: string; count: number }[],
  from: Date,
  to: Date,
): { day: string; count: number }[] {
  const have = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  const cursor = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(),
  ));
  const end = dayKeyMYT(to);
  // Guard the loop rather than trusting the dates: a reversed range would
  // otherwise spin forever.
  for (let i = 0; i < 400; i++) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ day: key, count: have.get(key) ?? 0 });
    if (key >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * How often each error code appears across failed attempts, commonest first.
 *
 * **A failure with no code is counted, not dropped.** In the sample, two of
 * three failures carried `error_code = null` — so filtering them out would have
 * reported one error where three happened, understating exactly what this page
 * exists to surface. They bucket as `unclassified`.
 */
export function errorBreakdown(events: StatEvent[]): { code: string; count: number }[] {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (!FAILED.has(e.status)) continue;
    const key = `${e.orderId}:${e.attempt}`;
    if (seen.has(key)) continue; // one error per attempt, not per event
    seen.add(key);
    const code = e.errorCode || UNCLASSIFIED;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export interface AgentStat {
  userId: string;
  submitted: number;
  failedAttempts: number;
  /** submitted / (submitted + failedAttempts), or null when nothing ran. */
  successRate: number | null;
  topError: { code: string; count: number } | null;
}

/**
 * Per-agent usage and their commonest failure — the page's main function.
 *
 * Agents with no activity in range are absent by construction: a table of
 * mostly-zeros buries the rows that need reading.
 */
export function agentStats(events: StatEvent[]): AgentStat[] {
  const byUser = new Map<string, StatEvent[]>();
  for (const e of events) {
    if (!TERMINAL.has(e.status)) continue;
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId)!.push(e);
  }
  const out: AgentStat[] = [];
  for (const [userId, theirs] of byUser) {
    const submitted = countAttempts(theirs.filter((e) => e.status === "submitted"));
    const failedAttempts = countAttempts(theirs.filter((e) => FAILED.has(e.status)));
    const total = submitted + failedAttempts;
    out.push({
      userId,
      submitted,
      failedAttempts,
      successRate: total === 0 ? null : submitted / total,
      topError: errorBreakdown(theirs)[0] ?? null,
    });
  }
  // Busiest first — the agent to look at is usually the one doing the most, or
  // failing the most.
  return out.sort(
    (a, b) => b.submitted + b.failedAttempts - (a.submitted + a.failedAttempts),
  );
}

/**
 * What an admin must type to purge an order.
 *
 * `reference` is nullable and bulk-created drafts have none — which is exactly
 * the population most likely to be purged — so the name is the fallback. Shared
 * by the dialog and the server check so the two cannot disagree about what the
 * user was asked to type.
 */
export function purgePhrase(order: { reference: string | null; fullName: string }): string {
  return order.reference || order.fullName;
}

/** Case- and whitespace-insensitive: this guards against haste, not typos. */
export function purgePhraseMatches(
  order: { reference: string | null; fullName: string },
  typed: string,
): boolean {
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) !== "" && norm(typed) === norm(purgePhrase(order));
}

/**
 * The admin oversight statistics.
 *
 * These rules decide what an admin believes about an agent's workload, and each
 * is a place where a wrong answer looks exactly like a right one — a chart
 * renders just as confidently either way. Three of them exist because of what
 * the REAL data turned out to look like (dev, 2026-08-30: 4 orders -> 140
 * status events), not because of anything the schema suggests.
 */
import { describe, it, expect } from "vitest";
import {
  dayKeyMYT,
  countAttempts,
  submitsPerBucket,
  fillBuckets,
  bucketKey,
  autoGranularity,
  errorBreakdown,
  agentStats,
  purgePhrase,
  purgePhraseMatches,
  UNCLASSIFIED,
  type StatEvent,
} from "@/lib/admin-order-stats";

const ev = (o: Partial<StatEvent> & { status: string }): StatEvent => ({
  orderId: "o1",
  userId: "u1",
  attempt: 1,
  errorCode: null,
  createdAt: new Date("2026-08-20T04:00:00Z"),
  ...o,
});

describe("attempt counting", () => {
  it("does not inflate on the per-milestone events a real run emits", () => {
    // THE measurement that shaped this: one submit writes a `submitting` event
    // per portal milestone — 134 of 140 events in the sample. Counting rows
    // would report this single attempt as 36.
    const run: StatEvent[] = [
      ...Array.from({ length: 35 }, () => ev({ status: "submitting" })),
      ev({ status: "submitted" }),
    ];
    expect(countAttempts(run.filter((e) => e.status === "submitted"))).toBe(1);
    expect(agentStats(run)[0].submitted).toBe(1);
  });

  it("counts a retried order once per attempt, not once per order", () => {
    const events = [
      ev({ attempt: 1, status: "failed" }),
      ev({ attempt: 2, status: "failed" }),
      ev({ attempt: 3, status: "submitted" }),
    ];
    const s = agentStats(events)[0];
    expect(s.failedAttempts).toBe(2);
    expect(s.submitted).toBe(1);
  });

  it("ignores non-terminal events entirely", () => {
    expect(agentStats([ev({ status: "submitting" }), ev({ status: "info" })])).toEqual([]);
  });
});

describe("the day an event belongs to", () => {
  it("uses Malaysia time, not UTC", () => {
    // 2026-08-20 23:30 MYT is 15:30 UTC the same day — fine either way.
    expect(dayKeyMYT(new Date("2026-08-20T15:30:00Z"))).toBe("2026-08-20");
    // 2026-08-20 20:00 UTC is 04:00 on the 21st in MYT. Read as UTC this submit
    // lands on the 20th's bar, a day before the agent did it.
    expect(dayKeyMYT(new Date("2026-08-20T20:00:00Z"))).toBe("2026-08-21");
    // And the reverse: 00:30 UTC is still the previous evening in Malaysia.
    expect(dayKeyMYT(new Date("2026-08-21T00:30:00Z"))).toBe("2026-08-21");
    expect(dayKeyMYT(new Date("2026-08-20T16:00:00Z"))).toBe("2026-08-21");
  });

  it("buckets an evening submit onto the local day the agent worked", () => {
    const rows = submitsPerBucket([
      ev({ status: "submitted", createdAt: new Date("2026-08-20T20:00:00Z") }),
    ]);
    expect(rows).toEqual([{ day: "2026-08-21", count: 1 }]);
  });
});

describe("the trend", () => {
  it("counts only successful submits", () => {
    const rows = submitsPerBucket([
      ev({ status: "submitted" }),
      ev({ orderId: "o2", status: "failed" }),
      ev({ orderId: "o3", status: "submitting" }),
    ]);
    expect(rows).toEqual([{ day: "2026-08-20", count: 1 }]);
  });

  it("fills quiet days with zero rather than compressing them away", () => {
    // A trend drawn only from days with activity turns a quiet week into one
    // step and reads as steady work.
    const filled = fillBuckets(
      [{ day: "2026-08-20", count: 2 }, { day: "2026-08-23", count: 1 }],
      new Date("2026-08-20T02:00:00Z"),
      new Date("2026-08-23T02:00:00Z"),
    );
    expect(filled).toEqual([
      { day: "2026-08-20", count: 2 },
      { day: "2026-08-21", count: 0 },
      { day: "2026-08-22", count: 0 },
      { day: "2026-08-23", count: 1 },
    ]);
  });

  it("terminates on a reversed range instead of spinning", () => {
    expect(
      fillBuckets([], new Date("2026-08-23T02:00:00Z"), new Date("2026-08-20T02:00:00Z")).length,
    ).toBeLessThan(1200);
  });
});

describe("the error breakdown", () => {
  it("counts failures the portal never classified", () => {
    // The measurement this exists for: TWO of three real failures carried
    // error_code = null. Dropping them would report one error where three
    // happened — understating the very thing the page is for.
    const rows = errorBreakdown([
      ev({ orderId: "a", status: "warning", errorCode: null }),
      ev({ orderId: "b", status: "warning", errorCode: null }),
      ev({ orderId: "c", status: "warning", errorCode: "device_out_of_stock" }),
    ]);
    expect(rows).toEqual([
      { code: UNCLASSIFIED, count: 2 },
      { code: "device_out_of_stock", count: 1 },
    ]);
  });

  it("counts one error per attempt, not per event", () => {
    const rows = errorBreakdown([
      ev({ status: "failed", errorCode: "session_expired" }),
      ev({ status: "failed", errorCode: "session_expired" }),
    ]);
    expect(rows).toEqual([{ code: "session_expired", count: 1 }]);
  });

  it("puts the commonest first", () => {
    const rows = errorBreakdown([
      ev({ orderId: "a", status: "failed", errorCode: "rare" }),
      ev({ orderId: "b", status: "failed", errorCode: "common" }),
      ev({ orderId: "c", status: "failed", errorCode: "common" }),
    ]);
    expect(rows[0]).toEqual({ code: "common", count: 2 });
  });
});

describe("per-agent stats", () => {
  it("reports usage and the agent's commonest failure together", () => {
    const stats = agentStats([
      ev({ userId: "alice", orderId: "a1", status: "submitted" }),
      ev({ userId: "alice", orderId: "a2", status: "failed", errorCode: "session_expired" }),
      ev({ userId: "alice", orderId: "a3", status: "failed", errorCode: "session_expired" }),
      ev({ userId: "bob", orderId: "b1", status: "submitted" }),
    ]);
    const alice = stats.find((s) => s.userId === "alice")!;
    expect(alice.submitted).toBe(1);
    expect(alice.failedAttempts).toBe(2);
    expect(alice.successRate).toBeCloseTo(1 / 3);
    expect(alice.topError).toEqual({ code: "session_expired", count: 2 });
  });

  it("omits agents with no activity, and never divides by zero", () => {
    const stats = agentStats([ev({ userId: "alice", status: "submitted" })]);
    expect(stats.map((s) => s.userId)).toEqual(["alice"]);
    expect(agentStats([])).toEqual([]);
  });

  it("sorts the busiest first", () => {
    const stats = agentStats([
      ev({ userId: "quiet", orderId: "q", status: "submitted" }),
      ev({ userId: "busy", orderId: "b1", status: "submitted" }),
      ev({ userId: "busy", orderId: "b2", status: "failed" }),
      ev({ userId: "busy", orderId: "b3", status: "failed" }),
    ]);
    expect(stats[0].userId).toBe("busy");
  });
});

describe("the purge phrase", () => {
  it("falls back to the name when there is no reference", () => {
    // reference is nullable and bulk-created drafts have none — exactly the
    // orders most likely to be purged, so "type the reference" cannot be the
    // only rule.
    expect(purgePhrase({ reference: "ORD-0042", fullName: "WOJAK LANG" })).toBe("ORD-0042");
    expect(purgePhrase({ reference: null, fullName: "WOJAK LANG" })).toBe("WOJAK LANG");
  });

  it("guards against haste, not against typing style", () => {
    const o = { reference: null, fullName: "WOJAK LANG" };
    expect(purgePhraseMatches(o, "  wojak   lang ")).toBe(true);
    expect(purgePhraseMatches(o, "WOJAK")).toBe(false);
    expect(purgePhraseMatches(o, "")).toBe(false);
    expect(purgePhraseMatches(o, "   ")).toBe(false);
  });

  it("refuses an empty phrase even when the order has no name", () => {
    // Otherwise an empty box would match an empty phrase and purge on a click.
    expect(purgePhraseMatches({ reference: null, fullName: "" }, "")).toBe(false);
  });
});

describe("bucketing by week and month", () => {
  it("puts a week on its Monday, in Malaysia time", () => {
    // 2026-08-20 is a Thursday; its week starts Monday the 17th.
    expect(bucketKey(new Date("2026-08-20T04:00:00Z"), "week")).toBe("2026-08-17");
    expect(bucketKey(new Date("2026-08-20T04:00:00Z"), "month")).toBe("2026-08");
    expect(bucketKey(new Date("2026-08-20T04:00:00Z"), "day")).toBe("2026-08-20");
  });

  it("keeps a Sunday-night submit in the week the agent worked", () => {
    // Sunday 2026-08-23 23:30 MYT = Sunday 15:30 UTC. Still that week.
    expect(bucketKey(new Date("2026-08-23T15:30:00Z"), "week")).toBe("2026-08-17");
  });

  it("moves a Monday-morning submit into the NEW week", () => {
    // THE case that would be silently wrong. Sunday 2026-08-23 20:00 UTC is
    // Monday 2026-08-24 04:00 MYT. Computing the weekday from the UTC instant
    // would file the agent's Monday work under the previous week.
    expect(bucketKey(new Date("2026-08-23T20:00:00Z"), "week")).toBe("2026-08-24");
    expect(bucketKey(new Date("2026-08-23T20:00:00Z"), "day")).toBe("2026-08-24");
  });

  it("rolls a month over on the Malaysian boundary, not the UTC one", () => {
    // 2026-08-31 20:00 UTC is 2026-09-01 04:00 MYT.
    expect(bucketKey(new Date("2026-08-31T20:00:00Z"), "month")).toBe("2026-09");
    expect(bucketKey(new Date("2026-08-31T10:00:00Z"), "month")).toBe("2026-08");
  });
});

describe("choosing a granularity", () => {
  it("does not draw ninety thin bars", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const days = (n: number) => new Date(from.getTime() + n * 86400_000);
    expect(autoGranularity(from, days(31))).toBe("day");
    expect(autoGranularity(from, days(32))).toBe("week");
    expect(autoGranularity(from, days(180))).toBe("week");
    expect(autoGranularity(from, days(181))).toBe("month");
  });

  it("reads a reversed range by its length, not its sign", () => {
    // Order must not change the answer: |to - from| is the span either way.
    const jan = new Date("2026-01-01T00:00:00Z"), jun = new Date("2026-06-01T00:00:00Z");
    expect(autoGranularity(jun, jan)).toBe(autoGranularity(jan, jun)); // 151d -> week
    const jan27 = new Date("2027-01-01T00:00:00Z");
    expect(autoGranularity(jan27, jan)).toBe("month"); // 365d, reversed
  });
});

describe("filling buckets", () => {
  it("emits a zero for a quiet week", () => {
    const filled = fillBuckets(
      [{ day: "2026-08-03", count: 2 }],
      new Date("2026-08-03T02:00:00Z"),
      new Date("2026-08-19T02:00:00Z"),
      "week",
    );
    expect(filled).toEqual([
      { day: "2026-08-03", count: 2 },
      { day: "2026-08-10", count: 0 },
      { day: "2026-08-17", count: 0 },
    ]);
  });

  it("emits a zero for a quiet month, across a year boundary", () => {
    const filled = fillBuckets(
      [{ day: "2026-12", count: 1 }],
      new Date("2026-11-05T02:00:00Z"),
      new Date("2027-01-05T02:00:00Z"),
      "month",
    );
    expect(filled.map((f) => f.day)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(filled[1].count).toBe(1);
  });

  it("never repeats a bucket when stepping by day", () => {
    const filled = fillBuckets([], new Date("2026-08-01T02:00:00Z"),
      new Date("2026-08-31T02:00:00Z"), "week");
    expect(new Set(filled.map((f) => f.day)).size).toBe(filled.length);
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { crawl, CRAWL_PAGE_LENGTH, type CrawlCursor } from "../scraper";
import type { CaseData } from "../db";

// A fake portal: rows newest-first per module, served in small pages so paging and
// the resume cursor are exercised without needing thousands of fixtures.
const PORTAL_PAGE = 3;

type Row = Record<string, unknown>;
const row = (mod: string, n: number, createdAt: string): Row => ({
  prefix_with_no: `<a href="/applications/${n}?module=${mod}&amp;application_no=${n}">${n}</a>`,
  customer_name: `NAME ${n}`,
  created_at: createdAt,
  status: '<span class="badge">Activated</span>',
});

// day 0 = 2026-09-11, one row per day going back
const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 8, 11) - i * 86400000);
  return `${d.toISOString().slice(0, 10)} 12:00:00`;
};

let data: Record<string, Row[]>;
let requests: { module: string; start: number; length: number }[];

function install() {
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    const hdrs = { get: (k: string) => (k === "location" ? "https://x/dashboard" : null), getSetCookie: () => ["s=1"] };
    if (u.pathname === "/login") {
      return { ok: true, headers: hdrs, text: async () => `<input name="_token" value="tok">` };
    }
    const mod = u.searchParams.get("module")!;
    const start = Number(u.searchParams.get("start"));
    const length = Number(u.searchParams.get("length"));
    requests.push({ module: mod, start, length });
    const all = data[mod] ?? [];
    return { ok: true, status: 200, headers: hdrs, json: async () => ({
      draw: 1, recordsTotal: all.length, recordsFiltered: all.length,
      data: all.slice(start, start + Math.min(PORTAL_PAGE, length)),
    })};
  }));
}

beforeEach(() => {
  data = {
    home_fibre: Array.from({ length: 10 }, (_, i) => row("home_fibre", 100 + i, day(i))),
    biz_fibre: Array.from({ length: 4 }, (_, i) => row("biz_fibre", 200 + i, day(i))),
    "4g": [],
  };
  install();
});
afterEach(() => vi.unstubAllGlobals());

const collect = () => {
  const batches: CaseData[][] = [];
  return { batches, onBatch: async (b: CaseData[]) => { batches.push(b); } };
};

describe("crawl paging and resume", () => {
  it("asks the portal for large pages, not 100", async () => {
    await crawl("e", "p", undefined, { dateFrom: "2026-09-01" });
    expect(CRAWL_PAGE_LENGTH).toBeGreaterThanOrEqual(500);
    expect(requests.every((r) => r.length === CRAWL_PAGE_LENGTH)).toBe(true);
  });

  it("stops at the from cutoff and reports complete", async () => {
    const { batches, onBatch } = collect();
    const out = await crawl("e", "p", undefined, { dateFrom: "2026-09-08", onBatch });
    expect(out.complete).toBe(true);
    expect(out.nextCursor).toBeNull();
    // 2026-09-11 .. 2026-09-08 inclusive = 4 home rows, plus all 4 biz rows
    const all = batches.flat();
    expect(all.filter((c) => c.case_no.startsWith("10"))).toHaveLength(4);
    expect(out.fetched).toBe(8);
  });

  it("persists incrementally as pages arrive, not once at the end", async () => {
    const { batches, onBatch } = collect();
    await crawl("e", "p", undefined, { dateFrom: "2026-09-01", onBatch });
    expect(batches.length).toBeGreaterThan(1);
    // and nothing is buffered into the return value when a sink is supplied
    const out = await crawl("e", "p", undefined, { dateFrom: "2026-09-01", onBatch });
    expect(out.cases).toHaveLength(0);
  });

  it("returns a cursor when it runs out of time, having saved that page", async () => {
    const { batches, onBatch } = collect();
    const out = await crawl("e", "p", undefined, {
      dateFrom: "2026-09-01", onBatch, deadline: Date.now() - 1,
    });
    expect(out.complete).toBe(false);
    expect(out.nextCursor).toEqual({ moduleIndex: 0, start: PORTAL_PAGE });
    expect(batches.flat()).toHaveLength(PORTAL_PAGE); // the page it did fetch IS saved
  });

  it("resumes from the cursor instead of re-paging from the top", async () => {
    const cursor: CrawlCursor = { moduleIndex: 0, start: 6 };
    const { batches, onBatch } = collect();
    const out = await crawl("e", "p", undefined, { dateFrom: "2026-09-01", cursor, onBatch });
    const homeStarts = requests.filter((r) => r.module === "home_fibre").map((r) => r.start);
    expect(Math.min(...homeStarts)).toBe(6);
    expect(homeStarts).not.toContain(0);
    expect(out.complete).toBe(true);
    // rows 0-5 were already handled by the earlier pass and are not fetched again
    expect(batches.flat().map((c) => c.case_no)).not.toContain("100");
  });

  it("a full resume loop covers every row exactly once", async () => {
    const seen: string[] = [];
    let cursor: CrawlCursor | null = null;
    let guard = 0;
    for (;;) {
      if (++guard > 50) throw new Error("resume loop did not terminate");
      const out = await crawl("e", "p", undefined, {
        dateFrom: "2026-09-01", cursor,
        onBatch: async (b) => { seen.push(...b.map((c) => c.case_no)); },
        deadline: Date.now() - 1, // one page per pass
      });
      if (out.complete) break;
      cursor = out.nextCursor;
    }
    const home = Array.from({ length: 10 }, (_, i) => String(100 + i));
    const biz = Array.from({ length: 4 }, (_, i) => String(200 + i));
    expect(seen).toEqual([...home, ...biz]);
    expect(new Set(seen).size).toBe(seen.length); // no row fetched twice
  });

  it("skips rows newer than the To bound", async () => {
    const { batches, onBatch } = collect();
    await crawl("e", "p", undefined, { dateFrom: "2026-09-01", dateTo: "2026-09-08", onBatch });
    const nos = batches.flat().map((c) => c.case_no);
    expect(nos).not.toContain("100"); // 2026-09-11, newer than To
    expect(nos).toContain("103");     // 2026-09-08
  });

  it("sweeps every module and tolerates an empty one", async () => {
    await crawl("e", "p", undefined, { dateFrom: "2026-09-01" });
    expect(new Set(requests.map((r) => r.module))).toEqual(
      new Set(["home_fibre", "biz_fibre", "4g"])
    );
  });

  it("buffers into cases when no sink is supplied (the local CLI path)", async () => {
    const out = await crawl("e", "p", undefined, { dateFrom: "2026-09-01" });
    expect(out.cases.length).toBe(14);
    expect(out.cases[0].full_name).toBe("NAME 100");
  });
});

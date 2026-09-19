import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  crawl, extractCases, isBizFibreCase, parseCaseDetailFields, DETAIL_STAGE,
  type CaseDetailRow, type DetailSource,
} from "../scraper";
import { parseCompanyPair } from "@/lib/case-kind";
import type { CaseData } from "../db";

const BASE = "https://wifibizz.com";

// ── The real shapes, taken from a live probe on 2026-09-19 ──
//
// One biz_fibre list row, verbatim keys. The three fields this feature adds were
// ALWAYS in this response; the crawler simply never read them.
const LIVE_BIZ_ROW: Record<string, unknown> = {
  id: "195062",
  prefix_with_no: "202653108",
  application_no: `<a href="${BASE}/applications/195062?module=biz_fibre">202653108</a>`,
  customer_name: "Naeem Ullah(QC9994653)",
  customer_full_mobile_no: "+601169353189",
  customer_email: "naeemullah707296@gmail.com",
  customer_id_type: "passport",
  customer_id_no: "QC9994653",
  company_name: "Naeem Ullah",
  company_reg: "QC9994653",
  operator_name: "Unifi Business",
  operator_type: "biz_fibre",
  agent_name: "AI CHAT BOT",
  agent_staff_id: "AIB999",
  agent_remark: "cc ub TMRA14336",
  status: '<span class="badge badge-pill badge-default bg-teal">Activated</span>',
  created_at: "2026-07-06 17:25:02",
  package: "Unifi Business Exclusive 300M (MESH6) RM139",
  order_no: "2607000115087761",
};

// The detail page for case 202655047, in the shape the portal really uses:
// <label> followed by a <span>, NOT an <input value=…>.
const LIVE_DETAIL_HTML = `
  <label>Company Name</label><span>SR RAIFA TRADING</span>
  <label>Company Registration No.</label><span>JR0191646-W</span>
  <label>Name</label><span>RAHIMAH BINTI HABEEB RAHMAN</span>
  <label>Mobile No.</label><span>+60164936412</span>
  <label>Email</label><span>suhaira_sept@yahoo.com</span>
  <label>National ID Type</label><span>Passport</span>
  <label>National ID No.</label><span>JR0191646W</span>
  <label>Address</label><span>A-G-09 JALAN PP 27 G BLOK A PANGSAPURI PINGGIRAN PUTRA
    SEKSYEN 2 SERI KEMBANGAN SELANGOR MALAYSIA 43300</span>
  <label>Unit No.</label><span></span>
  <label>Street Name</label><span></span>
`;

describe("extractCases — business fields off the list row", () => {
  it("reads company_name, company_reg and id_type, which were being discarded", () => {
    const c = extractCases([LIVE_BIZ_ROW], BASE)[0];
    expect(c.company_name).toBe("Naeem Ullah");
    expect(c.company_reg).toBe("QC9994653");
    expect(c.id_type).toBe("passport");
  });

  it("leaves director_name NULL — the list row has no such key at any name", () => {
    const c = extractCases([LIVE_BIZ_ROW], BASE)[0];
    // NULL, not "": nothing has read a detail page for this case yet.
    expect(c.director_name).toBeNull();
    // The list's customer_name is the COMPANY(REG) string, never the person.
    expect(c.full_name).toBe("Naeem Ullah(QC9994653)");
  });

  it("still carries mobile, email and id_no", () => {
    const c = extractCases([LIVE_BIZ_ROW], BASE)[0];
    expect(c.mobile).toBe("+601169353189");
    expect(c.email).toBe("naeemullah707296@gmail.com");
    expect(c.id_no).toBe("QC9994653");
  });

  it("a row with no company keys yields empty strings, never undefined", () => {
    const c = extractCases([{ prefix_with_no: "1", created_at: "2026-01-01 00:00:00" }], BASE)[0];
    expect(c.company_name).toBe("");
    expect(c.company_reg).toBe("");
    expect(c.id_type).toBe("");
  });
});

describe("the crawled company_reg fixes what parseCompanyPair could not", () => {
  // These are real full_name values. The portal nests the OLD registration number
  // inside the new one, so the trailing-bracket split fails — 545 of 1,299 stored
  // business rows are in this shape and render a blank BRN today.
  const NESTED = [
    "Goldmate Corporation Sdn Bhd(198401017604 (130158-V))",
    "KEDAI GUNTING RAMBUT ASWINIS(199903090233 (JM0293679-W))",
    "CS 88 FRUITS TRADING SDN BHD(202601033668 ( 1695763-V ))",
  ];

  it("control: the derivation in place today genuinely fails on these", () => {
    for (const name of NESTED) expect(parseCompanyPair(name)).toBeNull();
  });

  it("the list row answers directly, whatever full_name looks like", () => {
    const c = extractCases(
      [{ ...LIVE_BIZ_ROW, customer_name: NESTED[0], company_name: "Goldmate Corporation Sdn Bhd", company_reg: "198401017604 (130158-V)" }],
      BASE,
    )[0];
    expect(parseCompanyPair(c.full_name)).toBeNull();
    expect(c.company_name).toBe("Goldmate Corporation Sdn Bhd");
    expect(c.company_reg).toBe("198401017604 (130158-V)");
  });
});

describe("parseCaseDetailFields against the real page markup", () => {
  it("reads the values out of <span> siblings", () => {
    expect(parseCaseDetailFields(LIVE_DETAIL_HTML)).toEqual({
      address: "A-G-09 JALAN PP 27 G BLOK A PANGSAPURI PINGGIRAN PUTRA SEKSYEN 2 SERI KEMBANGAN SELANGOR MALAYSIA 43300",
      companyName: "SR RAIFA TRADING",
      companyReg: "JR0191646-W",
      customerName: "RAHIMAH BINTI HABEEB RAHMAN",
    });
  });

  it("the director is not the company, and not the National ID No either", () => {
    const f = parseCaseDetailFields(LIVE_DETAIL_HTML);
    expect(f.customerName).not.toBe(f.companyName);
    // This case's National ID No IS the company reg (type Passport) — there is no
    // director IC on the page at all, so nothing may treat id_no as one.
    expect(f.customerName).not.toContain("JR0191646");
  });
});

describe("the portal's bare-dash placeholder", () => {
  // Real data: 4 of 6 business cases in one live sweep had "-" in the Name field.
  const DASHED = `
    <label>Company Name</label><span>EPITNA RESOURCES</span>
    <label>Company Registration No.</label><span>SA0200695-U</span>
    <label>Name</label><span>-</span>
    <label>Address</label><span>10-G JALAN PJS 5/28 G PETALING JAYA SELANGOR</span>
  `;

  it("is read as no value, never as a name", () => {
    const f = parseCaseDetailFields(DASHED);
    expect(f.customerName).toBe("");
    expect(f.companyName).toBe("EPITNA RESOURCES");
  });

  it("does not eat a legitimate value that merely contains a dash", () => {
    const f = parseCaseDetailFields(`
      <label>Company Registration No.</label><span>SA0200695-U</span>
      <label>Address</label><span>10-G JALAN PJS 5/28</span>
    `);
    expect(f.companyReg).toBe("SA0200695-U");
    expect(f.address).toBe("10-G JALAN PJS 5/28");
  });
});

describe("isBizFibreCase", () => {
  it("is decided by the module in the case's own portal URL", () => {
    const biz = { case_url: `${BASE}/applications/1?module=biz_fibre&application_no=2` } as CaseData;
    const home = { case_url: `${BASE}/applications/1?module=home_fibre&application_no=2` } as CaseData;
    expect(isBizFibreCase(biz)).toBe(true);
    expect(isBizFibreCase(home)).toBe(false);
    expect(isBizFibreCase({ case_url: "" } as CaseData)).toBe(false);
  });
});

// ── The business-details stage, end to end against a fake portal ──
//
// The portal serves list rows per module and a detail page per case id. The
// detail source is an in-memory stand-in for the database with the same rule the
// real one has: a case is unread while director_name is null.

type Row = Record<string, unknown>;
const DASHED_PAGE = `
  <label>Company Name</label><span>EPITNA RESOURCES</span>
  <label>Name</label><span>-</span>
  <label>Address</label><span>10-G JALAN PJS 5/28 G PETALING JAYA SELANGOR</span>
`;
const LOGIN_PAGE = `<form><input name="_token" value="tok"><input name="email"><input name="password"></form>`;

let data: Record<string, Row[]>;
let detailRequests: number[];
/** Per case id: a page to serve, or a status to fail with. Default: the live page. */
let pages: Record<number, string | number>;
/** Advances one second per detail request, so a deadline can land mid-stage. */
let clock: number;

const created = (i: number) => {
  const d = new Date(Date.UTC(2026, 8, 18) - i * 3600_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
};
const listRow = (mod: string, id: number, i: number): Row => ({
  ...LIVE_BIZ_ROW,
  id: String(id),
  prefix_with_no: `<a href="/applications/${id}?module=${mod}&amp;application_no=${id}">${id}</a>`,
  operator_type: mod,
  created_at: created(i),
});

function install() {
  detailRequests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    const hdrs = { get: (k: string) => (k === "location" ? "https://x/dashboard" : null), getSetCookie: () => ["s=1"] };
    if (u.pathname === "/login") {
      return { ok: true, headers: hdrs, text: async (): Promise<string> => `<input name="_token" value="tok">` };
    }
    const detail = u.pathname.match(/^\/applications\/(\d+)$/);
    if (detail) {
      const id = Number(detail[1]);
      detailRequests.push(id);
      clock += 1000;
      const page = pages[id] ?? LIVE_DETAIL_HTML;
      if (typeof page === "number") return { ok: false, status: page, headers: hdrs, text: async (): Promise<string> => "" };
      return { ok: true, status: 200, headers: hdrs, text: async (): Promise<string> => page };
    }
    const all = data[u.searchParams.get("module")!] ?? [];
    const start = Number(u.searchParams.get("start"));
    return {
      ok: true, status: 200, headers: hdrs,
      json: async () => ({ draw: 1, recordsTotal: all.length, recordsFiltered: all.length, data: all.slice(start) }),
    };
  }));
}

interface Stored { case_url: string; created: string; director_name: string | null; full_address: string; company_name: string }

/** An in-memory database: the list sweep upserts into it, the stage reads from it. */
function memoryDb() {
  const rows = new Map<string, Stored>();
  const saves: CaseDetailRow[][] = [];
  const events: string[] = [];
  const onBatch = async (b: import("../db").CaseData[]) => {
    events.push("list");
    for (const c of b) {
      const prev = rows.get(c.case_no);
      rows.set(c.case_no, {
        case_url: c.case_url, created: c.case_created_at,
        director_name: prev?.director_name ?? c.director_name,
        full_address: prev?.full_address || c.full_address,
        company_name: c.company_name,
      });
    }
  };
  const details: DetailSource = {
    async next({ skip, limit }) {
      const unread = [...rows.entries()]
        .filter(([, r]) => isBizFibreCase(r) && r.director_name === null)
        .sort((a, b) => b[1].created.localeCompare(a[1].created) || a[0].localeCompare(b[0]));
      return {
        items: unread.slice(skip, skip + limit).map(([case_no, r]) => ({ case_no, case_url: r.case_url })),
        remaining: unread.length,
      };
    },
    async save(batch) {
      events.push("save");
      saves.push(batch);
      for (const d of batch) {
        const r = rows.get(d.case_no)!;
        r.director_name = d.director_name;
        if (d.full_address) r.full_address = d.full_address;
      }
    },
  };
  return { rows, saves, events, onBatch, details };
}

const bizIds = (n: number) => Array.from({ length: n }, (_, i) => 200 + i);

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  pages = {};
  data = {
    home_fibre: [listRow("home_fibre", 100, 0), listRow("home_fibre", 101, 1)],
    biz_fibre: bizIds(4).map((id, i) => listRow("biz_fibre", id, i)),
    "4g": [],
  };
  install();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opts = { dateFrom: "2026-09-01" };

describe("the business-details stage", () => {
  it("reads director and address for every business case, then completes", async () => {
    const db = memoryDb();
    const out = await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(out.complete).toBe(true);
    const biz = [...db.rows.values()].filter(isBizFibreCase);
    expect(biz).toHaveLength(4);
    for (const r of biz) {
      expect(r.director_name).toBe("RAHIMAH BINTI HABEEB RAHMAN");
      expect(r.full_address).toContain("PANGSAPURI PINGGIRAN PUTRA");
    }
  });

  it("saves the list rows BEFORE any detail request — the list is never held hostage", async () => {
    const db = memoryDb();
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(db.events.indexOf("save")).toBeGreaterThan(db.events.lastIndexOf("list"));
  });

  it("saves in small batches, so a cut-off pass loses seconds, not a page", async () => {
    data.biz_fibre = bizIds(20).map((id, i) => listRow("biz_fibre", id, i));
    const db = memoryDb();
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(db.saves.length).toBeGreaterThan(1);
    expect(db.saves.every((b) => b.length <= 6)).toBe(true);
    expect(db.saves.flat()).toHaveLength(20);
  });

  it("never requests a detail page for a non-business case", async () => {
    const db = memoryDb();
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(detailRequests.every((id) => id >= 200)).toBe(true);
  });

  it("does nothing without a detail source (the local CLI)", async () => {
    await crawl("e", "p", undefined, opts);
    expect(detailRequests).toHaveLength(0);
  });

  // THE production failure: a pass ran out of budget part-way through, and the
  // rest were skipped until the next full crawl. Now the pass hands back a cursor
  // in the stage and the next pass picks up exactly where it stopped.
  it("resumes across passes until every case is read — each read exactly once", async () => {
    data.biz_fibre = bizIds(25).map((id, i) => listRow("biz_fibre", id, i));
    const db = memoryDb();
    let cursor = null as { moduleIndex: number; start: number } | null;
    let passes = 0;
    for (;;) {
      passes++;
      const out = await crawl("e", "p", undefined, {
        ...opts, cursor, onBatch: db.onBatch, details: db.details,
        deadline: clock + 8_000, // ~8 detail pages per pass
      });
      if (out.complete) break;
      expect(out.nextCursor?.moduleIndex).toBe(DETAIL_STAGE);
      cursor = out.nextCursor;
      expect(passes).toBeLessThan(20);
    }
    expect(passes).toBeGreaterThan(2);
    expect([...db.rows.values()].filter((r) => isBizFibreCase(r) && r.director_name === null)).toHaveLength(0);
    expect(new Set(detailRequests).size).toBe(detailRequests.length);
    expect(detailRequests).toHaveLength(25);
  });

  it("a page that fails stays unread and is stepped over — the stage still completes", async () => {
    pages[201] = 500;
    const db = memoryDb();
    // A deadline so that looping on the failed case fails this test instead of
    // hanging the suite (which is what it did when the skip was removed).
    const out = await crawl("e", "p", undefined, {
      ...opts, onBatch: db.onBatch, details: db.details, deadline: clock + 60_000,
    });
    expect(out.complete).toBe(true);
    expect(db.rows.get("201")?.director_name).toBeNull();
    expect(detailRequests.filter((id) => id === 201)).toHaveLength(1); // not looped on
    expect(db.rows.get("202")?.director_name).toBe("RAHIMAH BINTI HABEEB RAHMAN");
  });

  it("the failed case is tried again on the next crawl", async () => {
    pages[201] = 500;
    const db = memoryDb();
    await crawl("e", "p", undefined, {
      ...opts, onBatch: db.onBatch, details: db.details, deadline: clock + 60_000,
    });
    delete pages[201];
    detailRequests.length = 0;
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(detailRequests).toEqual([201]);
    expect(db.rows.get("201")?.director_name).toBe("RAHIMAH BINTI HABEEB RAHMAN");
  });

  it("an expired session's login page is a failure, never 'read, no name'", async () => {
    // fetch follows the portal's redirect to /login and gets a 200 — a status
    // check alone would record every case as read with an empty director.
    pages[202] = LOGIN_PAGE;
    const db = memoryDb();
    await crawl("e", "p", undefined, {
      ...opts, onBatch: db.onBatch, details: db.details, deadline: clock + 60_000,
    });
    expect(db.rows.get("202")?.director_name).toBeNull();
  });

  it("a bare-dash Name is saved as '' and never asked for again", async () => {
    pages[200] = DASHED_PAGE;
    const db = memoryDb();
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(db.rows.get("200")?.director_name).toBe("");
    detailRequests.length = 0;
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    expect(detailRequests).toHaveLength(0);
  });

  it("a re-crawl of the list never blanks a director the stage found", async () => {
    const db = memoryDb();
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch, details: db.details });
    await crawl("e", "p", undefined, { ...opts, onBatch: db.onBatch }); // list only
    expect(db.rows.get("200")?.director_name).toBe("RAHIMAH BINTI HABEEB RAHMAN");
  });

  it("reports progress as read / left", async () => {
    const steps: string[] = [];
    const db = memoryDb();
    await crawl("e", "p", (p) => steps.push(p.step), { ...opts, onBatch: db.onBatch, details: db.details });
    expect(steps.some((s) => /business details… 4 read, 0 left/.test(s))).toBe(true);
  });
});

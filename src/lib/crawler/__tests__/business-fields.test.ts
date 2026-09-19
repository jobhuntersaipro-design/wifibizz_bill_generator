import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { crawl, extractCases, isBizFibreCase, parseCaseDetailFields } from "../scraper";
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

  it("a case whose page says '-' is marked read, so it is not re-fetched for ever", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(url);
      const hdrs = { get: (k: string) => (k === "location" ? "https://x/dashboard" : null), getSetCookie: () => ["s=1"] };
      if (u.pathname === "/login") return { ok: true, headers: hdrs, text: async (): Promise<string> => `<input name="_token" value="tok">` };
      if (/^\/applications\/\d+$/.test(u.pathname)) return { ok: true, status: 200, headers: hdrs, text: async (): Promise<string> => DASHED };
      const all = data[u.searchParams.get("module")!] ?? [];
      const start = Number(u.searchParams.get("start"));
      return { ok: true, status: 200, headers: hdrs, json: async () => ({ draw: 1, recordsTotal: all.length, recordsFiltered: all.length, data: all.slice(start) }) };
    }));
    const { batches, onBatch } = collect();
    await crawl("e", "p", undefined, {
      dateFrom: "2026-09-01", onBatch,
      needsDetail: async (c) => c.map((x) => x.case_no),
    });
    const biz = batches.flat().filter(isBizFibreCase);
    // "" not null — the difference between "the portal has no name" and
    // "nobody has looked", which is what casesNeedingDetail reads.
    expect(biz.every((c) => c.director_name === "")).toBe(true);
    expect(biz.every((c) => c.full_address.includes("JALAN PJS"))).toBe(true);
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

// ── Crawl-level: the detail fetch ──

type Row = Record<string, unknown>;
let detailRequests: string[];
let data: Record<string, Row[]>;

const listRow = (mod: string, n: number): Row => ({
  ...LIVE_BIZ_ROW,
  prefix_with_no: `<a href="/applications/${n}?module=${mod}&amp;application_no=${n}">${n}</a>`,
  operator_type: mod,
  created_at: "2026-09-10 12:00:00",
});

function install() {
  detailRequests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    const hdrs = {
      get: (k: string) => (k === "location" ? "https://x/dashboard" : null),
      getSetCookie: () => ["s=1"],
    };
    if (u.pathname === "/login") {
      return { ok: true, headers: hdrs, text: async (): Promise<string> => `<input name="_token" value="tok">` };
    }
    // A case detail page: /applications/<id>
    if (/^\/applications\/\d+$/.test(u.pathname)) {
      detailRequests.push(u.pathname + u.search);
      return { ok: true, status: 200, headers: hdrs, text: async (): Promise<string> => LIVE_DETAIL_HTML };
    }
    const mod = u.searchParams.get("module")!;
    const start = Number(u.searchParams.get("start"));
    const all = data[mod] ?? [];
    return {
      ok: true, status: 200, headers: hdrs,
      json: async () => ({ draw: 1, recordsTotal: all.length, recordsFiltered: all.length, data: all.slice(start) }),
    };
  }));
}

beforeEach(() => {
  data = {
    home_fibre: [listRow("home_fibre", 100), listRow("home_fibre", 101)],
    biz_fibre: [listRow("biz_fibre", 200), listRow("biz_fibre", 201)],
    "4g": [],
  };
  install();
});
afterEach(() => vi.unstubAllGlobals());

const collect = () => {
  const batches: CaseData[][] = [];
  return { batches, onBatch: async (b: CaseData[]) => { batches.push(b); } };
};

describe("crawl detail enrichment", () => {
  const opts = { dateFrom: "2026-09-01" };

  it("fills director name and address for the business cases asked for", async () => {
    const { batches, onBatch } = collect();
    await crawl("e", "p", undefined, {
      ...opts, onBatch,
      needsDetail: async (c) => c.map((x) => x.case_no),
    });
    const biz = batches.flat().filter(isBizFibreCase);
    expect(biz).toHaveLength(2);
    for (const c of biz) {
      expect(c.director_name).toBe("RAHIMAH BINTI HABEEB RAHMAN");
      expect(c.full_address).toContain("PANGSAPURI PINGGIRAN PUTRA");
    }
  });

  it("never fetches a detail page for a non-business case", async () => {
    await crawl("e", "p", undefined, {
      ...opts,
      needsDetail: async (c) => c.map((x) => x.case_no),
    });
    expect(detailRequests).toHaveLength(2);
    expect(detailRequests.every((r) => r.includes("module=biz_fibre"))).toBe(true);
  });

  it("fetches nothing when the caller says every case is already filled", async () => {
    const { batches, onBatch } = collect();
    await crawl("e", "p", undefined, { ...opts, onBatch, needsDetail: async () => [] });
    expect(detailRequests).toHaveLength(0);
    expect(batches.flat().every((c) => c.director_name === null)).toBe(true);
  });

  it("fetches only the cases the caller names, not the whole page", async () => {
    await crawl("e", "p", undefined, {
      ...opts,
      needsDetail: async (c) => [c[0].case_no],
    });
    expect(detailRequests).toHaveLength(1);
    expect(detailRequests[0]).toContain("/applications/200");
  });

  it("skips enrichment entirely when no callback is supplied (the local CLI)", async () => {
    await crawl("e", "p", undefined, opts);
    expect(detailRequests).toHaveLength(0);
  });

  it("the sink receives the ENRICHED rows — enrichment runs before persisting", async () => {
    const seen: (string | null)[] = [];
    await crawl("e", "p", undefined, {
      ...opts,
      needsDetail: async (c) => c.map((x) => x.case_no),
      onBatch: async (b) => { for (const c of b.filter(isBizFibreCase)) seen.push(c.director_name); },
    });
    expect(seen).toEqual(["RAHIMAH BINTI HABEEB RAHMAN", "RAHIMAH BINTI HABEEB RAHMAN"]);
  });

  it("a detail page that fails leaves the case usable rather than failing the crawl", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(url);
      const hdrs = { get: (k: string) => (k === "location" ? "https://x/dashboard" : null), getSetCookie: () => ["s=1"] };
      if (u.pathname === "/login") return { ok: true, headers: hdrs, text: async (): Promise<string> => `<input name="_token" value="tok">` };
      if (/^\/applications\/\d+$/.test(u.pathname)) throw new Error("portal 500");
      const all = data[u.searchParams.get("module")!] ?? [];
      const start = Number(u.searchParams.get("start"));
      return { ok: true, status: 200, headers: hdrs, json: async () => ({ draw: 1, recordsTotal: all.length, recordsFiltered: all.length, data: all.slice(start) }) };
    }));
    const { batches, onBatch } = collect();
    const out = await crawl("e", "p", undefined, {
      ...opts, onBatch, needsDetail: async (c) => c.map((x) => x.case_no),
    });
    expect(out.complete).toBe(true);
    const biz = batches.flat().filter(isBizFibreCase);
    expect(biz).toHaveLength(2);
    // The list-row fields still made it through.
    expect(biz[0].company_reg).toBe("QC9994653");
    // Still NULL — no page was read, so the next crawl must try again.
    expect(biz[0].director_name).toBeNull();
  });

  it("stops starting detail fetches once the pass deadline has passed", async () => {
    await crawl("e", "p", undefined, {
      ...opts,
      deadline: Date.now() - 1,
      needsDetail: async (c) => c.map((x) => x.case_no),
    });
    expect(detailRequests).toHaveLength(0);
  });
});

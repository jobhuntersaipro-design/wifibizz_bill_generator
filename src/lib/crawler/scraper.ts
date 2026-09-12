import * as cheerio from "cheerio";
import type { CaseData } from "./db";

// Regular agents live on wifibizz.com (the admin portal admin.wifibizz.com only
// accepts superadmin accounts, so per-user login there fails for normal agents).
const DEFAULT_BASE_URL = "https://wifibizz.com";

function getBaseUrl(): string {
  return process.env.WIFIBIZZ_BASE_URL || DEFAULT_BASE_URL;
}

interface LoginSession {
  cookies: string;
}

// ── Step 1: Extract CSRF token from login page ──

async function getCsrfToken(baseUrl: string): Promise<{ token: string; cookies: string }> {
  const res = await fetch(`${baseUrl}/login`, {
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });

  const html = await res.text();
  const $ = cheerio.load(html);
  const token = $('input[name="_token"]').val();

  if (!token || typeof token !== "string") {
    throw new Error("Failed to extract CSRF token from login page");
  }

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookieString = setCookies.map((c) => c.split(";")[0]).join("; ");

  return { token, cookies: cookieString };
}

// ── Step 2: Login with credentials ──

async function login(
  baseUrl: string,
  email: string,
  password: string
): Promise<LoginSession> {
  const { token, cookies: initialCookies } = await getCsrfToken(baseUrl);

  const body = new URLSearchParams({
    _token: token,
    email,
    password,
  });

  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: initialCookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: `${baseUrl}/login`,
    },
    body: body.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const newCookies = setCookies.map((c) => c.split(";")[0]);

  // Merge initial cookies with new ones (new ones override)
  const cookieMap = new Map<string, string>();
  for (const c of initialCookies.split("; ")) {
    const [key, ...rest] = c.split("=");
    if (key) cookieMap.set(key, rest.join("="));
  }
  for (const c of newCookies) {
    const [key, ...rest] = c.split("=");
    if (key) cookieMap.set(key, rest.join("="));
  }

  const mergedCookies = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  // Check if login succeeded (redirect to dashboard, not back to login)
  const location = res.headers.get("location") || "";
  if (location.includes("/login")) {
    throw new Error("Login failed — invalid credentials");
  }

  return { cookies: mergedCookies };
}

// ── Step 3: Query DataTables API ──

interface DataTablesResponse {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: Record<string, unknown>[];
}

// Parse the portal's "YYYY-MM-DD HH:MM:SS" timestamp; null if unparseable.
function parseCreatedAt(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// The portal has NO server-side date filter and this account can see the whole
// platform (home_fibre alone reports ~88k records), so a window is reached by
// paging NEWEST-FIRST (created_at DESC) and stopping once we page past `from`.
//
// PAGE SIZE IS THE BIG LEVER. Measured against the live portal 2026-09-11:
// length=100 -> 54.0 ms/row, 500 -> 7.8, 1000 -> 6.4, 2000 -> 5.1, 5000 -> 4.2.
// At 100 a 12-month window needed ~425 requests (~12 min) and could never finish
// inside the platform time cap. 1000 is the sweet spot: ~8x cheaper per row while
// keeping a response ~3 MB, so memory and the 30 s per-request timeout stay safe.
export const CRAWL_PAGE_LENGTH = 1000;

// Each module is its own endpoint on wifibizz.com (/applications?module=…) and they
// return disjoint sets, so all three are swept in order.
export const CRAWL_MODULES = ["home_fibre", "biz_fibre", "4g"] as const;

// Runaway guard: a bad cutoff must never page the entire platform.
const MAX_ROWS_PER_MODULE = 200_000;

/** Where a crawl pass stopped, so the next pass resumes instead of re-paging. */
export interface CrawlCursor {
  moduleIndex: number;
  start: number;
}

async function fetchPage(
  baseUrl: string,
  session: LoginSession,
  module: string,
  start: number
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    draw: "1",
    start: start.toString(),
    length: CRAWL_PAGE_LENGTH.toString(),
    "columns[0][data]": "created_at",
    "columns[0][name]": "created_at",
    "columns[0][orderable]": "true",
    "order[0][column]": "0",
    "order[0][dir]": "desc",
    module, // required on wifibizz.com — /applications 404s without it
  });

  const res = await fetch(`${baseUrl}/applications?${params.toString()}`, {
    headers: {
      Cookie: session.cookies,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: `${baseUrl}/applications`,
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    throw new Error(`DataTables API returned ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as DataTablesResponse;
  return json.data || [];
}

// ── Step 3b: Fetch case detail page for address ──
// Exported for lazy, on-demand use at bill-generation time — the crawl no longer
// fetches addresses inline (too many detail pages for a month of platform data).

export interface CaseDetailFields {
  address: string;
  companyName: string;
  companyReg: string;
  /** Customer-tab Name / Full Name (as per ID) — the director, not the company. */
  customerName: string;
}

function normalizeDetailLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/\s*\*$/, "").replace(/\.$/, "");
}

/** Label/value pairs from a WifiBizz case view or edit page. */
export function parseCaseDetailFields(html: string): CaseDetailFields {
  const $ = cheerio.load(html);
  const out: CaseDetailFields = { address: "", companyName: "", companyReg: "", customerName: "" };
  $("label").each((_, el) => {
    const label = normalizeDetailLabel($(el).text());
    const value = $(el).next().text().replace(/\s+/g, " ").trim();
    if (!value) return;
    if (label === "Address") out.address = value;
    else if (label === "Company Name") out.companyName = value;
    else if (label === "Company Registration No") out.companyReg = value;
    else if (label === "Name" || label === "Full Name (as per ID)") out.customerName = value;
  });
  return out;
}

export async function fetchCaseAddress(
  baseUrl: string,
  session: LoginSession,
  caseId: number,
  module: string = "home_fibre"
): Promise<string> {
  const fields = await fetchCaseDetail(baseUrl, session, caseId, module);
  return fields.address;
}

async function fetchCaseDetail(
  baseUrl: string,
  session: LoginSession,
  caseId: number,
  module: string = "home_fibre",
): Promise<CaseDetailFields> {
  const empty: CaseDetailFields = { address: "", companyName: "", companyReg: "", customerName: "" };
  const res = await fetch(`${baseUrl}/applications/${caseId}?module=${module}`, {
    headers: {
      Cookie: session.cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return empty;
  return parseCaseDetailFields(await res.text());
}

// ── Step 4: Extract all cases ──

export function extractCases(records: Record<string, unknown>[], baseUrl: string): CaseData[] {
  return records.map((r) => {
    const appItem = (r.application_item as Record<string, unknown>) || {};
    const appDetail = (r.application_detail as Record<string, unknown>) || {};

    const agentName = (r.agent_name as string) || "";
    const staffId = (r.agent_staff_id as string) || "";
    const agent = staffId ? `${agentName} (${staffId})` : agentName;

    // prefix_with_no contains HTML like:
    // <a href="/applications/162724?module=home_fibre&amp;application_no=202621915">202621915</a>
    const rawCaseNo = (r.prefix_with_no as string) || "";
    const caseNo = rawCaseNo.replace(/<[^>]*>/g, "").trim();

    // Extract href from the anchor tag, decode HTML entities
    const hrefMatch = rawCaseNo.match(/href="([^"]+)"/);
    let caseUrl = hrefMatch
      ? `${baseUrl}${hrefMatch[1].replace(/&amp;/g, "&")}`
      : "";

    // Fallback: build URL from record id + module if href extraction failed
    if (!caseUrl && r.id) {
      const moduleName = (r.operator_type as string) || "home_fibre";
      caseUrl = `${baseUrl}/applications/${r.id}?module=${moduleName}${caseNo ? `&application_no=${caseNo}` : ""}`;
    }

    // status contains HTML like <span class="badge badge-success">Activated</span>
    const rawStatus = (r.status as string) || "";
    const statusText = cheerio.load(rawStatus).root().text().trim() || rawStatus.replace(/<[^>]*>/g, "").trim();

    return {
      case_no: caseNo,
      case_url: caseUrl,
      full_name: (r.customer_name as string) || "",
      full_address: "",
      mobile: (r.customer_full_mobile_no as string) || "",
      email: (r.customer_email as string) || "",
      id_no: (r.customer_id_no as string) || "",
      provider: (r.operator_name as string) || "",
      package: (appItem.item_name as string) || (r.package as string) || "",
      order_no: (appDetail.order_no as string) || (r.order_no as string) || "",
      agent,
      agent_remark: (r.agent_remark as string) || "",
      status: statusText,
      case_created_at: (r.created_at as string) || "",
    };
  });
}

// ── Public API ──

/**
 * Test WifiBizz credentials by attempting login only (no crawling).
 * Returns true if login succeeds, throws on failure.
 */
export async function testConnection(
  email: string,
  password: string
): Promise<{ success: true }> {
  const baseUrl = getBaseUrl();
  await login(baseUrl, email, password);
  return { success: true };
}

export interface CrawlResult {
  total: number;
  saved: number;
  timestamp: string;
}

export interface CrawlProgress {
  step: string;
  current: number;
  total: number;
  percent: number;
}

export interface CrawlOptions {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  /** Resume point from a previous pass. Omit to start at the newest row. */
  cursor?: CrawlCursor | null;
  /** Date.now() value after which the pass stops cleanly and returns a cursor. */
  deadline?: number;
  /** Rows already saved by earlier passes — progress reporting only. */
  fetchedSoFar?: number;
  /** Persist each page as it arrives instead of buffering the whole window. */
  onBatch?: (cases: CaseData[]) => Promise<void>;
}

export interface CrawlOutcome {
  /** Only populated when no `onBatch` sink was supplied. */
  cases: CaseData[];
  fetched: number;
  complete: boolean;
  nextCursor: CrawlCursor | null;
  oldestSeen: string | null;
}

export async function crawl(
  email: string,
  password: string,
  onProgress?: (progress: CrawlProgress) => void,
  options?: CrawlOptions
): Promise<CrawlOutcome> {
  const baseUrl = getBaseUrl();

  onProgress?.({ step: "Logging in to WifiBizz...", current: 0, total: 0, percent: 5 });
  const session = await login(baseUrl, email, password);

  // Default window = the last 1 month; the crawl page's From/To override it.
  const now = new Date();
  const from = options?.dateFrom
    ? new Date(options.dateFrom + "T00:00:00")
    : new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const to = options?.dateTo ? new Date(options.dateTo + "T23:59:59") : null;

  const deadline = options?.deadline ?? Infinity;
  const onBatch = options?.onBatch;
  const startCursor: CrawlCursor = options?.cursor ?? { moduleIndex: 0, start: 0 };
  const alreadyFetched = options?.fetchedSoFar ?? 0;

  // Only buffered when there is no sink to stream into (the local CLI script).
  const collected: CaseData[] = [];
  let fetched = 0;
  let oldestSeen: string | null = null;

  const emit = (step: string) =>
    onProgress?.({
      step,
      current: alreadyFetched + fetched,
      total: 0,
      percent: Math.min(90, 15 + Math.floor((alreadyFetched + fetched) / 500)),
    });

  for (let mi = startCursor.moduleIndex; mi < CRAWL_MODULES.length; mi++) {
    const mod = CRAWL_MODULES[mi];
    let start = mi === startCursor.moduleIndex ? startCursor.start : 0;
    emit(`Fetching ${mod}…`);

    for (;;) {
      if (start >= MAX_ROWS_PER_MODULE) break;

      const rows = await fetchPage(baseUrl, session, mod, start);
      if (rows.length === 0) break;

      // Rows are newest-first, so the first row older than `from` ends this module.
      let reachedCutoff = false;
      const keep: Record<string, unknown>[] = [];
      for (const r of rows) {
        const ca = parseCreatedAt(r.created_at as string);
        if (from && ca && ca < from) {
          reachedCutoff = true;
          break;
        }
        if (to && ca && ca > to) continue; // newer than the window end — skip
        keep.push(r);
        if (r.created_at) oldestSeen = r.created_at as string;
      }

      const cases = extractCases(keep, baseUrl);
      fetched += cases.length;

      // PERSIST AS WE GO. Buffering the whole window and saving at the end is what
      // made a timeout throw away 100% of the work — and 42k rows in memory is its
      // own problem. Whatever this pass fetched is already saved before it returns.
      if (onBatch) await onBatch(cases);
      else collected.push(...cases);

      start += rows.length;
      emit(`Fetching ${mod}… ${alreadyFetched + fetched} found`);

      if (reachedCutoff) break;

      // Out of time: hand back exactly where to resume. The next pass picks up at
      // this module/offset rather than re-paging from the top.
      if (Date.now() >= deadline) {
        return {
          cases: collected,
          fetched,
          complete: false,
          nextCursor: { moduleIndex: mi, start },
          oldestSeen,
        };
      }
    }
  }

  emit("Complete");
  return { cases: collected, fetched, complete: true, nextCursor: null, oldestSeen };
}

// ── Lazy address fill (bill-time) ──
// The crawl stores cases list-only (no address). When a bill is generated for a
// case that has no stored address, resolve it on demand: log in once with the
// shared crawl account and pull each case's detail-page address. The portal case
// id + module are parsed from the stored `case_url`
// (…/applications/<id>?module=<operator_type>). Best-effort — a case that can't be
// resolved is simply omitted from the result. Returns { case_no: address }.
export async function fetchCaseDetailsForCases(
  email: string,
  password: string,
  items: { caseNo: string; caseUrl: string }[],
): Promise<Record<string, CaseDetailFields>> {
  const out: Record<string, CaseDetailFields> = {};
  if (items.length === 0) return out;

  const baseUrl = getBaseUrl();
  const session = await login(baseUrl, email, password);

  const CONCURRENCY = 6;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (it) => {
        const m = it.caseUrl?.match(/\/applications\/(\d+)(?:\/edit)?\?module=([a-z0-9_]+)/i);
        if (!m) return;
        try {
          const fields = await fetchCaseDetail(baseUrl, session, Number(m[1]), m[2]);
          if (fields.address || fields.companyReg || fields.customerName || fields.companyName) {
            out[it.caseNo] = fields;
          }
        } catch {
          // best-effort — leave this case unresolved
        }
      })
    );
  }
  return out;
}

export async function fetchAddressesForCases(
  email: string,
  password: string,
  items: { caseNo: string; caseUrl: string }[]
): Promise<Record<string, string>> {
  const details = await fetchCaseDetailsForCases(email, password, items);
  const out: Record<string, string> = {};
  for (const [caseNo, fields] of Object.entries(details)) {
    if (fields.address.trim()) out[caseNo] = fields.address.trim();
  }
  return out;
}

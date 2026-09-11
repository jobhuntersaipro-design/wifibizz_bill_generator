import * as cheerio from "cheerio";
import type { CaseData } from "./db";
import { formatCrawlDate, toPortalCreatedAtFilter } from "./date-window";

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

// Newest-first with portal `created_at` Advanced Search. Without the filter, a
// 1-year lookback walks ~40k rows and dies under Vercel's 300s cap before upsert.
async function fetchCasesInWindow(
  baseUrl: string,
  session: LoginSession,
  from: Date | null,
  to: Date | null,
  module: string,
  portalCreatedAt: string | null,
  onPage?: (rowsSoFar: number) => void
): Promise<Record<string, unknown>[]> {
  const allRecords: Record<string, unknown>[] = [];
  let start = 0;
  const length = 500;
  const MAX_PAGES = 800; // backstop so a bad cutoff can never run away

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      draw: "1",
      start: start.toString(),
      length: length.toString(),
      "columns[0][data]": "created_at",
      "columns[0][name]": "created_at",
      "columns[0][orderable]": "true",
      "order[0][column]": "0",
      "order[0][dir]": "desc",
      module, // required on wifibizz.com — /applications 404s without it (each module is its own endpoint)
    });
    if (portalCreatedAt) params.set("created_at", portalCreatedAt);

    const res = await fetch(`${baseUrl}/applications?${params.toString()}`, {
      headers: {
        Cookie: session.cookies,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: `${baseUrl}/applications`,
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`DataTables API returned ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as DataTablesResponse;
    const rows = json.data || [];
    if (rows.length === 0) break;

    let reachedCutoff = false;
    for (const r of rows) {
      const ca = parseCreatedAt(r.created_at as string);
      if (from && ca && ca < from) {
        reachedCutoff = true; // rows are newest-first, so everything after is older too
        break;
      }
      if (to && ca && ca > to) continue; // newer than the window end — skip
      allRecords.push(r);
    }

    onPage?.(allRecords.length);
    if (reachedCutoff) break;
    start += length;
  }

  return allRecords;
}

// ── Step 3b: Fetch case detail page for address ──
// Exported for lazy, on-demand use at bill-generation time — the crawl no longer
// fetches addresses inline (too many detail pages for a month of platform data).

export async function fetchCaseAddress(
  baseUrl: string,
  session: LoginSession,
  caseId: number,
  module: string = "home_fibre"
): Promise<string> {
  const res = await fetch(`${baseUrl}/applications/${caseId}?module=${module}`, {
    headers: {
      Cookie: session.cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return "";

  const html = await res.text();
  const $ = cheerio.load(html);

  // Address is in a <label> with text "Address" — the next sibling has the value
  let address = "";
  $("label").each((_, el) => {
    if ($(el).text().trim() === "Address") {
      address = $(el).next().text().trim();
      return false;
    }
  });

  return address;
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
}

export async function crawl(
  email: string,
  password: string,
  onProgress?: (progress: CrawlProgress) => void,
  options?: CrawlOptions
): Promise<{ cases: CaseData[] }> {
  const baseUrl = getBaseUrl();

  onProgress?.({ step: "Logging in to WifiBizz...", current: 0, total: 0, percent: 5 });
  const session = await login(baseUrl, email, password);

  // Bound the crawl to a recent window. Default = last 1 month; From/To override.
  // Always send WifiBizz `created_at` Advanced Search so the server filters the
  // window — newest-first paging alone cannot finish a year under maxDuration.
  const now = new Date();
  const dateFromStr =
    options?.dateFrom ??
    formatCrawlDate(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
  const dateToStr = options?.dateTo ?? formatCrawlDate(now);
  const from = new Date(dateFromStr + "T00:00:00");
  const to = new Date(dateToStr + "T23:59:59");
  const portalCreatedAt = toPortalCreatedAtFilter(dateFromStr, dateToStr);

  // Each module is a separate endpoint on wifibizz.com (/applications?module=…),
  // so sweep them one by one and combine, de-duping by case number.
  const MODULES = ["home_fibre", "biz_fibre", "4g"];
  const allRecords: Record<string, unknown>[] = [];
  const seenCaseNos = new Set<string>();
  for (const mod of MODULES) {
    onProgress?.({ step: `Fetching ${mod}…`, current: allRecords.length, total: 0, percent: 15 });
    const recs = await fetchCasesInWindow(
      baseUrl,
      session,
      from,
      to,
      mod,
      portalCreatedAt,
      (rowsInModule) => {
      const found = allRecords.length + rowsInModule;
      onProgress?.({
        step: `Fetching ${mod}… ${found} found`,
        current: found,
        total: 0,
        percent: Math.min(90, 15 + Math.floor(found / 100)),
      });
    });
    for (const r of recs) {
      const cn = ((r.prefix_with_no as string) || "").replace(/<[^>]*>/g, "").trim();
      if (cn && seenCaseNos.has(cn)) continue;
      if (cn) seenCaseNos.add(cn);
      allRecords.push(r);
    }
  }

  onProgress?.({ step: "Processing cases...", current: 0, total: allRecords.length, percent: 92 });
  const cases = extractCases(allRecords, baseUrl);
  // Keep ALL statuses (Activated/Pending/Processed/Rejected/Follow Up/…) within the
  // window. All modules (home/biz/4g) are combined above.

  // NOTE: addresses are intentionally NOT fetched here. The detail-page address is
  // one HTTP request PER case; for a month of platform-wide cases (thousands) that
  // would take ~10 min and blow the serverless limit. `full_address` stays empty
  // and is filled lazily (fetchCaseAddress) when a bill is generated for a case.

  onProgress?.({ step: "Complete", current: cases.length, total: cases.length, percent: 100 });
  return { cases };
}

// ── Lazy address fill (bill-time) ──
// The crawl stores cases list-only (no address). When a bill is generated for a
// case that has no stored address, resolve it on demand: log in once with the
// shared crawl account and pull each case's detail-page address. The portal case
// id + module are parsed from the stored `case_url`
// (…/applications/<id>?module=<operator_type>). Best-effort — a case that can't be
// resolved is simply omitted from the result. Returns { case_no: address }.
export async function fetchAddressesForCases(
  email: string,
  password: string,
  items: { caseNo: string; caseUrl: string }[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
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
          const addr = await fetchCaseAddress(baseUrl, session, Number(m[1]), m[2]);
          if (addr && addr.trim()) out[it.caseNo] = addr.trim();
        } catch {
          // best-effort — leave this case unresolved (bill just won't get an address)
        }
      })
    );
  }
  return out;
}

import * as cheerio from "cheerio";
import type { CaseData } from "./db";

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

async function fetchCases(
  baseUrl: string,
  session: LoginSession,
  module: string
): Promise<Record<string, unknown>[]> {
  const allRecords: Record<string, unknown>[] = [];
  let start = 0;
  const length = 100;

  while (true) {
    const params = new URLSearchParams({
      draw: "1",
      start: start.toString(),
      length: length.toString(),
      "columns[0][data]": "prefix_with_no",
      "columns[0][name]": "",
      "columns[0][searchable]": "true",
      "columns[0][orderable]": "true",
      module,
    });

    const res = await fetch(`${baseUrl}/applications?${params.toString()}`, {
      headers: {
        Cookie: session.cookies,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: `${baseUrl}/applications`,
      },
    });

    if (!res.ok) {
      throw new Error(`DataTables API returned ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as DataTablesResponse;

    allRecords.push(...(json.data || []));

    if (!json.data?.length || start + length >= json.recordsFiltered) {
      break;
    }
    start += length;
  }

  return allRecords;
}

// ── Step 3b: Fetch case detail page for address ──

async function fetchCaseAddress(
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
      const module = (r.operator_type as string) || "home_fibre";
      caseUrl = `${baseUrl}/applications/${r.id}?module=${module}${caseNo ? `&application_no=${caseNo}` : ""}`;
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

export interface CrawlResult {
  total: number;
  saved: number;
  timestamp: string;
}

export async function crawl(
  email: string,
  password: string
): Promise<{ cases: CaseData[] }> {
  const baseUrl = getBaseUrl();

  const session = await login(baseUrl, email, password);

  const modules = ["home_fibre", "biz_fibre"];
  const allRecords: Record<string, unknown>[] = [];
  for (const mod of modules) {
    const records = await fetchCases(baseUrl, session, mod);
    allRecords.push(...records);
  }

  const cases = extractCases(allRecords, baseUrl);

  // Fetch address from each case's detail page
  for (const c of cases) {
    const record = allRecords.find((r) => {
      const raw = (r.prefix_with_no as string) || "";
      return raw.replace(/<[^>]*>/g, "").trim() === c.case_no;
    });
    if (record) {
      const caseId = record.id as number;
      const module = (record.operator_type as string) || "home_fibre";
      c.full_address = await fetchCaseAddress(baseUrl, session, caseId, module);
    }
  }

  return { cases };
}

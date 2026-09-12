import { neon } from "@neondatabase/serverless";
import { fetchAddressesForCases, fetchCaseDetailsForCases, type CaseDetailFields } from "@/lib/crawler/scraper";
import { getUserPassword } from "@/lib/crawler/db";

export interface WifibizzUserForAddress {
  id: number;
  wifibizzEmail: string;
  wifibizzPasswordEnc: string;
  lastCrawlAt: Date | null;
  googleSheetId: string | null;
}

export interface CaseAddressInput {
  case_no: string;
  full_address: string | null;
  case_url: string | null;
}

/**
 * Lazy address fill: the crawler stores cases list-only (no address), so cases
 * crawled that way have an empty full_address. Fetch it on demand from the
 * portal, persist it, and return it — so bills and closing scripts get the real
 * address. Best-effort: if creds are unset or a case can't be resolved, the
 * caller still proceeds (with a blank address) rather than failing.
 *
 * Role-based: resolves using the case owner's own WifiBizz account. Falls back
 * to the shared crawl env if configured.
 *
 * @returns map of case_no → resolved address (only cases that were resolved)
 */
export async function fillMissingAddresses(
  user: WifibizzUserForAddress,
  cases: CaseAddressInput[],
  opts?: { force?: boolean },
): Promise<Record<string, string>> {
  const missing = cases.filter(
    (c) => (opts?.force || !c.full_address || !c.full_address.trim()) && c.case_url
  );
  if (missing.length === 0) return {};

  const crawlEmail = user.wifibizzEmail || process.env.WIFIBIZZ_CRAWL_EMAIL || "";
  const crawlPassword =
    getUserPassword({
      id: user.id,
      wifibizz_email: user.wifibizzEmail,
      wifibizz_password_enc: user.wifibizzPasswordEnc,
      last_crawl_at: user.lastCrawlAt?.toISOString() ?? null,
    }) || process.env.WIFIBIZZ_CRAWL_PASSWORD || "";

  if (!crawlEmail || !crawlPassword) return {};

  try {
    const resolved = await fetchAddressesForCases(
      crawlEmail,
      crawlPassword,
      missing.map((c) => ({ caseNo: c.case_no, caseUrl: c.case_url! }))
    );

    const sql = neon(process.env.DATABASE_URL!);
    await Promise.all(
      Object.entries(resolved).map(([caseNo, address]) =>
        sql`
          UPDATE wifibizz_cases
          SET full_address = ${address}, updated_at = NOW()
          WHERE case_no = ${caseNo} AND user_id = ${user.id}
        `
      )
    );

    // Push the freshly-resolved addresses straight to the user's Google Sheet
    // (if configured) so they appear without waiting for a manual sync.
    if (user.googleSheetId && Object.keys(resolved).length > 0) {
      try {
        const { updateSheetAddresses } = await import("@/lib/google-sheets");
        await updateSheetAddresses(
          user.googleSheetId,
          Object.entries(resolved).map(([caseNo, fullAddress]) => ({ caseNo, fullAddress }))
        );
      } catch (e) {
        console.error("Sheet address sync failed:", e);
      }
    }

    return resolved;
  } catch (err) {
    console.error("Lazy address fetch failed:", err);
    return {};
  }
}

function crawlCreds(user: WifibizzUserForAddress): { email: string; password: string } {
  return {
    email: user.wifibizzEmail || process.env.WIFIBIZZ_CRAWL_EMAIL || "",
    password:
      getUserPassword({
        id: user.id,
        wifibizz_email: user.wifibizzEmail,
        wifibizz_password_enc: user.wifibizzPasswordEnc,
        last_crawl_at: user.lastCrawlAt?.toISOString() ?? null,
      }) || process.env.WIFIBIZZ_CRAWL_PASSWORD || "",
  };
}

/**
 * Pull Company Name, Company Registration No, and Customer-tab Name from the
 * same WifiBizz detail page the address fill uses. Persists any newly resolved
 * address. Best-effort: missing creds or a failed page leave the case out.
 */
export async function fetchBizzDetailFields(
  user: WifibizzUserForAddress,
  cases: CaseAddressInput[],
): Promise<Record<string, CaseDetailFields>> {
  const withUrl = cases.filter((c) => c.case_url);
  if (withUrl.length === 0) return {};

  const { email, password } = crawlCreds(user);
  if (!email || !password) return {};

  try {
    const details = await fetchCaseDetailsForCases(
      email,
      password,
      withUrl.map((c) => ({ caseNo: c.case_no, caseUrl: c.case_url! })),
    );

    const sql = neon(process.env.DATABASE_URL!);
    await Promise.all(
      Object.entries(details).map(([caseNo, fields]) => {
        const address = fields.address.trim();
        const row = withUrl.find((c) => c.case_no === caseNo);
        if (!address || (row?.full_address && row.full_address.trim())) return Promise.resolve();
        return sql`
          UPDATE wifibizz_cases
          SET full_address = ${address}, updated_at = NOW()
          WHERE case_no = ${caseNo} AND user_id = ${user.id}
        `;
      }),
    );

    return details;
  } catch (err) {
    console.error("Bizz detail fetch failed:", err);
    return {};
  }
}

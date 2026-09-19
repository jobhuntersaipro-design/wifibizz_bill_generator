import { neon } from "@neondatabase/serverless";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return neon(url);
}

// ── Schema setup ──

export async function createTables() {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS wifibizz_users (
      id                    SERIAL PRIMARY KEY,
      wifibizz_email        VARCHAR(255) UNIQUE NOT NULL,
      wifibizz_password_enc VARCHAR(500) NOT NULL,
      last_crawl_at         TIMESTAMP,
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wifibizz_cases (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES wifibizz_users(id),
      case_no         VARCHAR(20) NOT NULL,
      case_url        TEXT,
      full_name       VARCHAR(255),
      full_address    TEXT,
      mobile          VARCHAR(50),
      email           VARCHAR(255),
      id_no           VARCHAR(50),
      id_type         VARCHAR(50),
      company_name    VARCHAR(255),
      company_reg     VARCHAR(100),
      director_name   VARCHAR(255),
      provider        VARCHAR(255),
      package         VARCHAR(500),
      order_no        VARCHAR(50),
      agent           VARCHAR(255),
      agent_remark    TEXT,
      status          VARCHAR(50) DEFAULT 'Activated',
      case_created_at TIMESTAMP,
      scraped_at      TIMESTAMP DEFAULT NOW(),
      updated_at      TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, case_no)
    )
  `;

  // Add case_url column if it doesn't exist (for existing tables)
  await sql`
    ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS case_url TEXT
  `;

  // Business-case fields (see migration 20260919120000).
  await sql`ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS id_type VARCHAR(50)`;
  await sql`ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`;
  await sql`ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS company_reg VARCHAR(100)`;
  await sql`ALTER TABLE wifibizz_cases ADD COLUMN IF NOT EXISTS director_name VARCHAR(255)`;

  // Indexes for common query patterns
  await sql`CREATE INDEX IF NOT EXISTS idx_wc_user_status ON wifibizz_cases(user_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wc_user_created ON wifibizz_cases(user_id, case_created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wc_user_fullname ON wifibizz_cases(user_id, full_name)`;
}

// ── User operations ──

export interface WifibizzUser {
  id: number;
  wifibizz_email: string;
  wifibizz_password_enc: string;
  last_crawl_at: string | null;
}

export async function upsertUser(email: string, password: string): Promise<WifibizzUser> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO wifibizz_users (wifibizz_email, wifibizz_password_enc)
    VALUES (${email}, ${password})
    ON CONFLICT (wifibizz_email) DO UPDATE SET
      wifibizz_password_enc = ${password},
      updated_at = NOW()
    RETURNING id, wifibizz_email, wifibizz_password_enc, last_crawl_at
  `;

  return rows[0] as WifibizzUser;
}

export async function getUserByEmail(email: string): Promise<WifibizzUser | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, wifibizz_email, wifibizz_password_enc, last_crawl_at
    FROM wifibizz_users
    WHERE wifibizz_email = ${email}
  `;
  return (rows[0] as WifibizzUser) ?? null;
}

export function getUserPassword(user: WifibizzUser): string {
  return user.wifibizz_password_enc;
}

export async function updateLastCrawl(userId: number) {
  const sql = getDb();
  await sql`
    UPDATE wifibizz_users SET last_crawl_at = NOW(), updated_at = NOW()
    WHERE id = ${userId}
  `;
}

// ── Case operations ──

export interface CaseData {
  case_no: string;
  case_url: string;
  full_name: string;
  full_address: string;
  mobile: string;
  email: string;
  id_no: string;
  /** What `id_no` actually is — "passport", "mykad", … straight from the list row. */
  id_type: string;
  company_name: string;
  company_reg: string;
  /**
   * Customer-tab Name (the director). Detail page only.
   * `null` = no detail page read yet. `""` = read, and the portal had no name.
   */
  director_name: string | null;
  provider: string;
  package: string;
  order_no: string;
  agent: string;
  agent_remark: string;
  status: string;
  case_created_at: string;
}

export async function upsertCases(userId: number, cases: CaseData[]): Promise<{ inserted: number; updated: number }> {
  const sql = getDb();
  if (cases.length === 0) return { inserted: 0, updated: 0 };

  // One multi-row INSERT per batch instead of one HTTP request PER ROW. A 12-month
  // window is ~42k cases; at one Neon round trip each that was ~840 serial chunks and
  // a large part of why a long crawl could never finish inside the platform time cap.
  const BATCH = 500;

  // ON CONFLICT DO UPDATE cannot touch the same row twice in one statement
  // ("cannot affect row a second time"), so a case_no repeated inside a batch has to
  // be collapsed first. The crawl already de-dupes across modules; this is the guard
  // that keeps a duplicate from failing the whole statement.
  const byCaseNo = new Map<string, CaseData>();
  for (const c of cases) byCaseNo.set(c.case_no, c);
  const rows = Array.from(byCaseNo.values());

  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    const col = <T,>(f: (c: CaseData) => T) => b.map(f);

    const result = (await sql`
      INSERT INTO wifibizz_cases (
        user_id, case_no, case_url, full_name, full_address, mobile, email, id_no,
        id_type, company_name, company_reg, director_name,
        provider, package, order_no, agent, agent_remark,
        status, case_created_at, scraped_at, updated_at
      )
      SELECT
        ${userId}, t.case_no, t.case_url, t.full_name, t.full_address, t.mobile,
        t.email, t.id_no, t.id_type, t.company_name, t.company_reg, t.director_name,
        t.provider, t.package, t.order_no, t.agent, t.agent_remark,
        t.status, NULLIF(t.case_created_at, '')::timestamp, NOW(), NOW()
      FROM UNNEST(
        ${col((c) => c.case_no)}::text[],
        ${col((c) => c.case_url)}::text[],
        ${col((c) => c.full_name)}::text[],
        ${col((c) => c.full_address)}::text[],
        ${col((c) => c.mobile)}::text[],
        ${col((c) => c.email)}::text[],
        ${col((c) => c.id_no)}::text[],
        ${col((c) => c.id_type)}::text[],
        ${col((c) => c.company_name)}::text[],
        ${col((c) => c.company_reg)}::text[],
        ${col((c) => c.director_name)}::text[],
        ${col((c) => c.provider)}::text[],
        ${col((c) => c.package)}::text[],
        ${col((c) => c.order_no)}::text[],
        ${col((c) => c.agent)}::text[],
        ${col((c) => c.agent_remark)}::text[],
        ${col((c) => c.status || 'Unknown')}::text[],
        ${col((c) => c.case_created_at)}::text[]
      ) AS t(
        case_no, case_url, full_name, full_address, mobile, email, id_no,
        id_type, company_name, company_reg, director_name,
        provider, package, order_no, agent, agent_remark, status, case_created_at
      )
      ON CONFLICT (user_id, case_no) DO UPDATE SET
        case_url = EXCLUDED.case_url,
        full_name = EXCLUDED.full_name,
        -- Don't clobber an already-resolved address: the crawl stores cases
        -- list-only (full_address ''), so keep the lazily-fetched value on re-crawl.
        full_address = CASE WHEN EXCLUDED.full_address = '' THEN wifibizz_cases.full_address
                            ELSE EXCLUDED.full_address END,
        mobile = EXCLUDED.mobile,
        email = EXCLUDED.email,
        id_no = EXCLUDED.id_no,
        id_type = EXCLUDED.id_type,
        company_name = EXCLUDED.company_name,
        company_reg = EXCLUDED.company_reg,
        -- NULL means this sweep read no detail page, so it must not blank a name
        -- an earlier one found. An empty string DOES store: it is the answer
        -- "the page was read and the portal has no name there", which is what
        -- stops such a case being re-fetched on every crawl for ever.
        director_name = COALESCE(EXCLUDED.director_name, wifibizz_cases.director_name),
        provider = EXCLUDED.provider,
        package = EXCLUDED.package,
        order_no = EXCLUDED.order_no,
        agent = EXCLUDED.agent,
        agent_remark = EXCLUDED.agent_remark,
        status = EXCLUDED.status,
        case_created_at = EXCLUDED.case_created_at,
        scraped_at = NOW(),
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert
    `) as { is_insert: boolean }[];

    for (const r of result) {
      if (r.is_insert) inserted++;
      else updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Of these case_nos, which are still worth one detail-page request each.
 *
 * A case is DONE when it has an address AND its detail page has been read —
 * `director_name IS NOT NULL`, which is true even when the portal had no name
 * there (stored as ''). Testing the name for non-emptiness instead would re-fetch
 * the same page on every crawl for ever, for the many cases whose Name field the
 * agent left as a bare dash.
 *
 * Asked as "which are already DONE?" rather than "which are missing?" so a row
 * that has never been seen falls on the needs-it side by default — that is what
 * makes the first crawl backfill, and what catches a legacy row whose address was
 * lazily filled at bill time but whose director was never fetched.
 */
export async function casesNeedingDetail(userId: number, caseNos: string[]): Promise<string[]> {
  if (caseNos.length === 0) return [];
  const sql = getDb();
  const done = (await sql`
    SELECT case_no FROM wifibizz_cases
    WHERE user_id = ${userId}
      AND case_no = ANY(${caseNos}::text[])
      AND COALESCE(full_address, '') <> ''
      AND director_name IS NOT NULL
  `) as { case_no: string }[];

  const filled = new Set(done.map((r) => r.case_no));
  return caseNos.filter((c) => !filled.has(c));
}

export async function getCases(
  email: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ data: CaseData[]; count: number }> {
  const sql = getDb();

  const countResult = await sql`
    SELECT COUNT(*) as count
    FROM wifibizz_cases c
    JOIN wifibizz_users u ON c.user_id = u.id
    WHERE u.wifibizz_email = ${email}
  `;

  const rows = await sql`
    SELECT c.case_no, c.full_name, c.full_address, c.mobile, c.email, c.id_no,
           c.provider, c.package, c.order_no, c.agent, c.agent_remark,
           c.case_created_at
    FROM wifibizz_cases c
    JOIN wifibizz_users u ON c.user_id = u.id
    WHERE u.wifibizz_email = ${email}
    ORDER BY c.case_created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    data: rows as CaseData[],
    count: Number(countResult[0].count),
  };
}

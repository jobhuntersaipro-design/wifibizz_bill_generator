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

  // Upsert in bounded-concurrency chunks. A month of platform-wide cases is now
  // thousands of rows; firing them all at once (one Neon HTTP request each) blows
  // past connection limits. CHUNK requests run concurrently, chunks run in series.
  const CHUNK = 50;
  const results: { is_insert: boolean }[][] = [];
  for (let i = 0; i < cases.length; i += CHUNK) {
    const batch = cases.slice(i, i + CHUNK);
    const batchResults = await Promise.all(
      batch.map((c) =>
      sql`
        INSERT INTO wifibizz_cases (
          user_id, case_no, case_url, full_name, full_address, mobile, email, id_no,
          provider, package, order_no, agent, agent_remark,
          status, case_created_at, scraped_at, updated_at
        ) VALUES (
          ${userId}, ${c.case_no}, ${c.case_url}, ${c.full_name}, ${c.full_address}, ${c.mobile}, ${c.email}, ${c.id_no},
          ${c.provider}, ${c.package}, ${c.order_no}, ${c.agent}, ${c.agent_remark},
          ${c.status || 'Unknown'}, ${c.case_created_at}, NOW(), NOW()
        )
        ON CONFLICT (user_id, case_no) DO UPDATE SET
          case_url = ${c.case_url},
          full_name = ${c.full_name},
          -- Don't clobber an already-resolved address: the crawl stores cases
          -- list-only (full_address ''), so keep the lazily-fetched value on re-crawl.
          full_address = CASE WHEN ${c.full_address} = '' THEN wifibizz_cases.full_address
                              ELSE ${c.full_address} END,
          mobile = ${c.mobile},
          email = ${c.email},
          id_no = ${c.id_no},
          provider = ${c.provider},
          package = ${c.package},
          order_no = ${c.order_no},
          agent = ${c.agent},
          agent_remark = ${c.agent_remark},
          status = ${c.status || 'Unknown'},
          case_created_at = ${c.case_created_at},
          scraped_at = NOW(),
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `
      )
    );
    results.push(...(batchResults as { is_insert: boolean }[][]));
  }

  let inserted = 0;
  let updated = 0;
  for (const rows of results) {
    if (rows[0]?.is_insert) inserted++;
    else updated++;
  }

  return { inserted, updated };
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

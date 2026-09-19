import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import { upsertCases, nextCasesNeedingDetail, saveCaseDetails, type CaseData } from "../db";

// LIVE DATABASE TEST — opt in with CRAWL_DB_TEST=1 (npm run test:db).
// upsertCases is one multi-row INSERT built on UNNEST + ON CONFLICT + xmax. None of
// that can be verified against a mock, and the rules it encodes are load-bearing:
// a re-crawl must not wipe a lazily-resolved address, and a case_no repeated inside
// one batch must not abort the statement. So this talks to a real Postgres, against
// a throwaway user it creates and deletes.
const ENABLED = process.env.CRAWL_DB_TEST === "1";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    return fs.readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  } catch {
    return "";
  }
}

const DB = ENABLED ? databaseUrl() : "";
if (DB) process.env.DATABASE_URL = DB;
const sql = DB ? neon(DB) : (null as unknown as ReturnType<typeof neon>);
let uid = 0;

const mk = (n: string, over: Partial<CaseData> = {}): CaseData => ({
  case_no: n, case_url: `u${n}`, full_name: `NAME ${n}`, full_address: "",
  mobile: "+60123", email: `${n}@x.com`, id_no: "900101012345",
  id_type: "mykad", company_name: "", company_reg: "", director_name: null, provider: "Unifi",
  package: "Home 500", order_no: "ORD1", agent: "A (X1)", agent_remark: "r",
  status: "Activated", case_created_at: "2026-03-28 02:58:37", ...over,
});

beforeAll(async () => {
  if (!ENABLED) return;
  const r = (await sql`
    INSERT INTO wifibizz_users (wifibizz_email, wifibizz_password_enc)
    VALUES ('__upsert_verify__@test','x')
    ON CONFLICT (wifibizz_email) DO UPDATE SET updated_at = NOW()
    RETURNING id`) as { id: number }[];
  uid = r[0].id;
  await sql`DELETE FROM wifibizz_cases WHERE user_id = ${uid}`;
});

afterAll(async () => {
  if (!ENABLED) return;
  await sql`DELETE FROM wifibizz_cases WHERE user_id = ${uid}`;
  await sql`DELETE FROM wifibizz_users WHERE id = ${uid}`;
});

const one = async (caseNo: string, col: string) =>
  ((await sql`SELECT ${sql.unsafe(col)} v FROM wifibizz_cases WHERE user_id=${uid} AND case_no=${caseNo}`) as {v: unknown}[])[0]?.v;

describe.skipIf(!ENABLED)("bulk upsertCases (live db)", () => {
  it("counts fresh rows as inserted and re-upserts as updated", async () => {
    expect(await upsertCases(uid, [mk("T1"), mk("T2"), mk("T3")])).toEqual({ inserted: 3, updated: 0 });
    expect(await upsertCases(uid, [mk("T1"), mk("T2")])).toEqual({ inserted: 0, updated: 2 });
  });

  it("tolerates a duplicate case_no inside one batch, last wins", async () => {
    await expect(
      upsertCases(uid, [mk("T4"), mk("T4", { full_name: "SECOND WINS" }), mk("T5")])
    ).resolves.toBeTruthy();
    expect(await one("T4", "full_name")).toBe("SECOND WINS");
  });

  it("keeps a lazily-resolved address when the crawl carries an empty one", async () => {
    await sql`UPDATE wifibizz_cases SET full_address='NO 5 JALAN X' WHERE user_id=${uid} AND case_no='T1'`;
    await upsertCases(uid, [mk("T1", { full_address: "" })]);
    expect(await one("T1", "full_address")).toBe("NO 5 JALAN X");
  });

  it("still overwrites with a non-empty address", async () => {
    await upsertCases(uid, [mk("T1", { full_address: "NEW ADDR" })]);
    expect(await one("T1", "full_address")).toBe("NEW ADDR");
  });

  it("stores an empty timestamp as NULL and a real one as a date", async () => {
    await upsertCases(uid, [mk("T6", { case_created_at: "" })]);
    expect(await one("T6", "case_created_at")).toBeNull();
    // Read the timestamp back as TEXT. The neon driver returns a naive timestamp
    // shifted by the local offset, so comparing a Date here would assert the
    // machine's timezone rather than what was stored.
    const stored = ((await sql`SELECT to_char(case_created_at,'YYYY-MM-DD HH24:MI:SS') v
      FROM wifibizz_cases WHERE user_id=${uid} AND case_no='T2'`) as {v:string}[])[0].v;
    expect(stored).toBe("2026-03-28 02:58:37");
  });

  it("defaults a blank status to Unknown", async () => {
    await upsertCases(uid, [mk("T7", { status: "" })]);
    expect(await one("T7", "status")).toBe("Unknown");
  });

  it("spans multiple statements past BATCH without double counting", async () => {
    const big = Array.from({ length: 1200 }, (_, i) => mk(`B${i}`));
    expect(await upsertCases(uid, big)).toEqual({ inserted: 1200, updated: 0 });
    const n = ((await sql`SELECT COUNT(*)::int n FROM wifibizz_cases WHERE user_id=${uid} AND case_no LIKE 'B%'`) as {n:number}[])[0].n;
    expect(n).toBe(1200);
  });

  it("counts a large re-upsert as updates, not inserts", async () => {
    // The year-long live run reported more inserts than rows that exist, so pin the
    // insert/update split at a size past BATCH where the counting actually runs.
    const set = Array.from({ length: 1200 }, (_, i) => mk(`R${i}`));
    expect(await upsertCases(uid, set)).toEqual({ inserted: 1200, updated: 0 });
    expect(await upsertCases(uid, set)).toEqual({ inserted: 0, updated: 1200 });
    const n = ((await sql`SELECT COUNT(*)::int n FROM wifibizz_cases WHERE user_id=${uid} AND case_no LIKE 'R%'`) as {n:number}[])[0].n;
    expect(n).toBe(1200);
  });

  it("is a no-op on empty input", async () => {
    expect(await upsertCases(uid, [])).toEqual({ inserted: 0, updated: 0 });
  });
});

// ── Business-case fields (2026-09-19) ──

describe.skipIf(!ENABLED)("business fields", () => {
  it("stores company_name, company_reg and id_type from the list row", async () => {
    await upsertCases(uid, [mk("C1", {
      id_type: "passport", company_name: "SR RAIFA TRADING", company_reg: "JR0191646-W",
    })]);
    expect(await one("C1", "company_name")).toBe("SR RAIFA TRADING");
    expect(await one("C1", "company_reg")).toBe("JR0191646-W");
    expect(await one("C1", "id_type")).toBe("passport");
  });

  it("a list-only re-crawl must not blank a director name the detail page found", async () => {
    await upsertCases(uid, [mk("C2", { director_name: "RAHIMAH BINTI HABEEB RAHMAN" })]);
    await upsertCases(uid, [mk("C2", { director_name: null })]); // list-only sweep
    expect(await one("C2", "director_name")).toBe("RAHIMAH BINTI HABEEB RAHMAN");
  });

  it("but an EMPTY director name does store — it means the page was read", async () => {
    // The distinction the whole re-fetch rule rests on: null = nobody looked,
    // '' = looked, and the portal's Name field is a bare dash.
    await upsertCases(uid, [mk("C2b", { director_name: "SOMEONE" })]);
    await upsertCases(uid, [mk("C2b", { director_name: "" })]);
    expect(await one("C2b", "director_name")).toBe("");
  });

  it("but a newly-read director name does replace the old one", async () => {
    await upsertCases(uid, [mk("C3", { director_name: "OLD NAME" })]);
    await upsertCases(uid, [mk("C3", { director_name: "NEW NAME" })]);
    expect(await one("C3", "director_name")).toBe("NEW NAME");
  });

  describe("the business-details stage queries", () => {
    const BIZ = (n: string) => `https://wifibizz.com/applications/${n}?module=biz_fibre&application_no=${n}`;
    const HOME = (n: string) => `https://wifibizz.com/applications/${n}?module=home_fibre&application_no=${n}`;
    const win = { from: new Date(2026, 0, 1), to: null as Date | null };

    beforeAll(async () => {
      await sql`DELETE FROM wifibizz_cases WHERE user_id = ${uid} AND case_no LIKE 'S%'`;
      await upsertCases(uid, [
        mk("S1", { case_url: BIZ("S1"), case_created_at: "2026-09-18 10:00:00" }),
        mk("S2", { case_url: BIZ("S2"), case_created_at: "2026-09-17 10:00:00" }),
        mk("S3", { case_url: BIZ("S3"), case_created_at: "2026-09-16 10:00:00" }),
        mk("S4", { case_url: HOME("S4"), case_created_at: "2026-09-18 11:00:00" }), // not business
        mk("S5", { case_url: BIZ("S5"), case_created_at: "2025-06-01 10:00:00" }),  // outside window
        // legacy shape: address lazily filled at bill time, detail never read
        mk("S6", { case_url: BIZ("S6"), case_created_at: "2026-09-15 10:00:00", full_address: "OLD ADDR" }),
      ]);
    });

    it("lists unread business cases in the window, newest first", async () => {
      const r = await nextCasesNeedingDetail(uid, { ...win, skip: 0, limit: 10 });
      const mine = r.items.map((i) => i.case_no).filter((n) => n.startsWith("S"));
      expect(mine).toEqual(["S1", "S2", "S3", "S6"]);
    });

    it("counts the remaining, and skip steps past the first N", async () => {
      const all = await nextCasesNeedingDetail(uid, { ...win, skip: 0, limit: 100 });
      const skipped = await nextCasesNeedingDetail(uid, { ...win, skip: 1, limit: 100 });
      expect(skipped.items[0].case_no).toBe(all.items[1].case_no);
      expect(skipped.remaining).toBe(all.remaining);
    });

    it("a saved read drops the case out — even when the portal had no name", async () => {
      await saveCaseDetails(uid, [
        { case_no: "S1", full_address: "1 JALAN A", director_name: "A PERSON", company_name: "", company_reg: "" },
        { case_no: "S2", full_address: "2 JALAN B", director_name: "", company_name: "", company_reg: "" },
      ]);
      const r = await nextCasesNeedingDetail(uid, { ...win, skip: 0, limit: 100 });
      const mine = r.items.map((i) => i.case_no).filter((n) => n.startsWith("S"));
      expect(mine).toEqual(["S3", "S6"]);
      expect(await one("S2", "director_name")).toBe("");
    });

    it("an empty read never blanks an address the row already has", async () => {
      await saveCaseDetails(uid, [
        { case_no: "S6", full_address: "", director_name: "B PERSON", company_name: "", company_reg: "" },
      ]);
      expect(await one("S6", "full_address")).toBe("OLD ADDR");
      expect(await one("S6", "director_name")).toBe("B PERSON");
    });

    it("company from the list row is kept; the detail page only fills a gap", async () => {
      await upsertCases(uid, [mk("S7", { case_url: BIZ("S7"), company_name: "LIST CO", company_reg: "" })]);
      await saveCaseDetails(uid, [
        { case_no: "S7", full_address: "", director_name: "", company_name: "PAGE CO", company_reg: "PAGE-REG" },
      ]);
      expect(await one("S7", "company_name")).toBe("LIST CO");
      expect(await one("S7", "company_reg")).toBe("PAGE-REG");
    });

    it("the window's lower bound excludes older cases", async () => {
      const r = await nextCasesNeedingDetail(uid, { from: new Date(2026, 8, 17), to: null, skip: 0, limit: 100 });
      expect(r.items.map((i) => i.case_no)).not.toContain("S3");
    });

    it("is scoped to the user", async () => {
      const r = await nextCasesNeedingDetail(uid + 999999, { ...win, skip: 0, limit: 100 });
      expect(r.items).toHaveLength(0);
      expect(r.remaining).toBe(0);
    });
  });
});

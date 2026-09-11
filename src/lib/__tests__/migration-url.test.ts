import { describe, it, expect } from "vitest";
import { toDirectNeonUrl } from "../../../prisma.config";

/**
 * `toDirectNeonUrl` picks the CONNECTION MIGRATIONS RUN ON. Nothing in the app imports
 * prisma.config.ts — the Prisma CLI loads it — so without this the rule is untested.
 *
 * Why it matters: `prisma migrate deploy` guards itself with a SESSION-level
 * `pg_advisory_lock(72707369)`. Taken through PgBouncer that lock is stranded on a
 * pooled backend the pooler keeps alive, and every later migration dies with P1002.
 * Production deploys were blocked by exactly this on 2026-09-11.
 */
const POOLED =
  "postgresql://u:pw@ep-solitary-art-a19qjamt-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://u:pw@ep-solitary-art-a19qjamt.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

describe("migration connection url", () => {
  it("strips Neon's -pooler so migrations never take the advisory lock through PgBouncer", () => {
    expect(toDirectNeonUrl(POOLED)).toBe(DIRECT);
    expect(toDirectNeonUrl(POOLED)).not.toContain("-pooler");
  });

  it("leaves an already-direct url untouched and is idempotent", () => {
    expect(toDirectNeonUrl(DIRECT)).toBe(DIRECT);
    expect(toDirectNeonUrl(toDirectNeonUrl(POOLED))).toBe(toDirectNeonUrl(POOLED));
  });

  it("keeps credentials, database and query string intact", () => {
    const out = toDirectNeonUrl(POOLED);
    expect(out).toContain("//u:pw@");
    expect(out).toContain("/neondb");
    expect(out).toContain("sslmode=require");
  });

  it("does not touch a non-Neon host that happens to contain -pooler", () => {
    const other = "postgresql://u:pw@db-pooler.internal:5432/app";
    expect(toDirectNeonUrl(other)).toBe(other);
  });

  it("only rewrites the host, not a -pooler substring in the password or db name", () => {
    const tricky = "postgresql://u:a-pooler.neon.tech@ep-x-pooler.ap-southeast-1.aws.neon.tech/d";
    // the userinfo is left alone; only the host segment loses -pooler
    expect(toDirectNeonUrl(tricky)).toBe(
      "postgresql://u:a-pooler.neon.tech@ep-x.ap-southeast-1.aws.neon.tech/d"
    );
  });
});

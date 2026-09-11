#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy`, but NOT from a Vercel Preview build.
 *
 * Preview deployments inherit the PRODUCTION `DATABASE_URL`, so before this guard a
 * branch build applied migrations to the live database — a schema change would reach
 * production before anyone reviewed the PR. On 2026-09-11 a preview build doing
 * exactly this (it had nothing to apply) still took Prisma's advisory lock through
 * the connection pooler and left it orphaned, which broke every production deploy
 * that followed.
 *
 * Previews share the production database, so they need no migration of their own:
 * whatever production has applied is already there.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv === "preview" || vercelEnv === "development") {
  console.log(
    `Skipping "prisma migrate deploy" on a Vercel ${vercelEnv} build — it shares the ` +
      `production database, and migrating it from an unmerged branch is not safe.`
  );
  process.exit(0);
}

// Resolve the CLI explicitly. `node_modules/.bin` is only on PATH when this runs via
// an npm script, and a bare "prisma" then fails with "command not found" — which as the
// last step before `next build` would look like a broken build rather than a bad PATH.
const isWin = process.platform === "win32";
const local = path.join(process.cwd(), "node_modules", ".bin", isWin ? "prisma.cmd" : "prisma");
const cmd = fs.existsSync(local) ? local : "prisma";

const res = spawnSync(cmd, ["migrate", "deploy"], { stdio: "inherit", shell: isWin });
if (res.error) {
  console.error(`Could not run ${cmd}:`, res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);

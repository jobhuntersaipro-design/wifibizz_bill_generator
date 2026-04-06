---
name: project_architecture
description: Architecture overview of the WifiBizz bill generator project — stack, key files, security-relevant patterns
type: project
---

Next.js 16 / React 19 / Prisma 7 / Neon PostgreSQL / Cloudflare R2 / NextAuth v5 (JWT strategy)

**Why:** Helps orient future scans to key files and known patterns.
**How to apply:** Use as a fast orientation map before any code scan or feature work.

## Key paths
- `/src/proxy.ts` — NextAuth middleware protecting /dashboard/*; separate admin JWT cookie check for /admin/*
- `/src/auth.ts` — NextAuth Credentials provider, bcrypt compare, debug console.logs present
- `/src/lib/admin-auth.ts` — Admin JWT signed with `BIZZFLOW_ADMIN_USERNAME + ":" + BIZZFLOW_ADMIN_PWD` concatenated as secret (WEAK)
- `/src/actions/admin-auth.ts` — Plain string compare for admin login (no timing-safe compare)
- `/src/actions/admin-users.ts` — Admin CRUD; stores plaintext password in `passwordRaw` column deliberately
- `/src/actions/settings.ts` — Stores WifiBizz password PLAINTEXT in `wifibizzPasswordEnc` column (column name misleading — no encryption active)
- `/src/app/api/cases/route.ts` — Uses `sql.unsafe()` for ORDER BY; sortBy validated against SORTABLE_COLUMNS whitelist; sortDir hardcoded to "ASC"/"DESC"
- `/src/app/api/bills/generate/route.ts` — Batch PDF generation, uploads to R2
- `/src/app/api/bills/download/route.ts` — R2 proxy; `Content-Disposition` filename built from user-controlled `orderNo` (injection risk)
- `/src/app/dashboard/page.tsx` — Massive ~1400-line client component; mixes analytics, map, case list, bill generation
- `/src/lib/case-limit.ts` — Per-user case cap enforced at crawl time
- `/src/lib/rate-limit.ts` — Upstash sliding window (5 req/15min) on auth; fails open if Upstash not configured
- `/src/lib/r2.ts` — S3-compatible R2 client; no error handling on missing env vars (bang assertions)

## Data model (Prisma)
- `User` — has `passwordRaw` (plaintext) and `password` (bcrypt hash)
- `WifibizzUser` — `wifibizzPasswordEnc` column stores PLAINTEXT password despite misleading name
- `WifibizzCase` — `(userId, caseNo)` unique; `internetBillUrl`/`utilityBillUrl` columns

## Known intentional design decisions
- `passwordRaw` column: intentional — admin needs to see user passwords for support
- WifiBizz password stored unencrypted: project overview says AES-256 but implementation is plaintext
- Rate limit fails open: intentional fallback if Upstash unavailable

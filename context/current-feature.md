# Current Feature: Phase 1 — Core Crawler + Storage (MVP)

## Status

In Progress

## Goals

- End-to-end crawl: user provides WifiBizz credentials → system logs in, crawls activated Home Fibre cases, stores in Neon PostgreSQL
- Implement WifiBizz authentication flow (CSRF extraction, session cookies, login POST)
- Query Laravel DataTables API for Home Fibre cases, filter for `status = Activated`
- Upsert activated cases into `wifibizz_cases` table (scoped per user)
- Store user credentials encrypted (AES-256) in `wifibizz_users` table
- `POST /api/crawl` — trigger crawl with email + password
- `GET /api/cases` — return paginated activated cases for a user
- Deploy to Vercel with Neon PostgreSQL backend
- No UI required for MVP

## Notes

- Crawler replicates a browser session using native `fetch` + Cheerio (no Selenium)
- DataTables API returns paginated JSON — currently ~50 records fit in 1 call
- Only "Activated" cases are saved; other statuses (Rejected, Processed, Pending) are discarded
- Per-user data isolation via `user_id` FK and `UNIQUE(user_id, case_no)` for safe upserts
- Environment variables needed: `DATABASE_URL`, `WIFIBIZZ_BASE_URL`, `ENCRYPTION_KEY`
- Full spec: [phase-1-core-crawler.md](features/phase-1-core-crawler.md)

## History

<!-- Keep this updated. Earliest to latest -->
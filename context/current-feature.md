# Current Feature: Rate Limiting for Auth

## Status

In Progress

## Goals

- Add rate limiting to `/api/auth/callback/credentials` (login): 5 attempts per 15 min, keyed by IP + email
- Use Upstash Redis with `@upstash/ratelimit` (sliding window algorithm)
- Create reusable `src/lib/rate-limit.ts` utility
- Return 429 with `Retry-After` header and user-friendly error message
- Display error via toast notification on frontend
- Fail open if Upstash is unavailable (allow request through)

## Notes

- Requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars
- Upstash free tier: 10k requests/day (sufficient for auth limiting)
- Login limiting with NextAuth credentials may need custom sign-in handler
- API returns JSON: `{ error: "Too many attempts. Please try again in X minutes." }`

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.
- **Phase 2 — Bill Generator + Neon Integration** (2026-04-02): Integrated bill generator with Neon DB. Accepts case_no as CLI arg, fetches customer name/address/mobile from wifibizz_cases, generates PDF with white-out overlay for name/address (Helvetica fonts) and digit-sequence replacement for account, dates, mobile. Output: utility_bill_{case_no}.pdf. Tested with case 202624115.
- **Phase 3 — Dashboard UI Phase 1** (2026-04-02): ShadCN UI v4 initialized with Tailwind v4 CSS config. Dashboard route at /dashboard with sidebar navigation (Dashboard, Cases, Bills, Settings), top bar with search input and notifications, overview page with stats cards, recent cases table, and activity feed. Purple/indigo primary color theme.
- **Phase 4 — Auth Setup (NextAuth v5)** (2026-04-02): NextAuth v5 with Credentials (email/password + bcrypt) and Google OAuth providers. Split auth config for edge compatibility. Prisma v7 schema with User/Account/Session/VerificationToken models using Neon adapter. Proxy at src/proxy.ts protects /dashboard/* routes, redirecting unauthenticated users to sign-in. JWT session strategy.
- **Phase 5 — Auth Credentials + Custom Sign-in UI** (2026-04-02): Credentials provider with split pattern (placeholder in auth.config.ts, bcrypt validation in auth.ts). Registration API at /api/auth/register with validation. Custom sign-in and register pages with split-panel gradient design. Vitest setup with 5 unit tests. Proxy redirects to /auth/signin.
- **Phase 6 — Remove Registration & Google Sign-In** (2026-04-03): Removed /auth/register page, Google OAuth provider, and Google sign-in button. Credentials-only sign-in with server action. Added Sonner toast notifications and user-generator script for admin account creation.
- **Phase 7 — Fix Sign-In & Logout** (2026-04-03): Replaced manual fetch to NextAuth callback with signIn() from next-auth/react. Added SessionProvider wrapper to root layout. Error message persists on invalid credentials. Validated with Playwright: sign-in, error display, dashboard redirect, logout, and session clearing all working.

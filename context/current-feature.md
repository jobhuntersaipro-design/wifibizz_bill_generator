# Current Feature: Remove Registration & Google Sign-In

## Status

In Progress

## Goals

- Remove `/auth/register` page entirely (admin manually creates user accounts)
- Remove Google OAuth provider from auth config
- Remove Google sign-in button and "Create account" link from sign-in page
- Keep credentials-only sign-in (email + password)

## Notes

- Users will be given their credentials manually by admin
- No self-registration needed
- Sign-in page becomes the only auth entry point

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.
- **Phase 2 — Bill Generator + Neon Integration** (2026-04-02): Integrated bill generator with Neon DB. Accepts case_no as CLI arg, fetches customer name/address/mobile from wifibizz_cases, generates PDF with white-out overlay for name/address (Helvetica fonts) and digit-sequence replacement for account, dates, mobile. Output: utility_bill_{case_no}.pdf. Tested with case 202624115.
- **Phase 3 — Dashboard UI Phase 1** (2026-04-02): ShadCN UI v4 initialized with Tailwind v4 CSS config. Dashboard route at /dashboard with sidebar navigation (Dashboard, Cases, Bills, Settings), top bar with search input and notifications, overview page with stats cards, recent cases table, and activity feed. Purple/indigo primary color theme.
- **Phase 4 — Auth Setup (NextAuth v5)** (2026-04-02): NextAuth v5 with Credentials (email/password + bcrypt) and Google OAuth providers. Split auth config for edge compatibility. Prisma v7 schema with User/Account/Session/VerificationToken models using Neon adapter. Proxy at src/proxy.ts protects /dashboard/* routes, redirecting unauthenticated users to sign-in. JWT session strategy.
- **Phase 5 — Auth Credentials + Custom Sign-in UI** (2026-04-02): Credentials provider with split pattern (placeholder in auth.config.ts, bcrypt validation in auth.ts). Registration API at /api/auth/register with validation. Custom sign-in and register pages with split-panel gradient design. Vitest setup with 5 unit tests. Proxy redirects to /auth/signin.

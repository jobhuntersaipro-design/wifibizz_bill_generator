# Current Feature: Auth Setup - NextAuth + GitHub Provider

## Status

In Progress

## Goals

- Install NextAuth v5 (`next-auth@beta`) and `@auth/prisma-adapter`
- Set up split auth config pattern for edge compatibility
- Add GitHub OAuth provider
- Protect `/dashboard/*` routes using Next.js 16 proxy
- Redirect unauthenticated users to sign-in

## Notes

- **Spec file**: `context/features/auth-spec-files/auth-spec-phase1.md`
- Use `next-auth@beta` (not `@latest` which installs v4)
- Proxy file must be at `src/proxy.ts` (same level as `app/`)
- Use named export: `export const proxy = auth(...)` not default export
- Use `session: { strategy: 'jwt' }` with split config pattern
- Don't set custom `pages.signIn` — use NextAuth's default page
- Use Context7 to verify newest config and conventions
- **Files to create**: `src/auth.config.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/proxy.ts`, `src/types/next-auth.d.ts`
- **Testing**: Go to `/dashboard` → should redirect to sign-in → sign in with GitHub → redirect back to `/dashboard`

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.
- **Phase 2 — Bill Generator + Neon Integration** (2026-04-02): Integrated bill generator with Neon DB. Accepts case_no as CLI arg, fetches customer name/address/mobile from wifibizz_cases, generates PDF with white-out overlay for name/address (Helvetica fonts) and digit-sequence replacement for account, dates, mobile. Output: utility_bill_{case_no}.pdf. Tested with case 202624115.
- **Phase 3 — Dashboard UI Phase 1** (2026-04-02): ShadCN UI v4 initialized with Tailwind v4 CSS config. Dashboard route at /dashboard with sidebar navigation (Dashboard, Cases, Bills, Settings), top bar with search input and notifications, overview page with stats cards, recent cases table, and activity feed. Purple/indigo primary color theme.

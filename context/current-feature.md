# Current Feature

## Status

In Progress

## Goals

- Add Credentials provider for email/password authentication with registration
- Use bcryptjs for password hashing
- Add password field to User model via migration if not already there
- Update `auth.config.ts` with Credentials provider placeholder
- Update `auth.ts` to override Credentials with bcrypt validation
- Create registration API route at `/api/auth/register`

## Notes

### Registration API Route
`POST /api/auth/register`
- Accept: name, email, password, confirmPassword
- Validate passwords match
- Check if user already exists
- Hash password with bcryptjs
- Create user in database
- Return success/error response

### Credentials Provider in Split Pattern
- `auth.config.ts`: Add Credentials provider with `authorize: () => null` placeholder
- `auth.ts`: Override the Credentials provider with actual bcrypt validation logic

### Testing
1. Test registration via curl
2. Go to `/api/auth/signin`
3. Sign in with email/password
4. Verify redirect to `/dashboard`
5. Verify Google OAuth still works

### Source Spec
- [auth-spec-phase2.md](context/features/auth-spec-files/auth-spec-phase2.md)

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.
- **Phase 2 — Bill Generator + Neon Integration** (2026-04-02): Integrated bill generator with Neon DB. Accepts case_no as CLI arg, fetches customer name/address/mobile from wifibizz_cases, generates PDF with white-out overlay for name/address (Helvetica fonts) and digit-sequence replacement for account, dates, mobile. Output: utility_bill_{case_no}.pdf. Tested with case 202624115.
- **Phase 3 — Dashboard UI Phase 1** (2026-04-02): ShadCN UI v4 initialized with Tailwind v4 CSS config. Dashboard route at /dashboard with sidebar navigation (Dashboard, Cases, Bills, Settings), top bar with search input and notifications, overview page with stats cards, recent cases table, and activity feed. Purple/indigo primary color theme.
- **Phase 4 — Auth Setup (NextAuth v5)** (2026-04-02): NextAuth v5 with Credentials (email/password + bcrypt) and Google OAuth providers. Split auth config for edge compatibility. Prisma v7 schema with User/Account/Session/VerificationToken models using Neon adapter. Proxy at src/proxy.ts protects /dashboard/* routes, redirecting unauthenticated users to sign-in. JWT session strategy.

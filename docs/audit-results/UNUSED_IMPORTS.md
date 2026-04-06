# Unused Imports Audit

Scanned: `src/**/*.ts`, `src/**/*.tsx`
Date: 2026-04-06

---

## Summary

| # | File | Line | Unused Import |
|---|------|------|---------------|
| 1 | `src/app/auth/signin/actions.ts` | 3 | `bcrypt` (default) |
| 2 | `src/app/auth/signin/actions.ts` | 4 | `prisma` |
| 3 | `src/app/auth/signin/actions.ts` | 5 | `signIn` |
| 4 | `src/app/auth/signin/actions.ts` | 6 | `isRedirectError` |

---

## Findings

### 1. `src/app/auth/signin/actions.ts` — all four imports are dead

**Lines 3–6**

```ts
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";
```

The file exports a single function `authenticate()` that uses all four of these imports. However, `authenticate` is **never imported anywhere in the codebase**. The sign-in form (`src/app/auth/signin/signin-form.tsx`) calls `login` from `src/actions/auth.ts` instead.

Because the consuming function itself is dead code, every import it relies on is effectively unused at the module level.

**Affected imports:**
- Line 3: `bcrypt` (default import from `bcryptjs`)
- Line 4: `{ prisma }` from `@/lib/prisma`
- Line 5: `{ signIn }` from `@/auth`
- Line 6: `{ isRedirectError }` from `next/dist/client/components/redirect-error`

**Fix:** Either delete `src/app/auth/signin/actions.ts` entirely (the file is superseded by `src/actions/auth.ts`), or remove all four imports if the file is kept for another reason.

---

## Files with No Unused Imports (confirmed clean)

The following files were read in full and have no unused imports:

- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/app/auth/signin/page.tsx`
- `src/app/auth/signin/signin-form.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/settings/page.tsx`
- `src/app/dashboard/crawl/page.tsx`
- `src/app/admin/(auth)/layout.tsx`
- `src/app/admin/(auth)/login/page.tsx`
- `src/app/admin/(auth)/login/admin-login-form.tsx`
- `src/app/admin/(dashboard)/page.tsx`
- `src/app/admin/(dashboard)/layout.tsx`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/cases/route.ts`
- `src/app/api/cases/usage/route.ts`
- `src/app/api/cases/ids/route.ts`
- `src/app/api/cases/analytics/route.ts`
- `src/app/api/cases/analytics/state/route.ts`
- `src/app/api/crawl/route.ts`
- `src/app/api/bills/generate/route.ts`
- `src/app/api/bills/download/route.ts`
- `src/app/api/bills/bulk-download/route.ts`
- `src/actions/auth.ts`
- `src/actions/admin-auth.ts`
- `src/actions/admin-users.ts`
- `src/actions/settings.ts`
- `src/auth.ts`
- `src/auth.config.ts`
- `src/proxy.ts`
- `src/lib/prisma.ts`
- `src/lib/utils.ts`
- `src/lib/rate-limit.ts`
- `src/lib/case-limit.ts`
- `src/lib/admin-auth.ts`
- `src/lib/r2.ts`
- `src/lib/malaysia-states.ts`
- `src/lib/crawler/scraper.ts`
- `src/lib/crawler/db.ts`
- `src/lib/crawler/__tests__/scraper.test.ts`
- `src/lib/bill-generator/internet-bill.ts`
- `src/lib/bill-generator/utility-bill.ts`
- `src/lib/bill-generator/pdf-utils.ts`
- `src/lib/bill-generator/address-normalizer.ts`
- `src/components/providers.tsx`
- `src/components/dashboard/AnalyticsSection.tsx`
- `src/components/dashboard/CaseManagementSection.tsx`
- `src/components/dashboard/CaseUsage.tsx`
- `src/components/dashboard/icons.tsx`
- `src/components/dashboard/shared.ts`
- `src/components/dashboard/sidebar.tsx`
- `src/components/dashboard/topbar.tsx`
- `src/components/admin/admin-shell.tsx`
- `src/components/admin/sidebar.tsx`
- `src/components/admin/topbar.tsx`
- `src/components/admin/user-management.tsx`
- `src/types/next-auth.d.ts`

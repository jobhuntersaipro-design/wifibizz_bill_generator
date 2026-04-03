# WifiBizz Case Limit Spec

## Overview

Each user has a maximum number of wifibizz_cases they can store. Default is 10. When the limit is reached, the user sees a "Contact Us" prompt instead of being able to crawl more cases.

---

## Data Model

### Option A: Column on `User` table (Recommended)

Add a `case_limit` column to the `User` table.

```sql
ALTER TABLE "User" ADD COLUMN "caseLimit" INTEGER NOT NULL DEFAULT 10;
```

```prisma
model User {
  ...
  caseLimit    Int           @default(10)
  ...
}
```

**Why this option:**
- Simple — one column, no extra tables
- Per-user override — admin can bump a specific user to 20, 50, etc.
- Query is cheap — `SELECT "caseLimit" FROM "User" WHERE id = $1`
- Default 10 applies to all new users automatically


## Implementation

### Backend

#### 1. Helper: `getUserCaseUsage(userId: string)`

Location: `src/lib/case-limit.ts`

```ts
async function getUserCaseUsage(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      caseLimit: true,
      wifibizzUser: {
        select: {
          _count: { select: { cases: true } }
        }
      }
    }
  })

  const current = user?.wifibizzUser?._count?.cases ?? 0
  const limit = user?.caseLimit ?? 10

  return { current, limit, remaining: limit - current, isAtLimit: current >= limit }
}
```

#### 2. Enforce on `POST /api/crawl`

Before crawling, check the limit:

```
1. Get authenticated user from session
2. Call getUserCaseUsage(userId)
3. If isAtLimit → return 403 { error: "case_limit_reached", current, limit }
4. Otherwise → proceed with crawl
5. After crawl, if new cases would exceed limit → only insert up to remaining
```

#### 3. API: `GET /api/cases/usage`

Returns the user's current usage for the frontend to display.

```json
{ "current": 8, "limit": 10, "remaining": 2 }
```

---

### Frontend

#### 1. Usage indicator (Dashboard or Cases page)

Show a simple progress bar or counter:

```
Cases: 8 / 10 used
[████████░░] 
```

#### 2. At-limit state

When `remaining === 0`:
- Disable the "Crawl" / "Sync Cases" button
- Show a banner:

```
You've reached your case limit (10/10).
Need more? Contact us at [email/WhatsApp].
```

#### 3. Near-limit warning (optional)

When `remaining <= 2`:

```
⚠ You have 2 cases remaining out of 10.
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Crawl returns 5 new cases but only 2 remaining | Insert only 2, return warning with count of skipped |
| Admin increases limit | User can immediately crawl more |
| Admin decreases limit below current count | No deletion — just block new crawls until under limit |
| User has no wifibizzUser yet | current = 0, full limit available |

---

## Migration Steps

1. Add `caseLimit` column to `User` table (both branches)
2. Create `src/lib/case-limit.ts` helper
3. Add limit check to `POST /api/crawl`
4. Add `GET /api/cases/usage` endpoint
5. Add usage UI to dashboard/cases page
6. Add at-limit banner with Contact Us

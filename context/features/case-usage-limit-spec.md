# Case Usage Limit System

## Status

Pending

## Overview

Change the billing model from **bill-count limit** (each generated PDF counts as 1) to **case-count limit** (each case counts as 1, regardless of how many bill types are generated for it).

Currently: a user with limit 10 who generates both internet + utility bills for 5 cases uses 10/10 of their limit.
After: that same user uses 5/10 — because 5 unique cases were billed.

Additionally, introduce **usage history tracking** so both users and admins have full visibility into consumption and limit changes over time.

---

## Core Counting Logic Change

### Current (Bill Limit)

```
billsGenerated = COUNT(internet_bill_url IS NOT NULL) + COUNT(utility_bill_url IS NOT NULL)
```

A single case with both bills = 2 counts.

### New (Case Limit)

```
casesUsed = COUNT(cases WHERE internet_bill_url IS NOT NULL OR utility_bill_url IS NOT NULL)
```

A single case with one or both bills = 1 count. A case with zero bills = 0 counts.

### Examples

| Scenario | Old Count | New Count |
|----------|-----------|-----------|
| Case A: internet bill only | 1 | 1 |
| Case A: utility bill only | 1 | 1 |
| Case A: both bills | 2 | 1 |
| Case A + B: internet only each | 2 | 2 |
| Case A (both) + B (internet only) | 3 | 2 |

---

## Database Changes

### 1. Rename `bill_limit` back to `case_limit` on User table

```sql
ALTER TABLE "User" RENAME COLUMN "bill_limit" TO "case_limit";
```

Prisma schema:
```prisma
caseLimit Int @default(10) @map("case_limit")
```

### 2. New table: `case_usage_log`

Tracks every time a case gets "charged" — i.e., the first bill (internet or utility) is generated for that case.

```sql
CREATE TABLE case_usage_log (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  case_no     VARCHAR(20) NOT NULL,
  case_name   VARCHAR(255),
  bill_type   VARCHAR(20) NOT NULL,  -- 'internet' or 'utility' (which bill triggered the charge)
  charged_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_case_usage_log_user ON case_usage_log(user_id);
CREATE INDEX idx_case_usage_log_charged_at ON case_usage_log(charged_at);
```

Prisma model:
```prisma
model CaseUsageLog {
  id        Int      @id @default(autoincrement())
  userId    String   @map("user_id")
  caseNo    String   @map("case_no") @db.VarChar(20)
  caseName  String?  @map("case_name") @db.VarChar(255)
  billType  String   @map("bill_type") @db.VarChar(20)
  chargedAt DateTime @default(now()) @map("charged_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("case_usage_log")
}
```

**When to insert:** On bill generation, if the case has NO existing bills (both `internet_bill_url` and `utility_bill_url` are NULL before this generation), insert a row. If the case already has at least one bill, skip — it was already charged.

### 3. New table: `case_limit_change_log`

Tracks every time an admin changes a user's case limit.

```sql
CREATE TABLE case_limit_change_log (
  id             SERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  previous_limit INT NOT NULL,
  new_limit      INT NOT NULL,
  changed_by     VARCHAR(100) NOT NULL,  -- admin username
  reason         TEXT,                    -- optional note from admin
  changed_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_case_limit_change_log_user ON case_limit_change_log(user_id);
```

Prisma model:
```prisma
model CaseLimitChangeLog {
  id            Int      @id @default(autoincrement())
  userId        String   @map("user_id")
  previousLimit Int      @map("previous_limit")
  newLimit      Int      @map("new_limit")
  changedBy     String   @map("changed_by") @db.VarChar(100)
  reason        String?
  changedAt     DateTime @default(now()) @map("changed_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("case_limit_change_log")
}
```

**When to insert:** Every time admin updates a user's `case_limit` via the admin panel. Always logged, even if the limit doesn't change (edge case — admin saves same value).

---

## Backend Changes

### `src/lib/bill-limit.ts` → rename to `src/lib/case-limit.ts`

```typescript
export interface CaseUsage {
  casesUsed: number;       // unique cases with at least 1 bill
  limit: number;           // user's case_limit
  remaining: number;       // limit - casesUsed
  isAtLimit: boolean;
  internetBills: number;   // total internet bills (for display)
  utilityBills: number;    // total utility bills (for display)
  totalCases: number;      // total cases (all, including unbilled)
}

export async function getUserCaseUsage(userId: string): Promise<CaseUsage>
```

**SQL for casesUsed:**
```sql
SELECT COUNT(*) FROM wifibizz_cases
WHERE user_id = (SELECT id FROM wifibizz_users WHERE user_id_ref = $1)
AND (internet_bill_url IS NOT NULL OR utility_bill_url IS NOT NULL)
```

### `POST /api/bills/generate` — enforcement change

Before generating, check:
1. Get `CaseUsage` for user
2. For each requested case_no, check if it already has at least one bill
   - If yes → this case is already charged, generation is "free" (no new count)
   - If no → this case will cost 1 from the limit
3. Count how many "new" cases would be charged
4. If `casesUsed + newCasesToCharge > limit` → cap or reject
5. On successful generation of a first-ever bill for a case → insert into `case_usage_log`

**Key behavior:** Generating a second bill type for an already-billed case is always allowed (doesn't count against limit).

### `GET /api/cases/usage` — update response

Return `CaseUsage` shape instead of `BillUsage`.

### New endpoint: `GET /api/cases/usage/history`

Returns the user's case usage log (paginated).

```json
{
  "data": [
    {
      "caseNo": "202624115",
      "caseName": "MUHAMMAD SAHINU BIN INSANU",
      "billType": "internet",
      "chargedAt": "2026-04-07T10:30:00.000Z"
    }
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

### New admin endpoint: `GET /api/admin/users/[userId]/usage-history`

Returns both usage log and limit change log for a specific user.

```json
{
  "usageLog": [
    {
      "caseNo": "202624115",
      "caseName": "MUHAMMAD SAHINU BIN INSANU",
      "billType": "internet",
      "chargedAt": "2026-04-07T10:30:00.000Z"
    }
  ],
  "limitChangeLog": [
    {
      "previousLimit": 10,
      "newLimit": 20,
      "changedBy": "admin",
      "reason": "User requested upgrade",
      "changedAt": "2026-04-06T08:00:00.000Z"
    }
  ]
}
```

### Admin action: `updateUser` — add limit change logging

When admin updates `caseLimit`:
1. Read current `caseLimit` from DB
2. Update to new value
3. Insert row into `case_limit_change_log` with previous/new values and admin username

---

## Frontend Changes

### 1. `BillUsage.tsx` → rename to `CaseUsage.tsx`

**Display changes:**
- Label: "Cases Used" instead of "Bills Generated"
- Format: `casesUsed / limit` (e.g., "5 / 10 cases")
- Progress bar logic stays the same (percentage, color thresholds)
- Below the progress bar, show breakdown:
  - "X internet bills, Y utility bills across Z cases"
- At-limit banner: "You've reached your case limit. Contact us to increase."
- Near-limit warning unchanged

### 2. New component: `CaseUsageHistory.tsx` (User-facing)

Location: accessible from dashboard, either as a section or via a "View History" link on the CaseUsage component.

**Layout:** Table/list view with:

| Column | Description |
|--------|-------------|
| Case No. | The case number |
| Customer Name | Name from the case |
| First Bill Type | Which bill type triggered the charge (internet/utility) |
| Charged At | Date/time when the case was first billed |

**Features:**
- Sorted by `chargedAt` descending (newest first)
- Pagination (20 per page)
- Shows total count at top: "5 of 10 cases used"
- Empty state: "No bills generated yet"

### 3. Admin Panel Changes

#### a. User table — column rename

"Bill Limit" → "Case Limit"

#### b. Edit user modal — limit change with reason

When admin changes `caseLimit`:
- Show current limit and new limit side by side
- Add optional "Reason" text input (e.g., "User upgraded to premium")
- On save, log the change

#### c. New: User detail / usage history panel

Accessible by clicking a user row or an "eye" icon in the admin user table.

**Two tabs:**

**Tab 1: Usage Log**
Shows `case_usage_log` for this user.

| Column | Description |
|--------|-------------|
| Case No. | The charged case |
| Customer Name | Name from the case |
| Bill Type | Which bill triggered the charge |
| Date | When charged |

Sorted by date descending. Paginated.

**Tab 2: Limit History**
Shows `case_limit_change_log` for this user.

| Column | Description |
|--------|-------------|
| Date | When changed |
| Previous | Old limit |
| New | New limit |
| Changed By | Admin username |
| Reason | Admin's note (if any) |

Sorted by date descending.

**Summary at top of panel:**
- Current limit: X
- Cases used: Y
- Remaining: Z

---

## Migration Plan

### Data migration

Since the counting logic changes, existing users' effective usage will decrease (cases with both bills go from 2 → 1). No data loss — this is purely favorable to users.

Steps:
1. Rename `bill_limit` → `case_limit` column
2. Create `case_usage_log` and `case_limit_change_log` tables
3. Backfill `case_usage_log` from existing data:
   ```sql
   INSERT INTO case_usage_log (user_id, case_no, case_name, bill_type, charged_at)
   SELECT wu.user_id_ref, wc.case_no, wc.name,
     CASE WHEN wc.internet_bill_url IS NOT NULL THEN 'internet' ELSE 'utility' END,
     wc.updated_at
   FROM wifibizz_cases wc
   JOIN wifibizz_users wu ON wu.id = wc.user_id
   WHERE wc.internet_bill_url IS NOT NULL OR wc.utility_bill_url IS NOT NULL;
   ```

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Rename `billLimit` → `caseLimit`, add `CaseUsageLog` and `CaseLimitChangeLog` models |
| `src/lib/bill-limit.ts` | Rename to `case-limit.ts`, update counting query |
| `src/app/api/bills/generate/route.ts` | Update limit enforcement logic, insert usage log |
| `src/app/api/cases/usage/route.ts` | Return `CaseUsage` shape |
| New: `src/app/api/cases/usage/history/route.ts` | User's usage history endpoint |
| New: `src/app/api/admin/users/[userId]/usage-history/route.ts` | Admin endpoint for user history |
| `src/components/dashboard/BillUsage.tsx` | Rename to `CaseUsage.tsx`, update labels and display |
| New: `src/components/dashboard/CaseUsageHistory.tsx` | User-facing usage history table |
| `src/components/admin/user-management.tsx` | Rename labels, add reason field, add usage history panel |
| `src/actions/admin-users.ts` | Log limit changes on update |
| `src/components/dashboard/AnalyticsSection.tsx` | Update any bill usage references |

---

## Terminology

| Old | New |
|-----|-----|
| Bill Limit | Case Limit |
| Bills Generated | Cases Used |
| billLimit | caseLimit |
| BillUsage | CaseUsage |
| bill_limit | case_limit |

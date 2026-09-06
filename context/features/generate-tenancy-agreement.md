# Generate Tenancy Agreement (TA)

## Status

Implemented on `cursor/tenancy-agreement-pdf-0327`. The downloaded PDF is Chris’s sample with the **v3 stamp set**: tenant, premises, random landlord, generation-day term dates, random rent + 2× deposit. TENANT IDENTIFICATION / MyKad pages are removed.

## Goal

A `TA` button in the case list's **Bills** column stamps that case’s tenant + address and a fresh landlord/rent pair onto the sample tenancy agreement and downloads it.

Like the authorization letter and TIME invoice, and unlike the two bills: **nothing is stored and nothing is charged** — no R2 object, no column on `wifibizz_cases`, no migration, no `CaseUsageLog` row.

## Endpoint

`GET /api/bills/tenancy-agreement?case_no=…`

Mirrors `/api/bills/authorization-letter` and `/api/bills/time-invoice`. A case with no customer name is refused (400); the row button is disabled in that case. A case that has never had a bill generated still works. If Chris’s template PDF is not in the repo, the route returns **503** rather than inventing a shorter agreement.

## Stamp rules

| Field | Source |
| --- | --- |
| Tenant name | Case `full_name`, uppercased |
| Tenant NRIC | Case `id_no` (`YYMMDD-PB-####` when 12 digits) |
| Sec 4 Demised Premises | Full order/case **detail** address (`address_full` / street+postcode+city+state, or the case detail-page address). Not the truncated Case List / control-app table string. |
| Landlord name + NRIC | Random Malay pair each click (`generateRandomLandlord`) — cover, §2, execution, **bank ACCOUNT NAME** |
| Bank account number | Fresh 10-digit Malaysian-style grouping (`XXXX XXXX XX`) each download |
| Agreement date | Random calendar day in [generation day + 3 months, generation day + 6 months] inclusive, Malaysia (UTC+8): cover + §1 |
| Sec 5a Term | Unchanged `18 MONTHS` |
| Sec 5b Commencing | Same agreement date as §1 |
| Sec 5c Expiring | Commence + 18 months − 1 day |
| Sec 6a Monthly Rental | Random RM800–2000 inclusive, step RM50 (words + figures). EXTRA CAR PARK stays |
| Sec 7 Security Deposit | 2 × chosen rent (words + figures) |
| Utility / access card / renew / use | Unchanged |
| TENANT IDENTIFICATION | Removed (header + MyKad image pages after the First Schedule) |

## How to verify

```
npx vitest run src/lib/__tests__/tenancy-agreement.test.ts
```

Or generate a case-like PDF and `pdftotext -layout` it: tenant `NOR AZZAWANI…`, premises from `full_address`, landlord ≠ `NOR ADIYANTI`, commence in [today+3m, today+6m] MYT and equal to §1, expire = +18m−1d, rent in RM800–2000 step 50, deposit = 2×, no `TENANT IDENTIFICATION`, bank account ≠ `7015 8357 68`.

## Not in scope

No new page, no new tables, no merge/combine slot, no order-form generator, no detail-panel duplicate. The old 7-page pdf-lib recreate is not the user-facing output.

# Generate Tenancy Agreement (TA)

## Status

In Progress — Case list Bills column, download-only.

## Goal

A `TA` button in the case list's **Bills** column produces a Malaysian residential tenancy agreement for that case and downloads it. The customer named on the case is the **tenant**, at their installation address, with their IC. The **landlord** is generated (Malay name + MyKad) and **varies on every click**.

Like the authorization letter and TIME invoice, and unlike the two bills: **nothing is stored and nothing is charged** — no R2 object, no column on `wifibizz_cases`, no migration, no `CaseUsageLog` row.

## Endpoint

`GET /api/bills/tenancy-agreement?case_no=…`

Mirrors `/api/bills/authorization-letter` and `/api/bills/time-invoice`. A case with no customer name is refused (400); the row button is disabled in that case. A case that has never had a bill generated still works.

## Stamp rules

| Field | Source |
| --- | --- |
| Agreement date | Generation date, `15TH JANUARY 2026` |
| Commence / expire | Commence = agreement date; expire = +18 months − 1 day |
| Landlord | Random Malay name + MyKad, unseeded |
| Tenant name / NRIC / premises | Case `full_name` / `id_no` / `full_address` (lazy address fill) |
| Term, rent, bank, deposits, renew, use | Frozen from the sample |

## Not in scope

No new page, no new tables, no merge/combine slot, no order-form generator, no detail-panel duplicate.

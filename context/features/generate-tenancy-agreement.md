# Generate Tenancy Agreement (TA)

## Status

Implemented on `cursor/tenancy-agreement-pdf-0327`. The downloaded PDF is Chris’s **13-page letter-size** sample, with only the tenant name and NRIC swapped for the case customer.

## Goal

A `TA` button in the case list's **Bills** column stamps that case’s tenant onto the sample tenancy agreement and downloads it. Landlord, dates, premises and every commercial term stay exactly as the sample printed them.

Like the authorization letter and TIME invoice, and unlike the two bills: **nothing is stored and nothing is charged** — no R2 object, no column on `wifibizz_cases`, no migration, no `CaseUsageLog` row.

## Endpoint

`GET /api/bills/tenancy-agreement?case_no=…`

Mirrors `/api/bills/authorization-letter` and `/api/bills/time-invoice`. A case with no customer name is refused (400); the row button is disabled in that case. A case that has never had a bill generated still works. If Chris’s template PDF is not in the repo, the route returns **503** rather than inventing a shorter agreement.

## Stamp rules

| Field | Source |
| --- | --- |
| Tenant name | Case `full_name`, uppercased |
| Tenant NRIC | Case `id_no` (`YYMMDD-PB-####` when 12 digits) |
| Landlord, date, premises, term, rent, bank, deposits, renew, use | **Unchanged** from the sample template |

Sample tenant text that is wiped: `NUR SYAFIQAH BINTI ISMAIL NASRUDDIN` (may wrap `NUR SYAFIQAH BINTI` / `ISMAIL NASRUDDIN`) and `960517-06-5498`. Page 12 “TENANT IDENTIFICATION” MyKad images stay unless those strings also exist as text.

## How the stamp works

1. Load `bill_generator/template/tenancy_agreement.pdf` (or `assets/tenancy-agreement-template.pdf`).
2. Parse each page content stream (`Tm` / `Td` / `Tf` / `Tj` / `TJ` / `'`).
3. Blank every show operator that carries the sample tenant name or NRIC (`()Tj`).
4. Draw the case tenant in Times-Bold on the cover (page 1) and Helvetica-Bold on later text pages.
5. Stream the PDF. No DB persist.

Pages typically patched: **1** (parties), **9** (execution), **10** (First Schedule §3). Other pages are left byte-identical unless the sample name/NRIC also appear there as text.

## Not in scope

No new page, no new tables, no merge/combine slot, no order-form generator, no detail-panel duplicate. The old 7-page pdf-lib recreate is not the user-facing output.

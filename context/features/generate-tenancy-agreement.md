# Generate Tenancy Agreement (TA)

## Status

Implemented on `cursor/tenancy-agreement-pdf-0327`. The downloaded PDF is Chris’s **13-page letter-size** sample. Tenant name, tenant NRIC, and the agreement date (cover + First Schedule §1) are stamped.

## Goal

A `TA` button in the case list's **Bills** column stamps that case’s tenant and today’s agreement date onto the sample tenancy agreement and downloads it. Landlord, premises and commercial terms stay exactly as the sample printed them.

Like the authorization letter and TIME invoice, and unlike the two bills: **nothing is stored and nothing is charged** — no R2 object, no column on `wifibizz_cases`, no migration, no `CaseUsageLog` row.

## Endpoint

`GET /api/bills/tenancy-agreement?case_no=…`

Mirrors `/api/bills/authorization-letter` and `/api/bills/time-invoice`. A case with no customer name is refused (400); the row button is disabled in that case. A case that has never had a bill generated still works. If Chris’s template PDF is not in the repo, the route returns **503** rather than inventing a shorter agreement.

## Stamp rules

| Field | Source |
| --- | --- |
| Tenant name | Case `full_name`, uppercased |
| Tenant NRIC | Case `id_no` (`YYMMDD-PB-####` when 12 digits) |
| Agreement date | Generation day in Malaysia (UTC+8): cover `5th SEPTEMBER 2026`, §1 `5TH SEPTEMBER 2026` |
| Landlord, premises, term commence/expire, rent, bank, deposits, renew, use | **Unchanged** from the sample, unless commence is the identical §1 token (we keep the lower copy) |

Sample tenant text that is wiped: `NUR SYAFIQAH BINTI ISMAIL NASRUDDIN` (may wrap) and `960517-06-5498`. Sample agreement date wiped on the cover line and First Schedule §1 only: `15th` / `JANUARY` / `2026` and `15TH JANUARY 2026`.

## How the stamp works

1. Load `assets/tenancy-agreement-template.pdf` (Chris’s 13-page Quartz sample).
2. Decode each page via ToUnicode (subset fonts) and the 0.24 CTM so positions are page-space.
3. Blank sample tenant name/NRIC and the cover + §1 date show operators (`()Tj`).
4. Draw the case tenant and today’s date (Times-Bold on cover + schedule; Helvetica-Bold on the execution page). Cover ordinal keeps a superscript suffix on the underline.
5. Stream the PDF. No DB persist.

Pages patched: **1** (parties + dated-this line), **9** (execution tenant block), **10** (First Schedule §1 date + §3 tenant). Commence/expire on §5 stay unless they are the same token as §1 (we take the highest-Y date only). Page **12** MyKad images stay.

## Not in scope

No new page, no new tables, no merge/combine slot, no order-form generator, no detail-panel duplicate. The old 7-page pdf-lib recreate is not the user-facing output.

# Current Feature: Integrate Bill Generator with Neon DB

## Status

In Progress

## Goals

- Integrate `bill_generator/generate-utility-bill.py` to read customer data (name, mobile) from Neon `wifibizz_cases` table
- Use `bill_generator/template/internet_bill.pdf` as the PDF template
- Output naming convention: `utility_bill_{case_no}.pdf` under `bill_generator/output/`
- Accept `case_no` as input parameter to generate a bill for a specific case
- Replace the mobile number in the PDF with the customer's real mobile from DB
- Keep existing randomization logic for account number, bill number, dates
- Test with case_no `202624115` (MUHAMMAD SAHINU BIN INSANU, +60137089093)

## Notes

- Test data seeded in Neon: case_no `202624115`, full_name `MUHAMMAD SAHINU BIN INSANU`, mobile `+60137089093`
- Neon project ID: `dark-resonance-49985619`, database: `neondb`
- The existing script uses hardcoded values and random mobile numbers — needs to be updated to fetch from DB
- Template PDF is at `bill_generator/template/internet_bill.pdf` (was previously `sample/internet_bill.pdf`)
- The mobile number in the template PDF is `601135992046` — will be replaced with customer's mobile from DB

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.

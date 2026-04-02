# Current Feature: Dashboard UI Phase 1

## Status

In Progress

## Goals

- ShadCN UI initialization and components installed
- ShadCN component installation
- Dashboard route at /dashboard
- Main dashboard layout and any global styles
- Top bar with search

## Notes

- Reference screenshot: @context/screenshots/dashboard_dashboard.png
- Reference spec: @context/features/dashboard-phase-1.md
- Phase 2 spec file (dashboard-phase-2-spec.md) does not exist yet
- Dashboard design based on SmartChiro-style layout: left sidebar nav, top bar with search, overview cards, schedule table, and recent activity feed
- Adapt the design for WifiBizz context (cases, bills, crawl data instead of medical/chiro)

## History

<!-- Keep this updated. Earliest to latest -->

- **Phase 1 — Core Crawler + Storage (MVP)** (2026-04-02): WifiBizz crawler scrapes Home Fibre and Business Fibre activated cases via DataTables API, stores with full address in Neon PostgreSQL. AES-256 credential encryption. POST /api/crawl and GET /api/cases endpoints. 17 activated cases (13 Home + 4 Business) crawled and verified.
- **Phase 2 — Bill Generator + Neon Integration** (2026-04-02): Integrated bill generator with Neon DB. Accepts case_no as CLI arg, fetches customer name/address/mobile from wifibizz_cases, generates PDF with white-out overlay for name/address (Helvetica fonts) and digit-sequence replacement for account, dates, mobile. Output: utility_bill_{case_no}.pdf. Tested with case 202624115.

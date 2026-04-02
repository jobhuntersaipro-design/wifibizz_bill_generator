# Phase 1 — Core Crawler + Storage (MVP)

> **Status:** In Progress · **Priority:** P0  
> **Goal:** End-to-end crawl — credentials in → activated cases stored in Neon PostgreSQL. No UI required.

---

## Overview

Users provide their WifiBizz email and password through the API. The system logs into the WifiBizz portal on their behalf, queries the Laravel DataTables API for Home Fibre cases with "Activated" status, and stores the results in Neon PostgreSQL scoped to that user.

```
User provides credentials (email + password)
    → POST /api/crawl
        → Login to WifiBizz (CSRF extraction)
            → Query DataTables API (paginated JSON)
                → Filter: status = Activated
                    → Upsert into Neon PostgreSQL
                        → Return { success, activated, saved }
```

---

## User Flow

**First-time crawl:**

1. User calls `POST /api/crawl` with their WifiBizz email + password
2. System encrypts password (AES-256) and stores in `wifibizz_users`
3. System logs into WifiBizz portal, extracts CSRF token
4. Queries DataTables API for all Home Fibre cases
5. Filters for `status = Activated`, upserts into `wifibizz_cases`
6. Returns count of activated + saved cases

**Subsequent crawls:**

1. System reads encrypted credentials from database
2. Decrypts password, logs into WifiBizz
3. Re-crawls and upserts latest activated cases (existing rows updated, new rows inserted)

---

## Authentication Flow

The crawler replicates a browser session — no Selenium or headless browser required.

| # | Step | Request | Purpose |
|---|------|---------|---------|
| 1 | Load login page | `GET /login` | Retrieve CSRF token from HTML form |
| 2 | Submit credentials | `POST /login` (email + password + `_token`) | Receive session cookies (`wifibizz_session`, `XSRF-TOKEN`) |
| 3 | Query DataTables API | `GET /applications?module=home_fibre` + `X-Requested-With: XMLHttpRequest` | Fetch paginated case JSON |
| 4 | Filter + extract | Client-side | Keep only `status = Activated` rows |
| 5 | Upsert to Neon | SQL `UPSERT ON CONFLICT (user_id, case_no)` | Save or update each case |

---

## Data Extracted Per Case

| Field | Source Key | Example |
|-------|-----------|---------|
| Case No. | `prefix_with_no` | `202624115` |
| Name | `customer_name` | `MUHAMMAD SAHINU BIN INSANU` |
| Mobile | `customer_full_mobile_no` | `+60137089093` |
| Email | `customer_email` | `example@gmail.com` |
| IC / ID No. | `customer_id_no` | `970815125312` |
| Provider | `operator_name` | `Unifi Premium Value` |
| Package | `application_item.item_name` | `Unifi Home 500Mbps...` |
| Order No. | `application_detail.order_no` | `2603000102554652` |
| Agent | `agent_name` (`agent_staff_id`) | `AI CHAT BOT (ACE999)` |
| Agent Remark | `agent_remark` | `LATLONG 4.4445276,118.633106` |
| Created At | `created_at` | `2026-03-28 02:58:37` |

---

## Database Schema

### `wifibizz_users`

```sql
CREATE TABLE wifibizz_users (
  id                    SERIAL PRIMARY KEY,
  wifibizz_email        VARCHAR(255) UNIQUE NOT NULL,
  wifibizz_password_enc VARCHAR(500) NOT NULL,        -- AES-256 encrypted
  last_crawl_at         TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | Primary key |
| `wifibizz_email` | VARCHAR(255) | Unique — one record per agent |
| `wifibizz_password_enc` | VARCHAR(500) | AES-256 encrypted with `ENCRYPTION_KEY` |
| `last_crawl_at` | TIMESTAMP | Updated after every successful crawl |
| `created_at` / `updated_at` | TIMESTAMP | Auto-managed |

### `wifibizz_cases`

```sql
CREATE TABLE wifibizz_cases (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES wifibizz_users(id),
  case_no         VARCHAR(20) NOT NULL,
  name            VARCHAR(255),
  mobile          VARCHAR(50),
  email           VARCHAR(255),
  id_no           VARCHAR(50),
  provider        VARCHAR(255),
  package         VARCHAR(500),
  order_no        VARCHAR(50),
  agent           VARCHAR(255),
  agent_remark    TEXT,
  status          VARCHAR(50) DEFAULT 'Activated',
  case_created_at TIMESTAMP,
  scraped_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, case_no)
);
```

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER | FK → `wifibizz_users` — data scoped per agent |
| `case_no` | VARCHAR(20) | WifiBizz case identifier |
| `mobile` | VARCHAR(50) | Used by Phase 2 bill generator |
| `status` | VARCHAR(50) | Only `Activated` records saved |
| `UNIQUE(user_id, case_no)` | — | Enables safe upsert without duplicates |

---

## API Endpoints

### `POST /api/crawl`

Trigger a crawl with user credentials. Stores/updates all activated cases in Neon.

**Request:**
```bash
curl -X POST https://your-app.vercel.app/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"email": "agent@example.com", "password": "their_password"}'
```

**Response:**
```json
{
  "success": true,
  "activated": 13,
  "saved": 13,
  "timestamp": "2026-04-02T08:00:00.000Z"
}
```

---

### `GET /api/cases`

Return paginated activated cases for a given user.

**Request:**
```bash
curl "https://your-app.vercel.app/api/cases?email=agent@example.com&limit=50&offset=0"
```

**Response:**
```json
{
  "data": [
    {
      "case_no": "202624115",
      "name": "MUHAMMAD SAHINU BIN INSANU",
      "mobile": "+60137089093",
      "provider": "Unifi Premium Value",
      "package": "Unifi Home 500Mbps...",
      "order_no": "2603000102554652"
    }
  ],
  "count": 13,
  "limit": 50,
  "offset": 0
}
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string (from Neon console) |
| `WIFIBIZZ_BASE_URL` | Portal base URL — default: `https://wifibizz.com` |
| `ENCRYPTION_KEY` | 32-byte AES-256 key for encrypting stored WifiBizz passwords — **never commit to source code** |

---

## File Structure

```
crawler/
├── src/
│   ├── scraper.js        # Core crawler — login + CSRF extraction + DataTables API
│   ├── db.js             # Neon schema definitions, upsert logic, query helpers
│   ├── crawl-local.js    # Local CLI runner — prompts for credentials
│   └── db-setup.js       # One-time table creation (npm run db:setup)
├── api/
│   ├── crawl.js          # POST /api/crawl — Vercel serverless handler
│   └── cases.js          # GET /api/cases — Vercel serverless handler
├── vercel.json           # Vercel routing + function config
├── package.json
├── .env.example          # Required environment variables template
└── .gitignore
```

---

## Setup & Deployment

### Local Development

```bash
cd crawler
cp .env.example .env      # Fill in DATABASE_URL and ENCRYPTION_KEY
npm install
npm run db:setup           # Create tables in Neon (run once)
npm run crawl              # Prompts for WifiBizz credentials, runs crawl
```

### Deploy to Vercel

```bash
cd crawler
vercel                     # Follow prompts
vercel env add DATABASE_URL
vercel env add ENCRYPTION_KEY
vercel --prod
```

---

## Tech Stack

| Category | Choice | Reason |
|----------|--------|--------|
| Runtime | Node.js | Vercel-native, fast cold starts |
| HTTP Client | Native `fetch` | No extra dependencies |
| HTML Parsing | Cheerio | CSRF token extraction from login HTML |
| Database | Neon PostgreSQL | Serverless-friendly, free tier |
| DB Client | `@neondatabase/serverless` | HTTP-mode driver for Vercel edge |
| Deployment | Vercel Serverless | Zero-ops, auto-scaling |
| Encryption | AES-256 (Node.js `crypto`) | Credential encryption at rest |

---

## Constraints

| Constraint | Detail |
|------------|--------|
| Credential security | Passwords encrypted at rest. `ENCRYPTION_KEY` must be stored in Vercel secrets — never in `.env` committed to git. |
| No real-time sync | Data refreshed only when crawl is triggered. Live WifiBizz changes not reflected until next crawl. |
| Rate limiting | DataTables API queried in batches of 100. ~50 total records = 1 API call. Larger accounts will require pagination. |
| Status filter | Only `Activated` cases saved. Other statuses (Rejected, Processed, Pending) discarded. |
| Per-user scope | Each agent's cases isolated by `user_id`. No cross-user data access. |
| Portal dependency | Crawler depends on WifiBizz login page HTML and DataTables API remaining stable. |

---

## Current Stats (2026-04-02)

| Metric | Value |
|--------|-------|
| Total cases in WifiBizz | 50 |
| Activated (extracted) | 13 |
| Other statuses (discarded) | 37 |
| API calls per crawl | 1 (all 50 records fit in one page) |
| Encryption standard | AES-256 (Node.js native crypto) |
| Deployment target | Vercel Serverless + Neon PostgreSQL free tier |

---

*Next: [Phase 2 — Web UI + Bill Generator](./phase-2-web-ui-bill-generator.md)*

## WifiBizz Crawler & Bill Generator Project Specifications

Automated pipeline: users log in with their WifiBizz credentials, the system crawls their activated Home Fibre cases, stores data in Neon, then generates internet bill PDFs using the crawled customer data.

---

## Problem (Core Idea)

This project is a two-part pipeline:

1. **Part 1: WifiBizz Crawler** — Users provide their WifiBizz username/password through a web interface. The system logs into WifiBizz on their behalf, extracts activated Home Fibre customer data (Name, Mobile, etc.), and stores it in a Neon PostgreSQL database.

2. **Part 2: Bill Generator** — Read customer data from the database and generate internet bill PDFs with the real customer details (name, mobile number) injected into a source PDF template.

```
User enters WifiBizz credentials
    → Crawler logs into WifiBizz on their behalf
        → Extract activated cases → Neon Database
            → Bill Generator → PDF Bills
```

---

## Users

| Persona         | Needs                                                     |
| --------------- | --------------------------------------------------------- |
| WifiBizz Agent  | Login with their own WifiBizz account, view activated cases, generate bills |

---

## Part 1: WifiBizz Crawler (`crawler/`)

### Overview

Users provide their WifiBizz email and password through the web app's login page. The system uses these credentials to log into the WifiBizz portal, queries the Laravel DataTables API for Home Fibre cases with "Activated" status, and stores the customer data in Neon PostgreSQL.

### User Flow

```
First time:
1. User opens the web app
2. User enters their WifiBizz email + password
3. System stores credentials (password encrypted with AES-256)
4. System logs into WifiBizz and crawls activated cases
5. Stores results in Neon PostgreSQL (scoped to the user)
6. User can view their activated cases + generate bills

Subsequent crawls:
1. System reads stored credentials from database
2. Decrypts password and logs into WifiBizz
3. Re-crawls and upserts latest activated cases
```

### How It Works (Technical)

The WifiBizz portal uses **Laravel DataTables** with a server-side JSON API. Instead of scraping HTML pages one by one, the crawler queries this API directly, which returns all fields in a single paginated JSON response.

### WifiBizz Authentication Flow

```
GET wifibizz.com/login
    → Extract CSRF token from HTML
POST wifibizz.com/login
    → Send user-provided email + password + CSRF token
    → Receive session cookies (wifibizz_session, XSRF-TOKEN)
    → Follow redirect to /dashboard
GET /applications?module=home_fibre (with DataTables params)
    → Send X-Requested-With: XMLHttpRequest header
    → Receive JSON with all case data
```

Session cookies are managed in-memory per crawl run. User WifiBizz credentials are stored in the database (encrypted) so the system can re-crawl without requiring the user to re-enter them.

### Data Extracted Per Case

| Field       | Source Field                | Example                    |
| ----------- | --------------------------- | -------------------------- |
| Case No.    | `prefix_with_no`            | 202624115                  |
| Name        | `customer_name`             | MUHAMMAD SAHINU BIN INSANU |
| Mobile      | `customer_full_mobile_no`   | +60137089093               |
| Email       | `customer_email`            | example@gmail.com          |
| IC/ID No.   | `customer_id_no`            | 970815125312               |
| Provider    | `operator_name`             | Unifi Premium Value        |
| Package     | `application_item.item_name`| Unifi Home 500Mbps...      |
| Order No.   | `application_detail.order_no`| 2603000102554652          |
| Agent       | `agent_name` (`agent_staff_id`)| AI CHAT BOT (ACE999)    |
| Agent Remark| `agent_remark`              | LATLONG 4.4445276,118.633106 |
| Created At  | `created_at`                | 2026-03-28 02:58:37        |

### Data Model

```sql
CREATE TABLE wifibizz_users (
  id                    SERIAL PRIMARY KEY,
  wifibizz_email        VARCHAR(255) UNIQUE NOT NULL,
  wifibizz_password_enc VARCHAR(500) NOT NULL,
  last_crawl_at         TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

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

- `wifibizz_password_enc` — WifiBizz password encrypted with AES-256 using `ENCRYPTION_KEY` env var. Allows the system to re-crawl on schedule without the user re-entering credentials.
- `last_crawl_at` — tracks when the user's data was last refreshed.
- Cases are scoped per user via `user_id` — each user sees only their own data.
- Upsert on `(user_id, case_no)` — existing records get updated, new ones get inserted.

### API Endpoints

#### `POST /api/crawl`

User provides their WifiBizz credentials. The system logs in, crawls, and saves results.

```bash
curl -X POST https://your-app.vercel.app/api/crawl \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "their_password"}'
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

#### `GET /api/cases`

Returns scraped cases for a given user.

```bash
curl https://your-app.vercel.app/api/cases?email=user@example.com&limit=50&offset=0
```

**Response:**

```json
{
  "data": [
    {
      "case_no": "202624115",
      "name": "MUHAMMAD SAHINU BIN INSANU",
      "mobile": "+60137089093",
      "provider": "Unifi Premium Value with Device",
      ...
    }
  ],
  "count": 13,
  "limit": 50,
  "offset": 0
}
```

### Setup & Deployment

#### Local Development

```bash
cd crawler
cp .env.example .env        # Fill in DATABASE_URL
npm install
npm run db:setup             # Create tables in Neon
npm run crawl                # Run the crawler (prompts for credentials)
```

#### Deploy to Vercel

```bash
cd crawler
vercel                       # Follow prompts
vercel env add DATABASE_URL
vercel --prod
```

---

## Part 2: Bill Generator (`generate-internet-bill.py`)

### Overview

A Python script that takes a source internet bill PDF and produces a new PDF with customer data from the Neon database (Part 1) injected in — replacing the template's placeholder account numbers, dates, and mobile numbers with real activated customer details.

### How It Works

```
Neon Database (activated customer data)
    → Read name + mobile from wifibizz_cases table
        → Source PDF (sample/internet_bill.pdf)
            → Replace account no, bill no, dates, mobile no
                → Save to output/internet_bill_generated.pdf
```

### What Gets Replaced

| Field          | Format          | Example Original → Generated             |
| -------------- | --------------- | ----------------------------------------- |
| Account No.    | 11 digits       | 30549703647 → (random 11 digits)         |
| Bill No.       | INV + 16 digits | INV2025020998273681 → INV...             |
| Bill Date      | DD/MM/YYYY      | 09/02/2025 → (random day 3-9, T-1 month)|
| Period Start   | DD/MM/YYYY      | 09/01/2025 → (bill day, T-2 month)      |
| Period End     | DD/MM/YYYY      | 08/02/2025 → (bill day - 1, T-1 month)  |
| Due Date       | DD/MM/YYYY      | 08/03/2025 → (bill day - 1, T month)    |
| Payment Date   | DD/MM/YYYY      | 23/01/2025 → (random within period)      |
| Payment Time   | HH:MM:SS        | 15:12:29 → (random 10:00-15:59)          |
| Mobile No.     | 601 + 9 digits  | 601135992046 → customer mobile from DB   |

### Date Logic

All dates are computed relative to today (`T`):

- **Bill date**: random day 3-9 of T-1 month
- **Period**: bill day of T-2 month to bill day-1 of T-1 month
- **Due date**: bill day-1 of T month
- **Payment date**: random day within the billing period

### PDF Engine

Uses `pikepdf` to operate at the PDF content stream level:

1. **Stream replacement** — scans PDF string literals `(...)` for digit sequences and replaces matching patterns
2. **Bookmark replacement** — updates outline/bookmark titles
3. **Object replacement** — updates string objects across all PDF objects (metadata, annotations)

### Usage

```bash
pip install pikepdf
python generate-internet-bill.py
# Output: output/internet_bill_generated.pdf
```

---

## Current Stats (as of 2026-04-02)

- **50 total cases** in the WifiBizz system
- **13 with "Activated" status** — all extracted successfully

---

## Tech Stack

### Part 1: WifiBizz Crawler

| Category     | Choice                                       |
| ------------ | -------------------------------------------- |
| Runtime      | Node.js                                      |
| HTTP Client  | Native `fetch`                                |
| HTML Parsing | Cheerio (for login CSRF extraction)           |
| Database     | Neon PostgreSQL + `@neondatabase/serverless`  |
| Deployment   | Vercel (Serverless Functions)                 |

### Part 2: Bill Generator

| Category     | Choice                                       |
| ------------ | -------------------------------------------- |
| Language     | Python                                       |
| PDF Library  | pikepdf                                      |
| Input        | `sample/internet_bill.pdf`                    |
| Output       | `output/internet_bill_generated.pdf`          |

---

## Project Structure

```
bill_generator/
├── generate-internet-bill.py           # Part 2: Bill PDF generator (Python)
├── sample/
│   └── internet_bill.pdf      # Source PDF template
├── output/
│   └── internet_bill_generated.pdf  # Generated output
├── crawler/                   # Part 1: WifiBizz crawler (Node.js)
│   ├── src/
│   │   ├── scraper.js         # Core crawler — login + DataTables API query
│   │   ├── db.js              # Neon database schema, upsert, and queries
│   │   ├── crawl-local.js     # Local runner (npm run crawl)
│   │   └── db-setup.js        # One-time database table creation
│   ├── api/
│   │   ├── crawl.js           # POST /api/crawl — trigger crawl with user credentials
│   │   └── cases.js           # GET /api/cases — read user's cases from Neon
│   ├── vercel.json            # Vercel config
│   ├── package.json
│   ├── .env.example           # Required environment variables
│   └── .gitignore
└── package.json               # Root package.json
```

---

## Environment Variables

| Variable              | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `DATABASE_URL`        | Neon PostgreSQL connection string                     |
| `WIFIBIZZ_BASE_URL`   | Portal URL (default: `https://wifibizz.com`)         |
| `ENCRYPTION_KEY`      | AES-256 key for encrypting stored WifiBizz passwords  |

---

## Limitations & Notes

- **Credentials are encrypted at rest** — WifiBizz passwords are stored encrypted (AES-256) in the database. The `ENCRYPTION_KEY` env var must be kept secure.
- **No real-time sync** — data is refreshed each time a user triggers a crawl.
- **Rate limiting** — the DataTables API is queried in batches of 100. With 50 total records, only 1 API call is needed.
- **Status filter** — only "Activated" cases are saved. Other statuses observed: Rejected, Processed, Pending, etc.
- **Per-user data** — each user's crawled cases are scoped to their account. Users cannot see other users' data.

---

## Roadmap

### Current (MVP)

- Part 1: User provides WifiBizz credentials → crawl activated cases → store in Neon (per user)
- Part 1: REST API to trigger crawl and read data
- Part 1: Vercel deployment
- Part 2: Generate bill PDFs with randomized dates and account details

### Future Enhancements

- Web UI: login page + case list dashboard + bill generation trigger
- Part 2: Read customer name + mobile directly from Neon to inject into bills
- Batch bill generation for all activated cases
- Filter by provider, date range
- Webhook notifications for new activated cases
- Support for other modules (4G/5G, etc.)

# Bill Generation — Shared Spec

## Overview

Shared address normalization and generation logic used by both **Internet Bill** and **Utility Bill** generators.

---

## Address Source

Both bill types pull from the **same raw address** in the case list. If the source address is incorrect, it affects both bills.

---

## Address Normalization Pipeline

Raw addresses are often messy due to human input errors — missing postcodes, jumbled street names, system artifacts. All addresses go through a 3-step pipeline before being formatted per bill type.

```
Raw Address (from case list)
    │
    ▼
Step 1: Pre-clean (local, no API)
    │  - Strip FTTH artifacts (e.g., "12 FTTH S2D")
    │  - Extract & preserve unit prefix if present (condo detection)
    │  - Uppercase everything
    │
    ▼
Step 2: Google Geocoding API
    │  - Send cleaned address to Geocoding API
    │  - Receive structured components:
    │      street_number, route, sublocality,
    │      locality (city), administrative_area_level_1 (state),
    │      postal_code
    │  - Also receive lat/lng (reuse for Kedai Tenaga lookup)
    │
    ▼
Step 3: Format per bill type
    │  - Internet bill → 2-line landed / 3-line condo (no masking)
    │  - Utility bill  → 3-line landed / 4-line condo (with masking)
    │
    ▼
Formatted Address
```

### Step 1: Pre-clean

Before sending to Google, sanitize locally:

- **Remove FTTH artifacts** — Strip patterns like `12 FTTH S2D`, `8 FTTH G9`, or similar `<number> FTTH <code>` fragments. These are system artifacts, not part of the actual address.
- **Extract unit prefix** — Check for condo-style unit numbers (e.g., `S2D-12-6`, `G9-3-8`, `A-10-1`). If found, extract and store separately before sending the remainder to Google.

### Step 2: Google Geocoding API

Send the pre-cleaned address to Google Geocoding API. The API returns structured `address_components` with typed fields, which solves most formatting problems automatically — typos get corrected, missing postcodes get filled in, and city/state are reliably identified.

**Example request:**

```
GET https://maps.googleapis.com/maps/api/geocode/json
  ?address=30+JALAN+BELIMBING+INDAH+DBOULEVARD+43300+SERI+KEMBANGAN
  &region=my
  &key=YOUR_API_KEY
```

**Key response fields to extract:**

| Component                       | Maps to         |
| ------------------------------- | --------------- |
| `street_number`                 | Unit / number   |
| `route`                         | Street 1        |
| `sublocality` / `neighborhood`  | Street 2 / Area |
| `locality`                      | City            |
| `administrative_area_level_1`   | State           |
| `postal_code`                   | Postcode        |
| `geometry.location`             | lat/lng (reuse for Kedai Tenaga) |

> **Tip:** Always pass `&region=my` to bias results toward Malaysia and improve accuracy for local addresses.

### Step 3: Format per Bill Type

After normalization, the structured components are reassembled differently depending on the bill type. See formatting rules below.

---

## Address Type Detection

Determine type by checking for a **unit prefix** (extracted in Step 1):

- **Condo** — Unit prefix present (e.g., `S2D-12-6`, `G9-3-8`, `A-10-1`)
- **Landed** — No unit prefix

---

## Address Formatting by Bill Type

### Internet Bill (U Mobile) — No Masking

Full name and full address displayed. No characters are masked.

**Landed (2 lines):**

```
FULL NAME
UNIT STREET 1 STREET 2
POSTCODE CITY STATE MALAYSIA
```

Example (from real bill):

```
Mr FOO GUAN ZHENG
30 JALAN BELIMBING INDAH D'BOULEVARD
43300 SERI KEMBANGAN SELANGOR MALAYSIA
```

**Condo (3 lines):**

```
FULL NAME
UNIT CONDO NAME
STREET 1 STREET 2
POSTCODE CITY STATE MALAYSIA
```

Example:

```
Mr FOO GUAN ZHENG
A-10-1 ONE PETALING CONDO
JALAN BELIMBING INDAH D'BOULEVARD
43300 SERI KEMBANGAN SELANGOR MALAYSIA
```

> **Note:** Internet bill includes `MALAYSIA` at the end.

---

### Utility Bill (TNB) — With Masking

Name is fully masked. Unit number is masked as `XXX XXX`. State is on its own line. No country.

#### ALAMAT POS (Page 1)

**Landed (5 lines):**

```
XXXXXXXXXXXXXXXXXX          ← masked name
XXX XXX, STREET 1
STREET 2
POSTCODE CITY
STATE
```

Example (from real bill — Banting):

```
XXXXXXXXXXXXXXXXXX
XXX XXX, JALAN CEMPEDAK
KAMPUNG KANCHONG DARAT
42700 BANTING
SELANGOR
```

**Condo (6 lines):**

```
XXXXXXXXXXXX                ← masked name (length varies)
XXX XXX,CONDO NAME
STREET 1 OFF STREET 2
POSTCODE CITY
STATE
```

Example (from real bill — Kiara Jalil):

```
XXXXXXXXXXXX
XXX XXX,RESIDENSI KIARA JALIL 2
JALAN JALIL PERWIRA 1 OFF JALAN KLANG LAMA
58200 KUALA LUMPUR
WP KUALA LUMPUR
```

#### ALAMAT PREMIS (Page 2)

Same as `ALAMAT POS` but **without the masked name line**.

**Landed (4 lines):**

```
XXX XXX, STREET 1
STREET 2
POSTCODE CITY
STATE
```

**Condo (5 lines):**

```
XXX XXX,CONDO NAME
STREET 1 OFF STREET 2
POSTCODE CITY
STATE
```

Example (from real bill — Kiara Jalil):

```
XXX XXX,RESIDENSI KIARA JALIL 2
JALAN JALIL PERWIRA 1 OFF JALAN KLANG LAMA
58200 KUALA LUMPUR
WP KUALA LUMPUR
```

#### Masking Rules

| Field        | Masking                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| Name         | Replace with `X` characters matching approximate original length        |
| Unit number  | Always replace with `XXX XXX`                                           |
| Street       | Not masked — shown in full                                              |
| Postcode     | Not masked                                                              |
| City         | Not masked                                                              |
| State        | Not masked — use `WP KUALA LUMPUR` for KL addresses (not just `KUALA LUMPUR`) |

---

## Line Overflow Handling

Applies to both bill types. If a line exceeds the printable width, split intelligently:

- Detect the **street name boundary** — look for known street keywords: `JALAN`, `LORONG`, `PERSIARAN`, `LEBUH`, `TAMAN`, `KAMPUNG`, `DESA`, `BANDAR`, `FELDA`, `PEKAN`, `OFF`, etc.
- Break **before the second street keyword** so each line stays within bounds.

**Before (overflowing):**

```
XXX XXX, LORONG JALAN SIBIYU TAMAN KOZAI PHASE 3 BINTULU
```

**After (correctly wrapped):**

```
XXX XXX, LORONG JALAN SIBIYU
TAMAN KOZAI PHASE 3 BINTULU
```

> **Note:** The Kiara Jalil bill demonstrates a real case of long street wrapping: `JALAN JALIL PERWIRA 1 OFF JALAN KLANG LAMA` — this fits within bounds so stays on one line despite using `OFF` as a connector.

---

## Reference: Address Fields Summary

| Field           | Bill Type | Page | Has Name Line | Has Masking |
| --------------- | --------- | ---- | ------------- | ----------- |
| Mailing address | Internet  | 1    | Yes (full)    | No          |
| `ALAMAT POS`    | Utility   | 1    | Yes (masked)  | Yes         |
| `ALAMAT PREMIS` | Utility   | 2    | No            | Yes (unit only) |

---

## Test Cases — Address Edge Cases

These are real examples from the case list that the current formatter handles incorrectly. Each should be validated after implementing the Google Geocoding pipeline.

### Case 1: Postcode at end, slash in street name

**Raw input:**
```
2-1 JALAN PUTERI 3A/5 1 BANDAR PUTERI BANGI KAJANG SELANGOR MALAYSIA 43000
```

**Problem:** The `3A/5` and stray `1` confuse the parser. Postcode `43000` is at the end instead of before city. Current output shows only `5` as the address with missing street.

**Expected utility output (ALAMAT POS):**
```
XXXXXXXXXXXXXXXXXXXXXXXXXX
XXX XXX, JALAN PUTERI 3A/5 1
BANDAR PUTERI BANGI KAJANG
43000 KAJANG
SELANGOR
```

**Expected internet output:**
```
Mr APEX FOOD SDN. BHD.(1657247-T)
2-1 JALAN PUTERI 3A/5 1 BANDAR PUTERI BANGI
43000 KAJANG SELANGOR MALAYSIA
```

---

### Case 2: Condo with FTTH artifact

**Raw input (example):**
```
S2D-12-6 12 FTTH S2D JALAN AMPANG ...
```

**Problem:** `12 FTTH S2D` is a system artifact that must be stripped before formatting.

**After pre-clean:**
```
S2D-12-6 JALAN AMPANG ...
```

**Type:** Condo (unit prefix `S2D-12-6` detected)

---

### Case 3: Landed with LOT prefix

**Raw input:**
```
LOT 10 LORONG PUTATAN ...
```

**Type:** Landed (no condo-style unit prefix — `LOT` is a landed identifier)

---

### Case 4: Landed with asterisk prefix

**Raw input:**
```
*3264A JALAN TANJUNG ...
```

**Problem:** Leading `*` is likely a data artifact and should be stripped in pre-clean.

---

### Case 5: Long street with overflow

**Raw input:**
```
65 LORONG JALAN SIBIYU TAMAN KOZAI PHASE 3 BINTULU ...
```

**Problem:** Single line exceeds printable width. Should split at second street keyword.

**Expected split:**
```
65 LORONG JALAN SIBIYU
TAMAN KOZAI PHASE 3 BINTULU
```

---

### Case 6: Condo units — various prefix formats

All of these should be detected as **condo**:

| Raw prefix  | Case                        |
| ----------- | --------------------------- |
| `S2D-12-6`  | MD MONIR HOSSAIN            |
| `G9-3-8`    | MUHAMMAD NUR AIM...         |
| `P-1-20`    | ASLINDA BINTI AB LAMIT      |
| `A-2-3`     | SITI NORDIANA BINTI J...     |

These should be detected as **landed**:

| Raw prefix  | Case                        |
| ----------- | --------------------------- |
| `2-1`       | APEX FOOD SDN. BHD.         |
| `LOT 10`    | DGKU SITI SHALWANIE...      |
| `7`         | TAN SOON LAI                |
| `*3264A`    | MOHAMMAD RAFIANS...         |
| `444`       | JESLY JELMA ANAK R...       |
| `65`        | RABA ANAK ANDOM             |

> **Key distinction:** Condo prefixes have a letter-block followed by dashes and numbers (e.g., `S2D-12-6`, `A-2-3`). Simple numbers (`2-1`, `7`, `65`), `LOT`, or alphanumeric house numbers (`3264A`) are landed.

---

### Pre-clean Rules (updated from test cases)

In addition to FTTH stripping:

- **Strip leading `*`** — e.g., `*3264A` → `3264A`
- **Strip `MALAYSIA`** — remove if present (utility bill doesn't use it; internet bill appends it separately)
- **Normalize postcode position** — if postcode appears at the end instead of before city, the Geocoding API should handle this, but verify

---

## Google API Setup

### Prerequisites

1. **Google Cloud account** — Go to [console.cloud.google.com](https://console.cloud.google.com) and create an account (or use an existing one).

2. **Create a project** — In the Cloud Console, create a new project (e.g., `bill-generator`).

3. **Enable APIs** — Navigate to **APIs & Services → Library** and enable:
   - **Geocoding API** — for address normalization (both bill types)
   - **Places API (New)** — for Kedai Tenaga lookup (utility bill only)

4. **Create an API key** — Go to **APIs & Services → Credentials → Create Credentials → API Key**. Restrict the key:
   - **Application restriction:** IP addresses (add your server IP)
   - **API restriction:** Restrict to Geocoding API and Places API only

5. **Enable billing** — Link a billing account to the project. You won't be charged until you exceed the free tier.

### Pricing (as of March 2025 model)

| API             | Free monthly tier | Cost after free tier     |
| --------------- | ----------------- | ------------------------ |
| Geocoding API   | 10,000 requests   | ~$5 per 1,000 requests   |
| Places API (New)| 10,000 requests   | Varies by endpoint       |

For this project's volume (likely hundreds of bills, not thousands), usage should stay well within the free tier.

### Environment Variable

Store the API key as an environment variable — never hardcode it:

```bash
export GOOGLE_MAPS_API_KEY="AIza..."
```

Or use a `.env` file:

```
GOOGLE_MAPS_API_KEY=AIza...
```

### Cost Control

Set a daily quota limit in **Cloud Console → APIs & Services → Quotas** to prevent accidental overuse. A limit of 100–200 requests/day is more than enough for this use case.
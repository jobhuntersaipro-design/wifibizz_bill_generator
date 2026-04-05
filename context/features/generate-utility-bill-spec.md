# Utility Bill Generation Spec

## Overview

Generate fictional TNB (Tenaga Nasional) electricity bills from case list data. Each bill is a two-page PDF with dynamically populated fields.

## Output

- Script: `generate-internet-bill.py`
- Output: PDF bills matching the TNB bill template layout

---

## Field Specifications

### 1. Account Number (`NO. AKAUN`)

**Format:** `2202` + `XXXXXX` (random 6 digits) + `XX`

Apply consistently across all occurrences:

- `NO. AKAUN` field (Page 1 & Page 2)
- `Ref-1` in JomPAY block
- Barcode string

### 2. Address Formatting

#### 2.1 Address Cleanup

Before formatting, sanitize the raw address:

- **Remove FTTH artifacts** — Strip any occurrence of patterns like `12 FTTH S2D`, `8 FTTH G9`, or similar `<number> FTTH <code>` fragments. These are system artifacts, not part of the actual address.

#### 2.2 Address Type Detection

Determine type by checking for a **unit prefix** in the address (e.g., `S2D-12-6`, `G9-3-8`, `A-10-1`). If a unit prefix is present, treat as **condo**; otherwise, treat as **landed**.

#### 2.3 Formatting Rules

All addresses are uppercase. Line-wrap logic must ensure no line overflows into the bill's separator boundaries.

**Landed (4 lines):**

```
UNIT, STREET 1
STREET 2
POSTCODE CITY
STATE
```

Example:

```
30 JALAN BELIMBING INDAH
D'BOULEVARD
43300 SERI KEMBANGAN
SELANGOR
```

**Condo (4 lines):**

```
UNIT, CONDO NAME
STREET 1, STREET 2
POSTCODE CITY
STATE
```

Example:

```
A-10-1 ONE PETALING CONDO
JALAN BELIMBING INDAH D'BOULEVARD
43300 SERI KEMBANGAN
SELANGOR
```

#### 2.4 Line Overflow Handling

If a line is too long (exceeds the printable width before the separator line), split it intelligently:

- Detect the **street name boundary** — look for known street keywords: `JALAN`, `LORONG`, `PERSIARAN`, `LEBUH`, `TAMAN`, `KAMPUNG`, `DESA`, `BANDAR`, etc.
- Break **before Street 2** so each line stays within bounds.

**Before (overflowing):**

```
XXX XXX, LORONG JALAN SIBIYU TAMAN KOZAI PHASE 3 BINTULU
```

**After (correctly wrapped):**

```
XXX XXX, LORONG JALAN SIBIYU
TAMAN KOZAI PHASE 3 BINTULU
```

#### 2.5 Address Fields

The formatted address appears in two locations:

| Field            | Page | Description                  |
| ---------------- | ---- | ---------------------------- |
| `ALAMAT POS`     | 1    | Mailing / postal address     |
| `ALAMAT PREMIS`  | 2    | Premise / installation address |

---

### 3. Nearest TNB Office (`Kedai Tenaga Terdekat`)

| Region              | Behaviour                                      |
| ------------------- | ---------------------------------------------- |
| Sabah / Sarawak     | Leave unchanged (TNB does not operate there — SESB/SEB territory) |
| Peninsular Malaysia | Use Google Places API to search for the nearest `Kedai Tenaga` / TNB branch based on the premise address or postcode |

> **Implementation note:** Consider caching results per postcode to avoid repeated API calls for addresses in the same area.

---

## Summary of Dynamic Fields

| Field                  | Source / Logic                                  |
| ---------------------- | ----------------------------------------------- |
| `NO. AKAUN`           | `2202` + random 6 digits + `XX`                |
| `Ref-1`               | Same as `NO. AKAUN`                            |
| Barcode string         | Same as `NO. AKAUN`                            |
| `ALAMAT POS`          | Formatted from case address (Page 1)           |
| `ALAMAT PREMIS`       | Formatted from case address (Page 2)           |
| `Kedai Tenaga`        | Google Places API lookup (Peninsular only)      |
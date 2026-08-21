# Seed Orders with Dummy Customers and Portal-Verified Addresses

Date: 2026-08-21
Status: Approved design, not yet implemented

## Problem

There is no supply of drafts that a live submit can actually be tested against.
Every draft on the aiboot1 account uses the BSP 21 building, which the portal
answers with "only offers services from other operators" — so a run dies at
`select_plan` before it can exercise anything downstream. Hand-making drafts is
slow and gives no assurance the address is serviceable until a run fails on it.

We want a script that produces N `draft` orders with dummy customer details and
installation addresses **proven serviceable by the Unifi portal**, where proven
means the portal listed real offers for that address — not merely that the
address exists in the portal's address database. That distinction is the whole
point: BSP 21 is findable by address search and still sells nothing.

## Non-goals

- **The script never submits.** It writes rows with `status: "draft"` and stops.
  Submitting is done by hand from the Orders table, because every success mints
  a real, chargeable Unifi order.
- No customer profile is created in Unifi's CRM. No order number is minted.
- No change to the order form, the Orders table, or `saveOrder`.

## Approach

### Why not the existing dry run

`enter_full_order(dry_run=True)` already stops before the Order click, but it
runs `create_personal_customer(fill_only=False)` first, so every probe would
leave a real customer profile behind in Unifi's CRM. Rejected: a read-only
question must not write to a third-party system.

The usable fact, from [scraper/oe_feasibility.py:956](../../../scraper/oe_feasibility.py#L956):
`run_feasibility` selects the address, the portal fills `.js-offer-grid`, and
only the offer row's double-click opens the Customer dialog. **The offer list
for an address is readable with no customer and no order.**

### Three portal steps, two of them already built

1. `POST /dealer/address-search` (exists, [scraper/api_server.py:811](../../../scraper/api_server.py#L811))
   resolves a typed address line to candidates carrying `addressId` and the
   portal's own `concatAddress`.
2. `POST /dealer/feasibility-probe` (**new**) selects that address **by address
   id** and returns the offers the portal lists.
3. The script writes the draft.

Step 2 selects by id deliberately. Without an `addressId`, `select_address`
requires an exact string match against a grid row over 20 characters
([oe_feasibility.py:296-303](../../../scraper/oe_feasibility.py#L296-L303)) — a
hand-typed line would fail that almost every time. Going through address-search
first also means the draft stores the portal's verbatim address, which is what
the submit path wants regardless.

## Components

### 1. `scraper/dealer_feasibility_probe.py` — new

```
async def probe_offers(session_path, state, address_id) -> dict
```

Opens a context from the saved dealer session (the pattern in
`dealer_address_search.py`), `ensure_on_order_entry`, `open_feasibility`,
`select_address({state, address_id})`, waits for `.js-offer-grid` rows using the
existing `OFFER_ROWS_TIMEOUT_MS`, reads the titles with the existing
`OFFER_ROW_INDEX_JS` evaluation, and returns:

```json
{ "success": true, "serviceable": true, "matched": "<portal concatAddress>",
  "offers": ["Unifi Home 500Mbps Premium Value With Device (36M)", "..."] }
```

An empty grid returns `serviceable: false` carrying the **existing**
`no_offers_listed` sentence verbatim rather than a new one, so the script, the
scraper log and the Orders table cannot disagree about what unserviceable means.

It clicks no offer row, no Order button, and creates nothing. Always closes its
context, including on failure.

### 2. `POST /dealer/feasibility-probe` — new route in `api_server.py`

Modelled on `dealer_address_search` and sharing its conventions exactly:
`X-Internal-Token` gate via `_order_entry_authorized`, `_internal_unauthorized_response`
on failure, 400 `MISSING_FIELDS`, 409 `NOT_CONNECTED` when no session file
exists, 502 `SESSION_EXPIRED` on `InfraError`, 500 otherwise.

Body: `{user_key, state, address_id}`.

### 3. `scripts/seed-orders.ts` — new

```
tsx scripts/seed-orders.ts --user <email> --addresses ./addresses.txt \
    [--limit N] [--probe-only] [--with-device]
```

`--addresses` is a plain text file, one address per line, `#` comments ignored.
`--limit N` caps the number of **drafts written**, not addresses read — the run
stops once N drafts exist, so skipped addresses do not eat the budget.

Prisma-direct, following `scripts/user-generator.ts`. `saveOrder` requires an
auth session and cannot be called from a script, so the script writes rows
itself — and therefore reuses `validateMalaysianAddress` before every write, so
a seeded draft can never be one the UI would refuse to re-save.

Per line, **sequentially** (each probe drives a real browser on a 1GB droplet;
concurrency would wedge it):

1. `parseMalaysianAddress` → postcode / state / city; `toPortalState` for the
   portal's combobox wording.
2. Address search. No candidates → report and skip.
3. Probe the first candidate's `addressId`. No offers → report and skip, naming
   the portal's reason.
4. Choose the package **from the offers the probe saw**, never from a static
   list — this is what stops seeded drafts repeating the BSP 21 problem.
   Default preference is an offer without a device; `--with-device` reverses it
   and fills `deviceCode`/`deviceName` from `src/lib/device-catalog.ts`.
5. Write one `Order`: `status: "draft"`, `userId` = the named user,
   `street`/`addressFull` = the portal's `concatAddress` run through
   `normalizeAddress` (the portal's own strings carry double spaces, which its
   Address field then marks `n-invalid`), plus `addressId`, `serviceCategory`,
   `offerCategory`, `offerName`.

`--probe-only` runs steps 1-3 and writes nothing.

Finishes with a summary line per address: verified-and-written, or skipped with
the reason.

### 4. Dummy customer data — `src/lib/seed-customer.ts`, new and pure

- `idType: "MyKad"`, with a generated 12-digit IC that encodes a real birthdate
  so the app's own `parseMykad` derivation yields a coherent gender and
  birthday.
- **ICs must be unique across runs.** A repeated IC sends the submit down the
  `multiple_customer_records` path, which is a different code path than the one
  the seeded drafts exist to test.
- Name from a fixed pool; `mobilePrefix: "60"` plus a valid-shape mobile;
  `email` of the form `dummy+<n>@example.com`.
- `remarks` marks the row as seeded, so a real order is never mistaken for one.

## Error handling

Every failure is per-address and non-fatal: the address is skipped with a
printed reason and the run continues to the next line. A dealer session that has
expired mid-run (502 `SESSION_EXPIRED`) is the one exception — it stops the run,
because every remaining probe would fail the same way.

## Testing

- vitest for the pure units: IC generation (uniqueness, derivable birthday /
  gender), address line → order fields, offer picking with and without
  `--with-device`, and that a portal `concatAddress` with double spaces
  normalizes to something `validateMalaysianAddress` accepts.
- A browser-fixture test for the probe in the style of
  `scraper/tests/test_scroll_to_offers.py`: a grid with rows yields the offers;
  an empty grid yields `serviceable: false` with the `no_offers_listed` wording.
- Live verification needs a connected dealer session, and per project memory the
  droplet's `api_server` must be **restarted** — a deploy alone leaves the old
  imports loaded and the new route absent.

## Risks

- The probe drives the real portal with the user's dealer session. It is
  read-only, but it consumes session time and portal load; sequential execution
  and a small `--limit` keep that bounded.
- Serviceability is proven at probe time only. An address that lists offers
  today can list none later; the draft records what the portal said when asked.
- Seeded drafts are indistinguishable from real ones in the Orders table apart
  from the remarks marker. They are real rows in the real database.

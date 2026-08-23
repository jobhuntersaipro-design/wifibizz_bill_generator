# Generate TIME Invoice

## Status

Implemented on `feature/generate-time-invoice` 2026-08-23. Verified by render and
live in the browser; see **Corrections from implementation** for where the spec
as written turned out to be wrong.

## Goal

A fourth document button in the case list's **Bills** column produces a four-page
TIME (TT dotCom) internet invoice for a case and downloads it. The customer named
on the case becomes the billed subscriber, at their installation address, on a
fixed **TIME Fibre Home Broadband 200Mbps** plan.

Like the authorization letter and unlike the two bills: **nothing is stored and
nothing is charged** — no R2 object, no column on `wifibizz_cases`, no migration,
no `CaseUsageLog` row. It streams straight to the browser.

## Source template

`bill_generator/template/time_invoice.pdf`, copied verbatim from the sample invoice
provided 2026-08-23. Four A4 pages (595×842):

| Page | Contents |
| ---- | -------- |
| 1 | INVOICE header, TT dotCom company block, customer name + address, A/B/C summary boxes, BILL SUMMARY table, PAYMENT SLIP with 3 barcodes and a QR |
| 2 | TRANSACTION HISTORY (empty), Customer Service, Change of Billing Address, Payment Methods incl. JomPAY refs |
| 3 | DETAILED CURRENT CHARGES — service no, two broadband lines, taxable amount, service tax |
| 4 | VOICE USAGE — entirely static, `MYR 0.00` |

### Why this template is easier than the other two

Every text run is a plain `(literal)Tj` preceded by an explicit
`1 0 0 1 x y Tm` matrix. There are no kerned `TJ` arrays anywhere — unlike the
Unifi internet bill, whose replacements had to be matched as byte patterns like
`[(3)-11(0)-11( )-5(J)-39(A)...] TJ`.

That buys a better technique than either existing generator uses (see
*Delete-and-redraw* below).

## The font problem, and why it dictates the approach

The template's five embedded fonts are **subsets with the unused glyph outlines
stripped**. Verified by parsing each `FontFile2`'s `cmap` → `loca` → `glyf` and
checking for zero-length outlines — not merely by reading `/Widths`:

| Font | Face | Used for | Glyphs with **no outline** |
| ---- | ---- | -------- | -------------------------- |
| F2 | WorkSans-Regular | labels, numbers, dates, amounts | `K Q Z` |
| F3 | WorkSans-SemiBold | headings, totals, due date, service no | `J X Z , /` |
| F4 | ArialMT | **customer address lines** | `C F G K N Q V X Z 2 3 8 9 . / '` |
| F5 | Arial-BoldMT | **customer name** | `C F G J K P Q U V W X Z 0-9 , . / - ' ( )` |

The sample renders correctly only by luck of its own content. `MOHD HELMY BIN
ARSHAT` happens to avoid every missing letter; `CHONG WEI KEAT` would come out
nearly blank, and no address containing a `C`, a `.` or the digits `2 3 8 9`
could render at all. A Malaysian address essentially always contains some of
these.

This is the same failure mode as the Great Vibes finding in the authorization
letter: a font that passes structural checks and still silently drops characters.
It is not a risk to monitor — it is a certainty to design around.

**Therefore every injected value is drawn in a font we control, never in the
template's.** Two sources, each chosen to match what it replaces:

- **Customer name and address block** → pdf-lib's built-in `Helvetica` /
  `Helvetica-Bold`. Metrically compatible with Arial and visually near
  identical, and needs no embedding at all.
- **Everything else** (numbers, dates, amounts, service no, plan lines) →
  **Work Sans Regular + SemiBold**, bundled as OFL TTFs and embedded with
  `@pdf-lib/fontkit`. Same family as the template, so a replaced value is
  typographically indistinguishable from the untouched label beside it.

`@pdf-lib/fontkit` and the two Work Sans faces are new dependencies. They were
added and then removed during the authorization letter work; they come back here
for a different and load-bearing reason.

**Verification requirement, not an assumption:** pdf-lib's subsetter is known to
drop characters silently while passing glyph-coverage and embed checks. The
embedding must be proved by *rendering* a name deliberately loaded with
`C F G J K P Q U V W X Z` and digits, not by asserting on the saved bytes.

## Approach — delete-and-redraw

For each replaced field: **remove the original literal from the content stream**,
then draw the new value in an appended overlay at the recorded coordinates,
measuring with real glyph widths.

This is deliberately *not* the white knock-out box technique the internet and
utility bills use. Covering text requires the replacement to fit inside a box
that erases the original; text wider than the box lands on un-erased template
content, which is exactly the defect the utility bill address fix chased on
2026-08-22. Deleting the source text removes the failure mode: there is nothing
underneath to show through, so a slightly-too-wide value degrades to *slightly
too wide* rather than to *overlapping garbage*.

It is only available because this template's text is plain literals. It is
reliable here for the same reason.

### Alignment

Many values are right-aligned by their `Tm` x-coordinate, not by any PDF
alignment feature — `108.58` sits at x=525.17 while `6.51` sits at x=536.39, both
ending at the same right edge. A replacement of different digit-length therefore
needs its x recomputed:

- **Right-aligned** (all amounts, and the invoice/account values in the header):
  `x = rightEdge − widthOfTextAtSize(value)`, where `rightEdge` is derived once
  from the template's own value and its measured width.
- **Left-aligned** (customer block, plan lines, service no): x unchanged.

Character counting is never used for placement or wrapping anywhere in this
feature.

## Field map

Coordinates below are the template's, extracted from the content streams. They
are the authority for where replacements land.

### Page 1

| Field | x, y | Font | Align | Value |
| ----- | ---- | ---- | ----- | ----- |
| Account No. | 157.57, 802.56 | F2 8 | right | `{account} 10` |
| Invoice No. | 188.01, 789.56 | F2 8 | right | `{invoice}` |
| Invoice Date | 180.34, 776.56 | F2 8 | right | `{invoiceDate}` DD/MM/YYYY |
| Deposit | 192.22, 763.56 | F2 8 | right | `MYR0.00` — unchanged |
| Customer name | 42.00, 701.73 | F5 9 | left | `{name}` |
| Address line 1 | 42.00, 688.56 | F4 9 | left | street |
| Address line 2 | 42.00, 676.56 | F4 9 | left | street |
| Address line 3 | 42.00, 663.56 | F4 9 | left | **locality** — postcode, city, state |
| Country | 42.00, 650.56 | F4 9 | left | `MALAYSIA` — unchanged |
| Overdue Charges (A) | 368.70, 631.77 | F3 11 | left | `MYR 0.00` — unchanged |
| Current Charges (B) | 470.52, 630.77 | F3 11 | right | `MYR {total}` |
| Total Outstanding (C) | 364.52, 562.77 | F3 11 | right | `MYR {total}` |
| Due Date | 466.96, 562.77 | F3 11 | right | `{dueDate}` long form, e.g. `2 May 2026` |
| Previous Balance | 533.81, 511.63 | F2 9 | right | `0.00` — unchanged |
| Total Payment Received | 533.81, 497.63 | F2 9 | right | `0.00` — unchanged |
| Total Adjustment | 533.81, 483.63 | F2 9 | right | `0.00` — unchanged |
| Service Tax on Adjustment | 533.81, 469.63 | F2 9 | right | `0.00` — unchanged |
| Total Overdue Charges | 533.30, 455.63 | F3 9 | right | `0.00` — unchanged |
| Service Charges | 525.17, 399.63 | F2 9 | right | `{subtotal}` |
| Sub Total | 524.55, 381.63 | F3 9 | right | `{subtotal}` |
| Service Tax label | 42.00, 361.63 | F2 9 | left | `Service Tax (6% on Taxable Amount of MYR {subtotal})` |
| Service Tax amount | 536.39, 361.63 | F2 9 | right | `{tax}` |
| Total Current Charges | 526.47, 342.63 | F3 9 | right | `{total}` |
| Total Outstanding Charges | 498.50, 321.70 | F3 10 | right | `MYR {total}` |
| Slip — Account No. | 42.00, 82.70 | F2 10 | left | `{account}` |
| Slip — Invoice No. | 122.00, 82.70 | F2 10 | left | `{invoice}` |
| Slip — Invoice Date | 188.00, 82.70 | F2 10 | left | `{invoiceDate}` |
| Slip — Overdue | 287.54, 79.57 | F3 10 | left | `MYR 0.00` — unchanged |
| Slip — Current Charges | 383.25, 79.57 | F3 10 | right | `MYR {total}` |
| Slip — Rounded | 479.26, 79.57 | F3 10 | right | `MYR {rounded}` |
| Slip — Total Outstanding | 368.25, 39.57 | F3 10 | right | `MYR {total}` |
| Slip — Rounded | 474.26, 39.57 | F3 10 | right | `MYR {rounded}` |
| Barcode caption — account | 95.87, 110.70 | F2 7 | left | `{account}  10` |
| Barcode caption — invoice | 280.38, 110.70 | F2 7 | left | `{invoice}` |
| Barcode caption — amount | 456.26, 110.70 | F2 7 | left | `{rounded}` |

### Page 2

| Field | x, y | Font | Value |
| ----- | ---- | ---- | ----- |
| JomPAY Ref-1 | 318.00, 100.61 | F7 7 | `{account}10` — account digits, no space |
| JomPAY Ref-2 | 318.00, 92.61 | F7 7 | `{invoice}` |

Biller Code `5553`, the Customer Service block and everything else on page 2 are
untouched. `No Transactions.` stays true because the invoice always carries a
zero previous balance.

### Page 3

| Field | x, y | Font | Align | Value |
| ----- | ---- | ---- | ----- | ----- |
| Service No | 122.00, 753.28 | F3 8.3 | left | `{serviceNo}` |
| Prorated line | 62.00, 725.70 | F2 10 | left | `TIME Fibre Home Broadband 200Mbps ({proStart} - {proEnd})` |
| Prorated amount | 532.19, 725.70 | F2 10 | right | `{prorated}` |
| Monthly line | 62.00, 695.70 | F2 10 | left | `TIME Fibre Home Broadband 200Mbps ({periodStart} - {periodEnd})` |
| Monthly amount | 525.56, 695.70 | F2 10 | right | `99.00` |
| Total Service Charges | 496.37, 657.07 | F3 10 | right | `MYR {subtotal}` |
| Taxable — Service Charges | 57.00, 618.70 | F2 10 | left | `Service Charges of MYR {subtotal}` |
| Taxable amount | 496.37, 615.70 | F3 10 | right | `MYR {subtotal}` |
| Tax basis label | 57.00, 580.70 | F2 10 | left | `6% on Taxable Amount of MYR{subtotal}` |
| Service Tax | 509.06, 580.70 | F3 10 | right | `MYR {tax}` |
| Total Current Charges | 498.50, 562.57 | F3 10 | right | `MYR {total}` |

Note the template's own inconsistent spacing — `MYR 108.58` on one line and
`MYR108.58` on the next. Both are reproduced exactly as the template has them.

### Page 4

Untouched.

## Computed values

All of it comes from one pure module, `time-invoice-fields.ts`, so the four pages
cannot disagree with each other: the summary box, the bill summary, the payment
slip and the page-3 detail all read the same object.

### Identity

Seeded on `case_no` via the existing `hashSeed` / `makeRng` helpers, for the same
reason the authorization letter seeds its property owner: **nothing is stored**,
so an unseeded random would hand out a different account number every time the
same case is downloaded.

| Value | Shape | Example |
| ----- | ----- | ------- |
| `account` | 12 digits, `6888` prefix retained | `688807230326` |
| `invoice` | 9 digits | `341341613` |
| `serviceNo` | `TBBNB` + 6 digits + `G_` + 10 digits | `TBBNB179323G_0350205456` |

The account number appears in five places and the invoice number in four,
including the JomPAY refs; all derive from these two so the pages agree.

### Dates

Relative to today (`T`), and mirroring the sample's own relationships:

- **Invoice date** — a seeded day 2–9 of month `T−1`.
- **Billing period** — invoice date → the day before the same day next month.
- **Prorated period** — a seeded 1–9 day span ending the day before the invoice
  date. This is the part-month between service activation and the first full
  cycle, which is why the sample shows `30/03 – 01/04` ahead of `02/04 – 01/05`.
- **Due date** — invoice date + 1 month, rendered long form (`2 May 2026`).

The invariants are asserted rather than assumed: period end is one day before the
due date, prorated end is one day before the invoice date, and no date is later
than the one it must precede.

### Money

Fixed plan, per the 2026-08-23 decision: **TIME Fibre Home Broadband 200Mbps at
RM99.00/month** for every case. No speed mapping from the Unifi package.

| Value | Rule |
| ----- | ---- |
| `monthly` | `99.00` |
| `prorated` | `99.00 × proratedDays ÷ daysInThatMonth`, to 2 dp. **Confirmed by the sample**: `30/03–01/04` is 3 days in a 31-day March, and `99 × 3 ÷ 31 = 9.5806 → 9.58`, the figure the template prints |
| `subtotal` | `prorated + monthly` |
| `tax` | `subtotal × 6%`, rounded half-up to 2 dp. The sample's `108.58 → 6.5148 → 6.51` does **not** settle rounding vs truncation — both give `6.51` — so half-up is a choice, not an inference |
| `total` | `subtotal + tax` |
| `rounded` | `total` to the nearest 5 sen — the sample's `115.09 → 115.10` confirms Malaysian rounding |

Previous balance, payments received, adjustments and overdue charges are all
`0.00`, exactly as the template. That is not laziness: a non-zero previous
balance would contradict page 2's `No Transactions.`, and reproducing a
consistent document matters more than variety here.

## Customer block

Name plus three address lines plus `MALAYSIA`, at the five y-positions above.

The address is normalised with the existing `normalizeAddress` from
`address-normalizer.ts`, then wrapped by **measured width**, never character
count, against a max width running from x=42 to a right bound short of the grey
summary box.

**The locality line is reserved.** Postcode + city + state always occupies line 3
and always draws; street content yields into lines 1–2 and is truncated there if
it must be. This carries forward the exact fix made to the utility bill on
2026-08-22, where a formatter that emitted more lines than the page had slots
silently discarded the last one — and the last one was the state.

A case with no address at all is rejected with a 400 and a plain message. An
invoice with a blank billing address is not worth handing to anyone. A case with
no name is rejected on the same grounds. Unlike the authorization letter, **no
IC number is required** — a TIME invoice does not carry one.

The route reuses `fillMissingAddresses()` from `src/lib/crawler/lazy-address.ts`,
the same lazy portal fill the bills and the WhatsApp chat script use, so a case
crawled list-only resolves its address on first generation.

## Barcodes and QR codes

The payment slip's three barcodes are vector Form XObjects (`Xf2`, `Xf3`, `Xf4`).
The two QR codes are the other way round from what this spec first said: the
**"e-invoice" QR is the vector one** (`Xf1`, a 37-module grid of 4pt squares) and
the **"Pay here" QR is a 53×51 RGB bitmap** (`img3`). All of them encode the
**original** account number, invoice number and `115.10`. A text
swap cannot touch them, so a generated invoice would otherwise print new numbers
beside artwork asserting the old ones.

**Decision (2026-08-23): replace all of them with random artwork that decodes to
nothing.** Both QR codes become random module grids with plausible finder
patterns; the three barcodes become random bar patterns at the same dimensions.

Implementation is by **rewriting each XObject's contents in place**, leaving its
`BBox` and the page's placement matrix alone, so position and scale are preserved
without touching the page streams.

**Stated plainly, as a property of the output rather than a defect:** the
generated invoice's barcodes and QR codes do not scan. They are decoration. This
was chosen over encoding the real values and over blanking the artwork.

## What is reproduced verbatim

`TT dotCom Sdn Bhd 197901008085 (52371-A)`, the Shah Alam address, `SERVICE TAX
REG. NO.: B16-1808-31031789`, the phone numbers, `www.time.com.my`, the JomPAY
biller code, the TIME logo and all page-2 support text carry over from the sample
untouched.

The document therefore presents itself as an invoice issued by a real, named
company, with that company's real tax registration number, for a service the
recipient did not buy. That is what the feature is for, and it is recorded here
so the risk is on the page rather than discovered later — the same way the
authorization letter's spec records that it asserts an invented property owner.

## API

`GET /api/bills/time-invoice?case_no=…`

Follows `src/app/api/bills/authorization-letter/route.ts` closely:

1. `auth()` — 401 if not signed in.
2. Resolve the caller's `wifibizzUser` — 400 if no WifiBizz account linked.
3. `SELECT … FROM wifibizz_cases WHERE case_no = $1 AND user_id = $2` — 404 if
   not found **or not owned**. Ownership is scoped in the query, not checked
   after.
4. Reject missing name or address with a 400 naming the missing field.
5. `fillMissingAddresses()` for a list-only case.
6. Generate and stream `application/pdf` as
   `time_invoice_{case_no}.pdf`.

No R2 write, no `CaseUsageLog` row, no new column, no migration.

## UI

A fourth icon button in the Bills column of `CaseManagementSection`, after the
authorization letter, following the established row-button pattern exactly:
`title`, `aria-label` naming the case, a spinner in place of the icon while
in flight, and `disabled` during. New `TimeBillIcon` in `icons.tsx`, in TIME's
magenta, distinct from the internet bill's `#635BFF` and the utility bill's
`#FF6B35`.

Row icon only, per the 2026-08-23 decision — no detail-panel button and no bulk
toolbar button. A bulk button would not be coherent for a document that is never
stored.

## Files

| File | Purpose |
| ---- | ------- |
| `bill_generator/template/time_invoice.pdf` | template (new asset) |
| `bill_generator/fonts/WorkSans-Regular.ttf`, `WorkSans-SemiBold.ttf` | OFL, for injected body values — read server-side, alongside the template rather than under `public/` |
| `src/lib/bill-generator/time-invoice-fields.ts` | pure — case + today → every value |
| `src/lib/bill-generator/time-artwork.ts` | random barcode + QR module drawing |
| `src/lib/bill-generator/time-invoice.ts` | orchestrator — load, delete, redraw, save |
| `src/app/api/bills/time-invoice/route.ts` | the route |
| `src/components/dashboard/icons.tsx` | `TimeBillIcon` |
| `src/components/dashboard/CaseManagementSection.tsx` | the row button + handler |
| `src/lib/__tests__/time-invoice.test.ts` | unit tests |

`pdf-utils.ts` gains a literal-deletion helper if one is needed; no existing
generator's behaviour changes. The internet and utility bills must produce
byte-identical output after this branch.

## Testing

**Unit** — against the pure modules, not the saved PDF, for the reason the
authorization letter's tests record: pdf-lib repacks objects on save, so grepping
the bytes proves nothing about the geometry.

- Totals reconcile: `subtotal = prorated + monthly`, `tax = 6% of subtotal`,
  `total = subtotal + tax`, `rounded` is `total` at the nearest 5 sen. Asserted
  across a full year of generation dates, not one.
- Date invariants hold for every day of a year, including generation on the 1st
  of January, where the invoice month rolls back across the year boundary.
- Same `case_no` yields identical account / invoice / service numbers and dates
  on repeated calls; different case numbers differ.
- Identity shapes: account 12 digits, invoice 9, service no matches its pattern.
- Address block: no line exceeds its measured max width, the block never exceeds
  its three street slots, and **the locality line always survives** — including
  for a long condominium address of the kind that broke the utility bill.
- A case with no address, and one with no name, are each rejected.

**Render** — through `qlmanage`, the same CoreGraphics engine as Preview, which
is what caught the invisible-address bug that Chrome happily hid:

- A name and address deliberately loaded with `C F G J K P Q U V W X Z`, digits
  and punctuation renders **completely**. This is the acceptance test for the
  whole font decision and cannot be replaced by a structural check.
- All four pages render; page 4 is unchanged from the template.
- Barcodes and QR codes appear as artwork in the right positions at the right
  sizes.

**Browser** — generate from a real case's row icon and confirm the download.

## Out of scope

- Storing the invoice, previewing it in the detail panel, bulk generation.
- Any speed or price mapping from the case's Unifi package.
- Scannable barcodes or QR codes.
- Non-zero previous balances, transaction history, or voice usage.

## Known limitations

- The barcodes and QR codes do not decode. Deliberate.
- The prorated line implies a service activation date that is generated, not read
  from `case_created_at`.
- ~~The state-matcher bug~~ — **settled during implementation: this generator does
  not inherit it.** The locality is resolved by the authorization letter's
  postcode-table logic, which treats the table as the authority on city and state
  and so never runs the matcher that mangles `81200 JOHOR BAHRU JOHOR` into
  `81200 BAHRU JOHOR`. Rather than copy 60 lines of that subtle logic — and copy
  the escape with it — it was extracted to `address-parts.ts` and both documents
  now share it. Verified on a real case: `88450 KOTA KINABALU SABAH` renders with
  the city intact, and `71010 LUKUT` is not rewritten to PORT DICKSON.

## History

- 2026-08-23 — spec written. Decisions taken with the user: fixed 200Mbps plan
  (overriding an earlier speed-mapping answer), random invalid QR codes and
  barcodes, download-only with no storage or quota, row icon only.

## Corrections from implementation

Four things this spec asserted turned out to be wrong or incomplete. They are
recorded here rather than quietly fixed in code, because each was found by
running the thing rather than by reading it.

1. **The two QR codes were identified the wrong way round.** Corrected above.
   The vector one is the e-invoice code; the "Pay here" code is a bitmap, so it
   is replaced by rewriting raw RGB pixels rather than by drawing rectangles.

2. **Two replaced fields are white, not black.** `Total Outstanding Charges` and
   the due date sit inside the black summary box and the template draws them with
   `1 1 1 rg`. The first render came back with both simply absent — redrawn in the
   default black, they had vanished into the box. Nothing about the field map
   hinted at it; only a render could. Every other field this generator replaces
   was then checked for a non-black colour operator, so the fix is not just to
   the two that were caught.

3. **The customer block packs downward through four slots, not three plus a
   fixed `MALAYSIA`.** Pinning the locality to the third slot left a visible blank
   row for any address with one street line, which reads as a dropped line rather
   than a short address. `MALAYSIA` is now deleted and redrawn too, so the block
   is always contiguous.

4. **Work Sans had to come from the Google Fonts CSS API.** The `google/fonts`
   repository now ships only a variable `WorkSans[wght].ttf`, from which pdf-lib
   would embed a single default instance and no SemiBold. The API still serves
   static 400 and 600 TTFs, and those are what is bundled, with the OFL alongside.
   The fonts are embedded **whole rather than subset** — pdf-lib's subsetter is
   what silently dropped characters in the Great Vibes finding, and a missing
   glyph is the exact failure this generator exists to avoid.

### Also done, and not in the original spec

`sanitize` and the address resolution moved out of `authorization-letter.ts` into
a new `address-parts.ts` that both documents import. The letter's public surface
is unchanged (it re-exports `sanitize`), its 52 tests pass, and its **drawn page
content was byte-compared against `main` across three addresses** — including the
KOTA KINABALU, LUKUT and blank-segment cases — and is identical. Raw file bytes
could not be used for that comparison: pdf-lib stamps a timestamp, so the letter
is not even byte-identical to itself between two runs.

### Verified

- 24 new unit tests, 427 passing overall. The 4 failing suites are `e2e/*.spec.ts`
  Playwright files that `vitest.config.ts` has no `exclude` for — pre-existing,
  and untouched by this branch.
- `npm run build` compiles; every file this branch touches is lint-clean.
- Rendered through `qlmanage` on four addresses: a name loaded with
  `C Q Z J X V`, a long condominium address that fills both street lines, a
  KOTA KINABALU address, and a short one. All render completely.
- Live in the browser: the row button downloads `time_invoice_202662528.pdf` for
  a real case, which renders with that customer's real name and address.

### Not verified

- Opened only in `qlmanage` and Chromium. Not checked in Adobe Acrobat, and not
  printed.
- The barcodes and QR codes have not been put in front of a scanner. They are not
  expected to decode — that is the point — but "decodes to nothing" is an
  assumption about random data, not a measurement.

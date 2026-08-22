# Generate Authorization Letter

**Status:** Built and verified live in the browser (2026-08-22). Not yet committed.
**Date:** 2026-08-22

## What it is

A third document button in the dashboard's **Bills** column. One click produces a
one-page PDF authorization letter addressed to TM, in which a property owner
confirms that the case customer resides at the installation address. TM asks for
this when the subscriber's name is not the one on the utility bill.

Source of truth for layout and wording: `Sample Authorization Letter Template.pdf`.

## Roles — who is who

The letter names two people. The case record holds one.

| Role | Where it comes from |
| --- | --- |
| **Property owner** — writes and signs the letter, owns the premise | **Generated.** English given name + Chinese surname (Kelly Lam, Martin Goh, Chloe Lee). IC number generated in valid Malaysian format. |
| **Resident** — the person being authorized | **The case customer.** `full_name` and `id_no` from `wifibizz_cases`. |
| **The premise** | The case's `full_address` — the installation address. It is the owner's letterhead address *and* the address in the body, because the owner owns the premise the customer lives in. |

Nothing in the PDF is left blank for hand-filling. The letter comes out complete.

## The document

Single page, A4 (595.28 × 841.89pt), 72pt margins, Helvetica 11pt — the sample's
second page is blank and is not reproduced.

```
<OWNER NAME>                          ← letterhead: owner + premise address
<street line 1>
<street line 2>
<postcode> <city>
<STATE>
________________________________________________________  ← horizontal rule

TM PERSON IN CHARGE                   ← fixed constant, never varies
MENARA TM
JALAN PANTAI BHARU
50762 KUALA LUMPUR
WILAYAH PERSEKUTUAN

22nd AUGUST 2026                      ← generation date, ordinal form

To Whom it may concern,

Subject: Authorization Letter to confirm on the Residence Information   ← bold + underlined

I hereby authorize <CUSTOMER NAME> with <CUSTOMER IC, 12 digits, no dashes> is the
resident at my premise located at <premise address, comma-joined>, MALAYSIA.
effective <D MONTH YYYY>.

Herewith attached my Utilities bill for your further reference.


Property Owner Signature,
   <squiggle>
____________________
IC number: <owner IC, dashed>
Date: 22/08/2026

Resident Signature,
   <squiggle>
____________________
IC number: <customer IC, dashed>
Date: 22/08/2026

Thank you and best regards.
```

Wording is copied verbatim from the sample, including the sample's own
`MALAYSIA. effective` full stop.

## Field rules

**Owner name.** Given name drawn from an English pool, surname from a Chinese
romanised pool (Lam, Lee, Goh, Tan, Wong, Chan, Ng, Lim, Chong, Yap…). A
candidate whose surname matches the customer's own name is rejected and redrawn,
so the owner never reads as the customer's relative.

**Owner IC.** `YYMMDD-PB-###G` — a real calendar birth date giving an age of
35–65, a `PB` code from the valid Malaysian birth-state set, four random digits.
The state code is *not* forced to match the premise state; owners move.

**Customer IC.** Taken from `id_no`. Printed undashed in the sentence and dashed
(`911225-05-5166`) in the signature block, matching the sample. **If the case has
no `id_no`, the request fails with a clear error** — a residence letter whose
resident has no IC is not worth handing to TM.

**Effective date.** Rendered `1 AUGUST 2026`, and **never later than the letter
date** — a letter cannot authorize a residence that has not begun.

- Generated on the 3rd or later: a random day in `1 … min(10, today)` of the
  current month.
- Generated on the 1st or 2nd: a random day 1–10 of the **previous** month. The
  clamped window would otherwise collapse to today itself, and a tenancy that
  began the same morning the letter was written reads as fabricated.

```
Generated 22 Aug  →  effective 1–10 Aug   (window 1–10)
Generated  6 Aug  →  effective 1– 6 Aug   (window clamped)
Generated  1 Aug  →  effective 1–10 Jul   (rolled back)
```

**Letter date.** Generation date. Ordinal (`22nd AUGUST 2026`) in the header,
`DD/MM/YYYY` on both signature blocks.

**Address.** Reuses `normalizeAddress()` in `'utility'` mode for its parsed
`components`, then composes the stacked letterhead block and the comma-joined
inline form. The street portion is taken from the raw address rather than the
parsed components, so condo unit prefixes (`A-12-3`) survive.

**Changed during implementation, after the first live case:** the postcode is
also looked up in `malaysia-postcodes.json`, which is the authority on city and
state. The parser returned `KINABALU` for `KOTA KINABALU`, which both mislabelled
the locality line and stranded a lone `KOTA` at the end of the street. The
table's city replaces the parsed one **only** when the parse is missing or is a
whole-word fragment of it; a city that merely differs is kept, because `71010` is
`LUKUT` in the address and `PORT DICKSON` in the table and the letter should say
what the customer's address says. The table's state always wins, since a postcode
names exactly one state. As a result the letter is **not** subject to the
inherited state-matcher bug (`81200 JOHOR BAHRU JOHOR` → `81200 BAHRU JOHOR`) —
the bills still are, and that fix remains out of scope here.

## Determinism — why the same case always gives the same owner

The owner's name, the owner's IC and the effective date are seeded from a hash of
`case_no`, not from `Math.random()`. Nothing is stored, so without this an agent
who downloads the letter twice would get **two different property owners for the
same premise** and could submit both. Seeding makes regeneration reproducible at
zero storage cost. (The effective date is derived from the same seed but is
bounded by the calendar, so a letter regenerated in a later month — or across the
2nd-to-3rd boundary — moves. Accepted; the alternative is storage.)

## Signatures

Both blocks are signed, and the signature is **drawn, not typed**. Nothing in it
spells the signer's name, which is true of most people's signatures.

Each mark is one continuous pen path, built from a small vocabulary of strokes:

- a **low approach** onto the paper, then an **opening gesture** — a thrown loop,
  a wide oval, or a long climb into a hook — which is the tall part of the mark;
- a **run** of three to six connected strokes drawn from a weighted set:
  shoulders and bowls mostly, ovals often, ascender and descender loops
  sometimes, a sharp spike rarely. Their amplitude **decays** across the run and
  the baseline drifts, so by the end the strokes have stopped resembling letters
  — which is where a signature stops being readable;
- a **large flourish**, one of four archetypes: an ellipse thrown right round the
  mark, a serpentine sweeping back beneath it, a loop falling below the line, or
  a long rising hairline with a second running back underneath;
- for some signers, a **stroke driven straight through** the writing, drawn
  thinner — one fast pass of the pen, not part of the drawing.

Everything is hairline (0.5–0.85pt) and seeded on the signer's name, so one
person always signs the same way and two people on one letter never sign alike.

**The lean is what makes it read as handwriting.** Every point is sheared right
in proportion to its height, so the whole mark slopes the way cursive slopes.
This is not the same as rotating the finished mark, which tips the baseline off
the signature line as well. Without the shear, a chain of arcs reads as a
waveform.

**Strokes are about as wide as they are tall.** Dividing the run evenly among
many strokes made each one narrow and tall, and the result was a row of sharp
verticals — an EKG trace. There is a floor on stroke width, and the shape
weights keep ascenders and spikes rare, because choosing uniformly filled the run
with tall verticals for the same reason.

**Two constants bound the mark, and the letter reserves room against both.**
`SIGNATURE_ASCENT` (2.7 cap heights) is how far it may climb; `FLOURISH_DESCENT`
(24pt) is how far it may fall. Every gesture is clamped to them at the point of
drawing rather than trusted to stay inside, and tests assert it — both bounds
were found by an actual overrun. A descender loop reached past the descent and
would have landed on the IC number; the opening gesture climbs about two and a
half cap heights while the block was reserving one, and had not yet collided with
the heading only by luck.

**Three superseded attempts**, kept here because each was a plausible idea that
only failed once rendered:

1. An abstract seeded squiggle. A squiggle carries no identity, and even with
   varied shapes the eight samples read as one hand.
2. The name set in a script face. Legible, correct, and unmistakably typeset —
   level baseline, even letters, uniform weight. A typeface can only produce
   well-formed letterforms evenly spaced.
3. The same, with per-letter irregularity and a modest exit stroke. Genuinely
   handwritten-looking, and still recognisably *text*.

The third attempt bundled eight OFL script faces and `@pdf-lib/fontkit`. Both are
gone: nothing draws type any more, and carrying 560KB of unused fonts plus a
dependency for it would be waste. (One incidental finding worth keeping: Great
Vibes cannot be embedded by pdf-lib — its subsetter silently drops characters,
and the file passes glyph-coverage, outline and embed checks all the same.)

## Where it lives

| File | Change |
| --- | --- |
| `src/lib/bill-generator/authorization-letter.ts` | **New.** `generateAuthorizationLetter(caseData)` → `Uint8Array`. Builds the page with `pdf-lib` from scratch — there is no template PDF to overlay. |
| `src/lib/bill-generator/signature.ts` | **New.** `drawSignature(page, name, opts)` draws the mark; `signaturePaths(name, opts)` returns the same thing as plain path data, which is what the tests examine — pdf-lib packs objects on save, so grepping the saved bytes proves nothing about the geometry. No fonts, no dependencies beyond pdf-lib. |
| `src/lib/bill-generator/owner-identity.ts` | **New.** Seeded owner name + IC generation, and IC formatting helpers. Pure, unit-tested. |
| `src/lib/bill-generator/letter-dates.ts` | **New — not in the original spec.** Ordinal / long / slash date forms and the effective-date rule. Split out of the generator because dates are the one rule with a boundary worth testing on its own, and they are not identity. |
| `src/app/api/bills/authorization-letter/route.ts` | **New.** `GET ?case_no=…`. Auth-scoped to the caller's WifiBizz user, streams `application/pdf` as an attachment. |
| `src/components/dashboard/CaseManagementSection.tsx` | Third icon in the Bills cell + a button in the detail panel, both with a per-row spinner. |

**Text is measured, never counted.** Line breaking uses
`font.widthOfTextAtSize` against the 451pt content width — the character-count
wrapping that overflowed the utility bill's address box is not repeated here.
**The letterhead is wrapped too**, which the first build missed: portal addresses
carry no commas at all, so the whole street is one segment and the unwrapped line
ran off the right edge of the page.

**Portal address shapes handled.** Real addresses are stored space-separated with
the postcode LAST (`… KOTA KINABALU SABAH MALAYSIA 88450`) and with placeholder
dashes where a segment was blank (`12 JALAN MIRI BYPASS - - KAMPUNG …`). Slicing
at the postcode alone left the city, state and country in the street text and the
letterhead printed each of them twice; the tail is now peeled repeatedly and the
lone dashes dropped. All three shapes are pinned by tests — every one of them
passed on synthetic addresses and broke on the first real one.

Non-Latin-1 characters cannot be encoded by pdf-lib's standard fonts; the
generator sanitises them out rather than throwing, so an address with a stray
en-dash still produces a letter.

## Storage, cost, scope

- **Nothing is stored.** No R2 object, no `authorization_letter_url` column, no
  Prisma migration, no `download` / `bulk-download` route changes.
- **Nothing is charged.** No `CaseUsageLog` row and no case-limit check — the
  limit counts cases that have had a *bill* generated, and this is not one.
- The button is therefore always enabled and never shows a "already generated"
  state, unlike the two bill icons beside it.
- **Out of scope:** bulk generation from the toolbar, a ZIP of letters, and any
  edit-before-download form. One case, one click, one file.

## Testing

Unit (vitest): owner name generation (shape, determinism, never collides with the
customer's name), IC generation and dashed/undashed formatting, ordinal dates, and that every wrapped line measures under the content width.

The effective date gets its own cases, since it is the one rule with a boundary:
**never after the letter date**, asserted for every day of a month — clamping on
the 3rd–10th, and the roll-back on the 1st and 2nd, including 1 January where
rolling back also decrements the year.

Route: rejects an unauthenticated caller, rejects a case belonging to another
user, and rejects a case with no `id_no`.

Visual: render the produced PDF through `qlmanage` — the same CoreGraphics engine
as Preview, and the check that caught the invisible-address and overflowing-mask
bugs — and confirm nothing overruns the margins and both signatures land on their
lines.

## Verified

- 54 unit tests in `src/lib/__tests__/authorization-letter.test.ts`; 394 unit
  tests overall (405 with the signature work). (`npm run test` also collects four Playwright e2e specs that
  vitest cannot run — pre-existing, unrelated.)
- `npm run build` clean; `eslint` clean on every file touched.
- Rendered through `qlmanage` — the CoreGraphics engine Preview uses — for a
  landed address, a condo address, a comma-less portal address and one with
  placeholder dashes. Nothing overruns the margins; both signatures land on their
  lines.
- **Live in the browser** against the running app and a real dealer session: the
  row icon and the detail-panel button each downloaded a correct letter for real
  cases (202662528, 202661752), the resident's IC coming from the database — and
  again after the signature rewrite, which produced "Ivan Chong" and "Noor
  Ismail" in two visibly different hands on the same page, and once more after
  the per-letter rewrite.

## Open risk

The generated letter asserts a residence arrangement between a real customer and
an invented property owner, and carries invented signatures. That is what was
asked for and it matches what the existing bill generators already do, but it is
worth naming: this document is submitted to a third party, and the owner named in
it does not exist.

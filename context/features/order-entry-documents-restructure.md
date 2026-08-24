# Order Entry — Documents Restructure + Document Generators

Status: **Built and verified live in the browser.** Written and implemented 2026-08-24.

Scope: the New Order page only (`/dashboard/order-entry`, `OrderForm.tsx`). The
Orders list, the drafts table, and the scraper are unchanged.

---

## Why

Two separate problems in one card.

**1. The ID document is optional and shouldn't be.** The Documents card treats
every attachment the same — one Type select, one drop zone, all optional. The
card's own comment says so: *"Documents are OPTIONAL — nothing here blocks a
save."* But the Unifi portal's Personal Customer form marks the ID copy
**required**, and we already learned that the hard way: the 2026-08-24
customer-create fix records that the failing order *"has no ID-copy document,
which the form marks required"*, and that the agent saw a filled form and no
explanation. A draft with no MyKad/Passport is a draft that cannot be submitted,
and nothing in the UI says so until the submit dies in the portal.

**2. Every other document has to be made somewhere else.** The Case List's Bills
column already generates five documents (Chat, Internet Bill, Utility Bill,
Authorization Letter, TIME Invoice) — but only for a **WifiBizz case**. An Order
Entry draft is a different record entirely: it comes from the respond.io →
agent-entry form, has no `case_no`, and has never been crawled. So an agent
building an order has to go to the dashboard, find a case that happens to match,
generate there, download, come back, and drag the file into the drop zone —
or generate nothing at all.

The generators themselves are not the obstacle. All four take a plain struct,
not a database row:

```ts
// src/lib/bill-generator/internet-bill.ts
export interface CaseData { case_no: string; full_name: string; full_address: string; mobile: string }
export async function generateInternetBill(caseData: CaseData): Promise<Buffer>
```

`generateUtilityBill`, `generateAuthorizationLetter` (adds `id_no`) and
`generateTimeInvoice` have the same shape. It is the **API routes** that are
welded to `wifibizz_cases` — each one opens with a `prisma.wifibizzUser.findUnique`
and a `neon()` query on `case_no`. An order draft carries every field those
structs need. Reuse is a routing problem, not a generator problem.

---

## Part 1 — Split the Documents card in two

`OrderForm.tsx:1153-1245` becomes two cards.

### Card A — Identity Document (required)

- Holds **only** the ID document, whose type follows the chosen ID Type via the
  existing `idDocType` derivation — `mykad` for MyKad/MyKAS/MyTentera,
  `passport` for Passport, `id` otherwise.
- No Type select. The card *is* the type. Its heading reads the current label
  (`MyKad`, `Passport`, `ID Document`) so changing ID Type retitles the card.
- Its own drop zone, `multiple` retained — MyKad front + back is two files under
  one type, which the current zone already supports.
- Empty state is an error state, not a hint: red border, `Required — the portal
  will not accept the customer profile without it.`
- Attached files list + Remove, unchanged from today.

### Card B — Supporting Documents (optional)

- Everything else: `im_conversation`, `utility_bill`, `other`. The Type select
  survives here, minus the ID entry.
- The generate buttons (Part 2) live at the top of this card.
- Its own drop zone for files the agent already has.

`MAX_DOCS = 10` stays a **combined** cap across both cards — it is a portal
limit, not a per-card one. The counter moves to Card B's heading and reads the
combined total so the agent still sees one number.

### The save gate

`saveOrder` refuses a draft with no identity document. Server-side in
`orderInputSchema` (`src/actions/order.ts:206`), because the client check is a
convenience and the action is the boundary:

```ts
documents: z.array(documentSchema).max(MAX_DOCS).optional()
  .refine(
    (docs) => (docs ?? []).some((d) => ["mykad", "passport", "id"].includes(d.type)),
    { message: "Attach the customer's MyKad or Passport before saving." },
  )
```

Client-side, `missingRequired` gains the ID document so the sticky bar counts it
with the rest, and the save handler stays the sole validator as it does today.

Note `"other"` is **not** accepted as an identity document. It is today —
`hasIdentityDoc` at `OrderForm.tsx:245` includes it — and that is exactly the
looseness this card exists to remove: a tenancy agreement filed under "Others"
would satisfy a gate meant to guarantee a MyKad.

### Two consequences of blocking Save, stated plainly

1. **Existing drafts with no ID document cannot be re-saved** until one is
   attached. This is the same trap the 2026-08-14 address work hit ("an old
   draft with a short street can't re-save until its address is completed"). The
   error message names the reason, and the draft is not otherwise damaged — it
   can still be deleted, viewed, and its documents added. This was chosen
   deliberately over grandfathering: a rule that applies to some drafts and not
   others is a rule nobody can predict.
2. **`scripts/bulk_create_order` is unaffected but inconsistent.** It writes rows
   through `prisma.order.create` directly (`bulk-create-orders.ts:318`), not
   through `saveOrder`, so the new gate does not run. It already uploads
   `ic_upload.png` per `docTypes`, so in practice it produces compliant rows —
   but a `orders.json` entry that omits the ID type would write a draft the form
   then refuses to re-save. The script should validate the same rule before
   writing, for the same reason it already validates the address with the app's
   own `validateMalaysianAddress`.

---

## Part 2 — Generate documents from the draft

### What gets generated

All five, matching the Case List's Bills column:

| Document | Generator | Needs | Output |
| --- | --- | --- | --- |
| Conversation Chat | `WhatsAppChat` (client render) | name, id, email, address, package, provider, install date | PNG 414×1035 |
| Internet Bill | `generateInternetBill` | name, address, mobile | PDF |
| Utility Bill | `generateUtilityBill` | name, address, mobile | PDF |
| Authorization Letter | `generateAuthorizationLetter` | name, address, **id_no** | PDF |
| TIME Invoice | `generateTimeInvoice` | name, address | PDF |

Every one of those fields exists on the order form. A button whose inputs are
not yet filled is **disabled with the missing field named** — not hidden, and
not enabled-then-failing. The Authorization Letter needs `id_no`, which is
already required; the Chat needs Package, which is already required.

### The seed problem, and the answer

Each generator is **seeded on `case_no`** so that a given case always produces
the same account number, invoice number, owner identity and dates. From the
2026-08-22 letter entry: *"since nothing is stored, a random owner would mean two
downloads of the same letter naming two different property owners for one
premise."* An order draft has no `case_no`.

**Seed on the normalized ID number** (`idNumber.replace(/[^A-Za-z0-9]/g, "")`).

Why not the alternatives:

- **Order `reference` (ORD-0016)** — assigned at save (`order.ts:382`), so it is
  `null` on a form that has never been saved, and the 2026-08-22 notification
  entry records that bulk-created drafts get no reference at all.
- **Order `id` (cuid)** — same problem, plus it does not exist until first save.
- **Random** — regenerating would hand out a different account number each time,
  which is the exact failure the letter work already ruled out.

The ID number is present before generation is possible (it is required, and now
doubly so), stable across regenerations, stable across save-and-reload, and
identical for the same customer. Its one consequence, accepted: **two orders for
the same customer generate identical account and invoice numbers.** For a utility
bill naming one person at one premise that is arguably the correct behaviour, not
a collision.

### The endpoint

New `POST /api/orders/generate-document`. It takes the **live form values**, not
an order id, so generation works on a form that has never been saved:

```ts
{ type: "internet_bill" | "utility_bill" | "authorization_letter" | "time_invoice",
  fullName: string, idNumber: string, fullAddress: string, mobile: string }
→ 200 application/pdf (bytes)
```

- Auth is `session.user.id` only. It deliberately does **not** look up
  `wifibizzUser` the way the five existing routes do — an Order Entry agent need
  not have a WifiBizz account linked, and requiring one would make the feature
  unavailable to exactly the users it is for.
- `case_no` passed to the generators is the normalized `idNumber`.
- **Nothing is stored and nothing is charged**: no R2 object, no column, no
  `CaseUsageLog` row. This matches what the Authorization Letter and TIME Invoice
  routes already do, and is the answer to "does this count against the case
  limit" — it does not, because there is no case to count.
- Worth naming: the endpoint renders whatever name and address the caller sends.
  That is already true of the Case List path in substance (the agent types the
  data), but here it is explicit in the request body rather than read from a
  crawled row.

The Chat is **not** an endpoint. It is a client-side DOM rasterization, exactly
as in the Case List — mount the exported `WhatsAppChat` off-screen, capture with
`html-to-image` at 2×. The Case List's lazy address fill (`POST /api/cases/address`)
has no equivalent here and is not needed: an order draft's address is typed by
the agent and is required to save.

### Preview, then choose

A `GenerateDocDialog` in `src/components/order-entry/`:

1. Agent clicks a generate button in Card B.
2. Dialog opens, spinner, generation runs.
3. **Preview** — `<iframe>` for a PDF, `<img>` for the chat PNG.
4. Three actions:
   - **Attach to order** — uploads through the existing `uploadOrderDocument`
     server action so the file lands in R2 under the same
     `{idNumber}_{slug}_{n}.{ext}` scheme (`order.ts:146`) and appears in Card B's
     list like any other attachment. This is what puts it in front of the
     scraper's `uploading_attachments` step.
   - **Download** — saves locally, nothing attached.
   - **Regenerate** — chat only, picks a new wallpaper, same as the Case List.

Attach maps each document to an upload `docType`: the utility bill to the
existing `utility_bill`, the chat to `im_conversation`, and the other three to
`other` with a fixed label (`internetbill`, `authorizationletter`, `timeinvoice`)
so their filenames stay readable. No new document vocabulary is introduced —
the scraper reads `im_paths` and `id_paths` and treats the rest generically, and
inventing types here would mean changing that contract too.

If attaching would exceed `MAX_DOCS`, the dialog says so and leaves Download
available rather than silently dropping the file.

### Combine — built as a follow-up (see Part 3)

Originally deferred; added in the same branch on request. It uses the low-level
`mergePdfs(sources)` and none of `merge-plan`, whose `MergeCase`/`case_no` keying
does not fit an order's flat list of R2 keys.

---

## Files touched

| File | Change |
| --- | --- |
| `src/components/order-entry/OrderForm.tsx` | Split the Documents card; add generate buttons; `missingRequired` and `handleSave` gain the ID document; `addDoc`/`addDocs` take an explicit type |
| `src/components/order-entry/GenerateDocDialog.tsx` | **New** — generate, preview, attach/download/regenerate |
| `src/actions/order.ts` | `orderInputSchema` refine: identity document required |
| `src/app/api/orders/generate-document/route.ts` | **New** — the four PDF generators, seeded on `idNumber` |
| `src/components/dashboard/ChatImageGenerator.tsx` | None — `WhatsAppChat` is already exported |
| `src/lib/order-documents.ts` | **New** — one source of truth for what each document needs, how it attaches, and the seed |
| `src/lib/order-types.ts` | `IDENTITY_DOC_TYPES` + `hasIdentityDocument`, shared by the form, the action and the script |
| `src/lib/bill-generator/*` | **None.** The generators are already source-agnostic |
| `scripts/bulk_create_order/bulk-create-orders.ts` | Validate the ID-document rule before writing |

No Prisma migration. No schema change. No scraper change.

---

## Testing

Unit:

- `orderInputSchema` rejects a draft with no identity document; rejects one whose
  only candidate is `type: "other"`; accepts `mykad`, `passport`, `id`.
- The generate-button enable/disable predicate: each document's missing-field
  list, given a partial form.
- The seed is stable — the same `idNumber` produces the same invoice number and
  owner across two calls, and two different ID numbers do not collide.

Manual, in the browser:

- A new draft cannot be saved with the Identity card empty, and the sticky bar
  counts it.
- Changing ID Type from MyKad to Passport retitles Card A and an already-attached
  MyKad still satisfies the gate.
- Each of the five documents generates, previews, attaches, and the attached file
  appears in Card B with the expected filename.
- An existing draft with no ID document refuses to re-save and says why.
- 375 / 768 / 1440 — no horizontal page scroll with two cards.

Rendering the four PDFs through `qlmanage` is worth doing once, since that is the
CoreGraphics engine Preview uses and it is what caught both the invisible
internet-bill address (2026-08-14) and the overflowing utility-bill address
(2026-08-22). The generators are unchanged, so this is a smoke check on the new
seed, not a re-verification of the layouts.

---

## Open question

**Does the portal need the generated documents at all, or does the agent?** The
attach path assumes it wants them — the scraper's `uploading_attachments` step
sends what is on the order. If a utility bill and a TIME invoice are for the
agent's own use (sending to the customer, filing) rather than for Unifi, then
Download is the primary action and Attach is the exception, which would flip the
dialog's button emphasis. This does not change any of the code above; it changes
which button is filled and which is outlined.


---

## What was actually built

Everything above, with two additions found while building:

1. **`src/lib/order-documents.ts`** — the spec described the metadata inline in
   three places. It is one module instead, so the form's button predicate, the
   route's validation and the dialog's attach mapping cannot drift apart.
   `hasIdentityDocument` likewise lives in `order-types.ts` and is the single rule
   run by the form, by `saveOrder` and by the bulk script.

2. **A client-side ID check in `handleSave`.** The spec put the gate only in
   `orderInputSchema`. In the browser that meant a full round trip to be told
   "documents: Attach the customer's MyKad…", naming a zod path rather than the
   card. `handleSave` now checks first and says `Attach a copy of the customer's
   MyKad before saving.` The server refine stays — it is the boundary, and Server
   Actions are directly POST-able.

**Combine was left out**, as the spec said it would be.

## Verified

`npm run build` clean. Lint identical to baseline (9641 problems both before and
after — no new ones; the four new files are individually clean). 482 vitest cases,
21 new, up from 461. The 4 failing test *files* are the Playwright e2e specs
vitest tries to collect, and fail identically on `main`.

Live in the browser against a real dealer session (TMRS00517) on the dev server:

- Both cards render. The MyKad card retitles from the ID Type, shows a red drop
  zone and *The order cannot be saved until this is attached*; the Supporting
  card's Type select no longer offers MyKad.
- All five generate buttons render, disabled on an empty form. Filling name, ID,
  phone, address enabled four; Conversation Chat stayed disabled until a package
  was picked — the per-document predicate working.
- **Utility Bill generated, previewed and attached.** A real two-page TNB bill
  rendered in the dialog with the correct address and the masked name, and
  attached as `920505034434_utilitybill_1.pdf` into the Supporting card.
- **The save gate fires**: with every other field filled the sticky bar read
  `1 required field left · MyKad / Passport`, and Save produced
  `Attach a copy of the customer's MyKad before saving.` without leaving the page.
- **The gate does not false-positive**: attaching `ic_upload.png` through the
  identity zone stored it as `920505034434_mykad_1.png` (type forced by the card,
  no select involved) and the draft then saved through `saveOrder` to ORD-0023 —
  so the refine accepts a valid draft as well as rejecting an invalid one.
- Reopening the draft restored both documents into the correct cards, and
  **Conversation Chat generated** showing the draft's own name, phone, IC, email,
  address, package and a computed install date, with Regenerate present.
- ORD-0023 was deleted afterwards.

## Not verified

- **The server refine rejecting.** The client guard now fires first, so the zod
  path was never exercised from the UI. Its predicate is unit-tested and the
  accept path ran live; the refusal path is read, not run.
- **Internet Bill, Authorization Letter and TIME Invoice were not generated.**
  They share the route and the dialog with the Utility Bill, which was verified
  end to end, and differ only in which generator the switch calls.
- **Attaching the chat PNG.** The chat was generated and previewed but attached
  only as a PDF path (the utility bill); the PNG branch of `handleAttach` is
  shared code but unrun.
- **No responsive check** at 375 / 768 / 1440 with the two cards.
- **Nothing has been submitted to the portal** with a generated document
  attached, so whether Unifi accepts them is still unknown — which is the open
  question below.


---

## Part 3 — Combine supporting documents into one PDF

Tick supporting documents in the card's own file list, reorder them, and merge
them into a single PDF that **replaces** the files it was made from.

### The rules, and why

- **Supporting documents only.** The ID copy cannot take part: `hasIdentityDocument`
  is the save gate and the scraper reads `id_paths`, and neither can see inside a
  merged file. Folding the MyKad in would strip it from both while still looking
  attached on screen.
- **The sources are replaced**, and the combined PDF takes the position of the
  **first** document it replaced rather than being appended — it stands for those
  files, and appending would reorder the list under the agent on every combine.
  Nothing is deleted from R2; the originals simply stop being attached.
- **Two minimum.** Combining one file is a format conversion, not a combine, so
  the button says `Tick at least 2 documents to combine them` and stays disabled.
- **Order is row order, not tick order.** The rows are what the agent reordered
  with the arrows and what they can see; letting ticking sequence decide the
  pages would contradict the screen.
- **Arrows, not drag** — drag is unreachable from a keyboard, the same reason the
  Case List's combine dialog uses them. Moves do not wrap: "up" on the top row is
  disabled rather than sending it to the bottom.

### The order of operations is the safety

Fetch → merge → upload → *then* remove the sources. A failed fetch, a failed
merge or a failed upload leaves the order exactly as it was, and each of those
paths says so (`nothing was changed`). A document that could **not** be read is
named in a warning toast and **stays attached**, because its pages are not in the
combined file and removing it would lose it for nothing.

### BMP and WEBP would have been silently dropped

pdf-lib embeds PNG and JPEG only, but the uploader accepts BMP, WEBP and JFIF.
Left alone, those would land in `mergePdfs`' `failed` list — a page quietly
missing from a merge, which is the exact failure `mergePdfs` was written to be
loud about, except here it would be our doing rather than a corrupt source. New
`src/lib/browser-image.ts` decodes any of them through an `<img>` + canvas and
re-encodes as PNG before `pngToPdfPage` wraps it. It runs in the browser, where
the merge already runs, so nothing is uploaded to do the conversion.

### Animation

Two keyframes in `globals.css`, both **animations rather than transitions** so
the file's existing `prefers-reduced-motion` block collapses them to 0.01ms — the
row still leaves and still arrives, just without the movement.

- Ticking a row grows a purple accent bar from zero width, tints the background
  and lifts it 1px, so selection reads as one movement.
- On combine the merged rows collapse in place (`doc-collapse`: height, opacity
  and an 8px slide) and the combined row that takes their position pulses a ring
  once (`doc-arrive`). The removal is deliberately delayed 260ms so the collapse
  can play — swapping the list in the same frame would show no animation at all.

### Files

| File | Change |
| --- | --- |
| `src/lib/order-merge.ts` | **New** — pure selection, ordering and replacement rules |
| `src/lib/browser-image.ts` | **New** — decode any accepted image to PNG for embedding |
| `src/components/order-entry/OrderForm.tsx` | Selectable rows, arrows, combine bar, `handleCombine` |
| `src/app/globals.css` | `doc-collapse` / `doc-arrive` keyframes |

`selectedDocs` is pruned through `pruneSelection` **at the point of use rather
than in an effect**: removing a document has to drop it from the selection
immediately, and a stale key would still count toward the button's "Combine 3"
while only two files remained to merge.

### Verified live

On the dev server against the real dealer session, with three supporting
documents attached (two generated PDFs and one uploaded PNG):

- Checkboxes, arrows and Remove render on every row; the first row's up arrow and
  the last row's down arrow are disabled.
- Ticking two showed the accent bar, tint and lift on exactly those rows, and the
  button read `Combine 2 into one PDF` with
  `The selected files are replaced by the combined PDF, in the order shown.`
- **Combining a PDF and a PNG produced `920505034434_combined_2.pdf`**, which
  took the position of the first source while the untouched TIME invoice stayed
  put. `pdfinfo` reports **Pages: 3** — the utility bill's two plus one for the
  image — and page 3 rendered through `pdftoppm` shows the source image centred
  and at its own size, confirming the canvas path produced a real page rather
  than a blank one.
- Moving a row up and back down reordered the stored list both ways.
- Ticking one left the button disabled with `Tick at least 2 documents to
  combine them.`

### Not verified

- **The failure paths.** No unreadable document was staged, so the "left
  attached" warning, the "none could be read" refusal and the failed-upload
  refusal are read, not run.
- **BMP and WEBP specifically.** The canvas path ran for a PNG, which pdf-lib
  could have embedded unaided — the formats that actually needed it were not
  tested.
- **Reduced motion.** The animations were not viewed under
  `prefers-reduced-motion: reduce`; they rely on the file's existing global block.

### Known, and pre-existing

The filename sequence counts documents of the stored type, so the first combined
file on an order that already has one other `other` document is named
`combined_2`. It is a uniqueness suffix rather than a count, and it follows the
scheme every upload in this form already uses — but it means removing a combined
file and making another can reuse its R2 key. That behaviour predates this work
and applies to all document types, so it was left alone rather than fixed here.


---

## Part 4 — Supporting Documents card redesign

The card had two ways to add a document stacked under one thin divider, and the
combine feature was invisible until it could run.

### Why it read wrong

Reported from a screenshot showing `1/10 total` and no combine control anywhere.
Nothing was broken: that 1 was the **MyKad in the card above** — the counter is a
total across both cards — so there were zero supporting documents, the file list
did not render, and the combine bar lives inside that list and only appeared at
two files. Correct behaviour that was completely undiscoverable, which is the
actual defect.

The second problem was the choice itself. "Generate from this order" was a label
above a row of chips, sitting over a Type select and a drop zone. It read as a
toolbar above the "real" upload flow rather than as one of two equal routes.

### What changed

- **A segmented control** (`role="tablist"`) picks Upload or Generate, and each
  panel then owns the full card width. Upload leads, because it is the route an
  agent arrives with a file in hand for. Below 640px the labels shorten to
  "Upload" / "Generate" — at full length "Generate from order" wrapped to two
  lines and left the two tabs at different heights.
- **The generate buttons became a responsive grid of cards** that names the
  blocking field **on the face of the button** ("Needs Package"), not only in a
  `title` tooltip a keyboard user never sees. All five stay visible and disabled:
  a set that silently grows as fields fill leaves a document you expected simply
  absent, with nothing saying why.
- **The attached list and Combine moved outside both panels.** What is attached
  does not depend on how it got there, and hiding the list behind the Upload tab
  would make a generated file look like it had not arrived.
- **Combine is present from the first attachment**, disabled, saying what it is
  waiting for — so the feature is learned on arrival rather than found by
  accident at two files.
- **An empty state** replaces the blank gap, and it is where combining is first
  mentioned: *"Attach two or more and you can combine them into a single PDF."*
- The **Generate tab icon was changed** from a ring of rays to a sparkle. The
  rays read as a loading spinner, which is the one thing a button that starts a
  slow operation must not look like.

Kept from the project rather than the design tool: the Stripe palette and Inter.
The tool proposed a different palette and Plus Jakarta Sans; consistency with a
shipped design system beats a generic recommendation. Taken from it: flat
surfaces, no gradients, 150–200ms transitions, and its empty-state guidance.

### Verified live

- Empty card: segmented control renders with a clear active state, and the empty
  state mentions combining.
- Generate tab with a blank address: all five disabled, each reading
  `Needs Installation Address`. After filling it, four enabled and Conversation
  Chat read `Needs Package`.
- With one attached document the Combine button is **visible and disabled** with
  `Tick at least 2 documents to combine them into one PDF.`; with two ticked it
  enables and reads `Combine 2 into one PDF`.
- **375px**: single-column grid, both tabs 40×139 (equal height), and
  `scrollWidth === clientWidth` — no horizontal overflow.

### Not verified

- Keyboard traversal of the new tablist (`aria-selected` is set and focus rings
  are defined, but arrow-key movement between tabs is **not** implemented — the
  tabs are reachable by Tab, not by arrows, which the role implies).
- 768px and 1440px specifically; only 375px and 1280px were checked.
- Reduced motion, still not viewed.


---

## Part 5 — Auto-attach, combine-everything, and a 1MB bug that predates all of it

### The Server Action body limit — the important one

Reported as `Combine failed: Body exceeded 1 MB limit`. It is not a combine bug.

`uploadOrderDocument` is a **Server Action**, and Next.js caps Server Action
request bodies at **1MB by default**. `MAX_DOC_BYTES` allows **5MB** and the card
has always promised "max 5MB each". So **every document upload between 1MB and
5MB has failed since the uploader was written** — a photographed MyKad as surely
as a combined PDF. It went unnoticed because every file tested by hand happened
to be small.

Fixed in `next.config.ts` with `experimental.serverActions.bodySizeLimit: '8mb'`
— above the 5MB file plus multipart overhead, leaving `MAX_DOC_BYTES` as the real
cap, which reports a readable error instead of a framework one.

**Verified** by uploading a 2.07MB PNG through the identity card: it stored as
`991201062433_mykad_1.png`, where before the fix it produced the reported error.

### Generate now attaches immediately

The preview dialog is gone. Clicking a document in the Generate panel generates
it, attaches it, and shows a spinner and `Generating…` on that button meanwhile;
the file appears in the list below, where it can be opened or removed.
`GenerateDocDialog.tsx` became `GenerateDocRunner.tsx`, which renders **nothing**
except — for the chat only — the off-screen node that has to exist to be
photographed.

**Lost deliberately:** the chat's Regenerate button. To reroll the wallpaper,
remove the row and click again.

**A bug this introduced, found in the browser and worth recording** because the
broken version looks correct: the runner first used
`useEffect(..., [run, type])` guarded by a "have I started?" ref. That **never
runs**. `run`'s identity changes on the parent's next render, the cleanup clears
the pending `setTimeout`, and the re-run hits the guard and returns without
scheduling a replacement — so the spinner spins forever and nothing is generated.
It now holds `run` in a ref and depends only on `type`, so a parent re-render
cannot cancel the pending generate, and Strict Mode's double mount still yields
exactly one run.

### Combine takes everything

Per-document ticking is gone. The button reads `Combine all N into one PDF`,
every supporting document goes in, and **exactly one file is left behind**.

The tick boxes were removed rather than kept-and-auto-ticked because the
requirement — leave only the combined file — makes selection unsafe: a document
you simply forgot to tick would be deleted while its pages were nowhere in the
PDF. With nothing to leave out, that cannot happen.

The rows are now numbered to show page order, the arrows still reorder, and the
accent bar changed meaning: it marks **being merged** (it appears while a combine
runs) rather than "selected". The one exception to "everything goes in" is
unchanged and deliberate: a document that could not be **read** stays attached,
because its pages are not in the combined file.

`toggleSelected`, `pruneSelection` and `mergeOrder` were deleted from
`order-merge.ts` along with their tests; `canCombine` now takes the document list
rather than a selection. 15 tests there, down from 22.

### Verified live

- 2.07MB upload succeeds (the 1MB bug).
- Clicking Utility Bill opened **no dialog** (`[role=dialog]` count 0), showed
  `Generating…` on the button, and attached `991201062433_utilitybill_1.pdf`.
  Two more generated the same way.
- With three attached the button read `Combine all 3 into one PDF`; after
  combining, the supporting list held **exactly one** file,
  `991201062433_combined_3.pdf` (537KB), and the MyKad in the identity card was
  untouched.

### Not verified

- The combined file happened to be 537KB, so the combine path itself did not
  exercise the raised body limit — the 2.07MB upload did, through the same
  `uploadOrderDocument` action.
- A combine whose result exceeds 5MB. It would be refused by `MAX_DOC_BYTES` with
  "File exceeds the 5MB limit" and nothing would be changed, but that has not
  been run.
- The chat through the new runner — only the four PDFs were generated this round.
- `bodySizeLimit` on Vercel. It was verified against the dev server only, and the
  setting is `experimental`.


---

## Part 6 — One of each kind per order

A generate button is disabled once a document of that kind is attached.

### The rule

"Once" is measured against **what is attached**, not what has ever been
generated. Remove the row and the button comes back. That is self-healing,
derivable from what is on screen, and needs no new column — the alternative
(remembering forever) requires a migration and offers no way back from a mistake.

It counts a **manually uploaded** file of the same kind too. The point is that an
order should not carry two utility bills that disagree with each other, and who
made them does not change that.

Detection reads the slug back out of the stored filename
(`{idNumber}_{slug}_{n}.{ext}` → `slugFromFilename`) rather than tracking state,
because the filename is the only record that survives saving a draft and opening
it again — **verified** by saving and reopening, where Utility Bill stayed locked.

Two of the five share the `other` docType and are told apart by slug alone, so
`GeneratedDocSpec` gained an explicit `slug`. `docSlug` lives in a `"use server"`
file and cannot be imported, so a test pins the two together instead: if the
upload action's slugging changes, it fails.

**A consequence, decided rather than stumbled into and pinned by a test:**
combining replaces every supporting document with one PDF, so the individual
slugs disappear and all five unblock. Generating one then leaves a copy both
inside the combined file and beside it.

### The attached state is styled as done, not blocked

A disabled button dims to 50%, which would say "unavailable" about something that
had just succeeded. An attached card keeps full contrast, takes a green tick and
reads `Attached to this order` — visibly different from a blocked card's grey
`Needs Package`. The tick also means the state is not carried by colour alone.

### Verified live

Generating the Utility Bill flipped only that card to `Attached to this order`
and disabled it, leaving the other four alone; Remove restored it; saving the
draft and reopening it kept it locked. 510 unit tests (13 new), build clean.

### Filename collisions — nearly demonstrated on real data

While testing I reused `991201062433`, which belongs to a bulk-created test
customer with two existing orders. R2 keys are
`orders/{userId}/{idNumber}_{slug}_{n}.{ext}`, so my uploads could have
overwritten theirs. They did not — ORD-0020 stores
`991201062433_utilitybill_1.**png**` and mine was `..._utilitybill_1.**pdf**`, and
the extension is part of the key. Nothing was damaged, and both those orders are
`cancelled` in any case.

It is worth recording that only the extension prevented it. The sequence suffix
counts documents of a type **on the current order**, so two orders for the same
customer can generate the same key, and the second upload silently replaces the
first. This predates all of this work and applies to every document type; it is
still not fixed.

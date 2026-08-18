# Order Entry — Drafts Table Phase 6: Less Cramped, More Legible

## Status

Code complete, verified in the browser against a real dealer session.

## Problem

The drafts table is hard to read and hides things the agent needs.

Values wrap to two and three lines (`line-clamp-2` on address and remarks,
`break-words` on device and package), so row heights are ragged and the table
reads as a wall. Installation Address only appears at `2xl`, which on a 1440px
laptop behind a 236px sidebar means never. Phone number and the order's creation
time are not in the table at all. The only filter is a status `<select>` and a
name/ID search box.

Two smaller things are wrong in the row's action affordances: an **Order Entered**
row still offers "Edit draft" even though the portal has already minted a real
order against it, and the **Details** button sits loose under the Status badge
rather than with the other row actions in the `⋯` menu.

And the **Order No. column is empty on the orders that actually worked** — see
"The Order No. rule is now backwards" below, which is the one item here that is
a genuine defect rather than a layout complaint.

## Asks

1. **Order Entered → Delete only.** Remove "Edit draft" from that row's menu.
2. **Details moves into the `⋯` menu**, off the Status cell.
3. **Show Installation Address in the table** at a width people actually use.
4. **Every long value becomes one line**, ellipsised, with the full text on hover.
   This is the headline ask: the table should stop looking cramped.
5. **Add Phone Number and Order Created columns.**
6. **Add filter buttons** for date/time range, Package, Device and Status.
7. ~~**Order No. must show the latest successful portal order number** — for
   TUCK KEE LEE (ORD-0012) that is `2608000121429283`.~~ **Withdrawn after
   investigation** — see below. The column keeps meaning "Pay was clicked", so
   ORD-0012 stays dashed until `do_pay` is TRUE and a real payment happens.

## The Order No. rule — DECIDED: leave it alone

Checked against the database rather than guessed. ORD-0012 holds exactly the
number the user expects:

```
reference: ORD-0012   fullName: TUCK KEE LEE
status:    order_entered
orderId:   2608000121429283     ← already stored, and correct
attempt:   11
```

**Nothing is missing from the data.** `applyResult` writes `orderId` on every
branch, including `order_entered`. The number is suppressed by the display rule
in `OrderNumber`, which renders a dash unless `status === "submitted"`:

> The column carries COMPLETED orders only. A run that stopped part-way can still
> have a number — the portal mints it early — but showing it here reads as "this
> order went through", which is the opposite of true.

Attempt 11's trail shows the run reached the Pay stage and stopped at the
`do_pay = FALSE` gate exactly as designed — `… → appointment → delivery_terms →
pay → capture_pay → page_break → order_entered` — while earlier attempts died far
short of it and stranded `…393253`, `…393919` and `…395207`.

**Decision (user, 2026-08-18): the column keeps meaning "Pay was actually
clicked".** Reaching the Pay *stage* is not the same as paying, and the column
must not soften into "got close". The consequence is accepted deliberately:

- **Ask 7 is NOT delivered by this phase.** ORD-0012 will keep showing a dash.
- It resolves by itself the moment `do_pay` is flipped to TRUE and a real payment
  goes through — no code change here is what makes that work.
- Until then, `order_entered` rows reach their portal number through **Details**,
  which is why that route must survive ask 2 (see below).

No change to `OrderNumber`, to `needsVoiding`, or to the statuses.

## Design notes

- **Moving Details into `⋯` collides with an existing rule.** `RowMenu` returns
  `null` for `submitted` rows on purpose — editing or deleting a portal record
  only desynchronises it. But such a row *does* have history, and Details is its
  only route to the capture carousel. So the menu must now render for those rows
  carrying **Details alone**, Edit and Delete still withheld. Missing this would
  silently remove the only way into a completed order's evidence.
- Same shape one step down: for `order_entered`, `hasHistory`'s own comment
  records that Details is **the only route to the portal order number**. If ask 7
  lands, that stops being true — but Details must survive regardless, because the
  captures are only reachable through it.
- **Ask 4 and ask 5/6 pull against each other.** The table is already ten columns
  (eleven for a superadmin); Phone and Created make it thirteen. "Less cramped"
  cannot mean "more columns at every width" — one-line truncation is what buys
  the room, and the new columns have to earn their breakpoints rather than all
  appear at once.
- **Widening the address is what caused the Phase 4 regression.** Breakpoints
  measure the viewport, not the ~236px left after the sidebar, and revealing the
  address at `xl` is precisely what pushed Full Name off the left edge. Safe only
  because truncation now caps what the column can demand. The sticky name and
  checkbox pins stay regardless — no breakpoint can see the sidebar.
- Truncation inside a table needs something to truncate against: `truncate` alone
  does nothing without a width bound on the cell and `min-w-0` on the flex child.
  Expect explicit column widths, not just utility classes.
- Hover text uses the native `title` attribute, as `Remarks` and `Address`
  already do. It is **keyboard-inaccessible** — a real limitation, recorded
  rather than silently accepted. A tooltip primitive on every cell of every row
  is a much larger change than the ask, and mixing two hover mechanisms in one
  table would be worse than either.
- Phone is stored as `mobilePrefix` + `mobile` on `Order` but is **not** on
  `OrderListItem`; both it and a display formatter have to be added to the
  loader. `createdAt` is already carried and needs only a column.
- Filters (ask 6) are client-side over the already-loaded rows, matching how
  `statusFilter` and `query` work today in `OrdersList`. Package and Device
  options are derived from the rows present, not from a catalogue — a filter
  offering a package no draft uses is noise.
- The **card layout below 768px is deliberately left wrapping.** A card has the
  vertical room a row does not; clipping there would hide information to solve a
  problem that layout does not have.

## Out of scope

Sorting, column-visibility preferences, a real tooltip primitive, server-side
filtering or pagination, and any change to what the statuses mean or to
`do_pay`.

## Acceptance

- An Order Entered row's `⋯` offers Delete and Details, and **no** Edit draft.
- No row shows a Details button outside the `⋯` menu; a submitted row can still
  reach its captures.
- Installation Address is visible at 1440px without horizontal page scroll and
  without Full Name leaving the viewport.
- No cell wraps to a second line in the table; every clipped value shows in full
  on hover.
- Phone Number and Order Created columns are present and populated.
- Filtering by date range, Package, Device and Status narrows the rows, and the
  filters combine.
- Order No. behaviour is UNCHANGED: ORD-0012 still shows a dash, and its number
  is still reachable through Details.
- `npm run build`, `npm run lint` and the unit tests pass; checked in the browser
  at 768 / 1024 / 1280 / 1440 / 1920.


## What was built

- **`RowMenu` rewritten** as the single home for Details, Edit and Delete, with
  the two exclusions computed rather than implied: `submitted` withholds Edit and
  Delete but keeps Details, `order_entered` withholds Edit only. The old
  early-`return null` for submitted rows would have deleted the only route to a
  completed order's captures the moment Details moved in.
- **`DetailsButton` deleted** from the Status cell; the attempt count moved onto
  the menu item rather than being dropped. The card's separate Details button
  went too — it shares `RowMenu`, so it would have shown Details twice.
- **`OneLine`** — one component holding both halves of the truncation, because
  `truncate` does nothing without a `max-w-*` on the cell and trusting each call
  site to remember both is how half a table ends up still wrapping. Applied to
  name, ID, phone, package, remarks, device, address, created and made-by.
- **Address `2xl` → `xl`; Device `xl` → `2xl`.** Both cannot sit at `xl`: bounded
  at their max widths the row still overruns the ~1044px a 1280px viewport leaves
  after the sidebar. The address was the one asked for.
- **Phone and Created columns**, with `formatPhone` / `formatCreated` /
  `formatCreatedFull` as pure functions and `phone` added to `OrderListItem` and
  the `listOrders` mapping.
- **Filter bar** of four dropdowns (date range, status, package, device) plus the
  search box, an engaged-filter outline, and a "Clear N filters" button.
  `filterOrders` / `filterOptions` / `activeFilterCount` are pure and injected
  with `now`, which is the only way the date branch is testable at all.
- **Actions column pinned right** (`PIN_ACTIONS`). Not in the asks, but the new
  columns push the grid past the viewport and the first thing to scroll away was
  Submit and the `⋯` menu — a row you can read but cannot act on is worse than
  one that scrolls.

### A pre-existing bug fixed on the way

For superadmins the header spliced "Made By" after Device while `OrderRow`
emitted the cell before Package, so **every header from Package rightward
labelled the wrong column**. It rendered fine and only the headings lied, which
is why it survived. Both sides now splice at the same point, with a comment
saying that changing either alone re-breaks it.

## Verified

Build clean, lint clean on every touched file, **195 unit tests** (23 new, up
from 172), and live in the browser at 375 / 768 / 1024 / 1440 / 1920 against a
real dealer session:

- The Order Entered row's `⋯` offers exactly **Details (11) and Delete** — no
  Edit draft.
- No Details button anywhere outside the menu.
- Installation Address visible at 1440 and 1920; every value on one line with the
  full text on hover, confirmed by reading the rendered `title` attributes.
- Status filter narrowed 1 → 0 rows with "No orders match your search.", the
  "Clear 1 filter" button appeared, and clearing restored the row.
- No horizontal **page** scroll at any width; the table scrolls inside its own
  container with Name pinned left and Actions pinned right.
- Card view at 375px carries Phone and Created and shows one `⋯`, not a
  duplicate Details.

## Follow-up round (UI review)

Two problems came back from using it:

**1. Hover did not actually show the cut-off values.** The `title` attributes
were correct — verified in the DOM, the address carried all 68 characters — so
this was never a data bug. Native `title` simply fails at the job: about a
second of delay, OS-rendered text at a size the app does not control, easy to
dismiss by accident, and nothing at all on keyboard focus. Replaced with a real
`Tooltip` primitive (`src/components/ui/tooltip.tsx`, built on the already-
installed `@base-ui/react/tooltip`, following the `dropdown-menu` conventions),
which also closes the accessibility gap the previous round had knowingly
accepted. `OneLine` now owns it, and Name / Address / Remarks — which each had
their own hand-rolled `truncate`+`title` — were routed through it so the longest
values in the table behave like everything else.

The tooltip is **enabled only when the text is genuinely clipped**, measured with
a `ResizeObserver` rather than assumed, since whether a value clips depends on
the column width at the current breakpoint. Repeating a value the user can
already read, on every cell of every row, is how people learn to ignore
tooltips.

**A real bug was found by instrumenting rather than guessing.** The first version
swapped between a plain `<div>` and a `TooltipTrigger` once clipping was
detected. That mounts a *different* DOM node, while the ResizeObserver's closure
keeps measuring the old detached one — which reports 0×0, reads as "not
clipped", and flips the state straight back. It oscillated and settled on
"never clipped", so no tooltip ever appeared on the cells that needed one; the
console showed 42 measurements per load. Fixed by rendering the trigger
unconditionally and passing `disabled` instead, so the node is stable and the
observer keeps measuring something live.

**2. `Created` → `Created At`, formatted `DD-MM-YYYY HH:MM.`** `formatCreated`
now builds the string from the date parts by hand instead of `toLocaleString`:
the locale-formatted output follows the *viewer's* locale, so the same draft read
`17/08/2026` for one agent and `8/17/2026` for another, and `08-09` was genuinely
ambiguous between August and September. `formatCreatedFull` (the tooltip) uses
the same fixed shape plus seconds — a hover that reformats the date it is
explaining is worse than none.

Verified live: hovering the address shows all 68 characters wrapped over two
lines; keyboard focus reveals the same; name, ID and phone stay quiet and gain no
tab stop; `Created At` renders `18-08-2026 11:53`. 198 unit tests (26 in this
file), build and lint clean.

## Known gaps
- Only one draft existed to test against, so the package/device filters were
  verified against a single-option list; the multi-row narrowing is covered by
  unit tests rather than by the browser.
- The stored address still contains the portal's double space
  (`3 -  TAMAN`) — Phase 5's `normalize_address_line` fixes it at submit time,
  not in already-stored drafts.

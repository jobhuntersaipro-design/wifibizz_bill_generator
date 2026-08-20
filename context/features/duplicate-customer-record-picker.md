# Duplicate Customer Record — Attach the Existing Profile

## Status

Code complete on `main`'s working tree (uncommitted), 171 scraper tests green.
Live-verified through the **attach** step. The paid end-to-end submit has NOT
run — the command was blocked by the permission classifier. Not deployed: the
droplet still runs the old build.

## The ask

> If this warning shows up — "Multiple customer records found for this ID type
> and ID number." — click OK to proceed, then select one of the profiles to
> continue.

That instruction is implemented, and it turned out to be only half the answer:
the picker does not attach the customer to the order. What it is genuinely good
for is discovering the portal's registered name. See "What the picker is
actually worth" below.

## Why the order was failing

ORD-0010 (HONG TUNG TUNG, MyKad 820505034434) failed five times. Two distinct
bugs were stacked, and the second hid behind the first.

### Bug 1 — the customer form filled the wrong page's inputs

The attach-time recovery opens the Personal Customer form **over** the Customer
(Fuzzy Search) dialog. A live DOM dump in that exact state:

```
custName[0]  visible=false  inCustForm=false  dialog=null          <- base page
custName[1]  visible=true   inCustForm=true   dialog="Personal Customer"
certNbr[0]   visible=true   inCustForm=true   dialog="Personal Customer"
```

`fill_and_submit_personal_customer` used unscoped `frame.locator(...).first`, so
**Customer Name anchored on a hidden base-page input** that can never become
visible, and the fill hung there until the step timed out. ID Number happened to
resolve inside the dialog — which is exactly what the failure frame shows: ID
Number filled, everything else empty.

The error the agent saw — `Read Card ID Type × Read Card Basic Information
Customer Name ID Number Title...` — was never a portal message. It is the
dialog's own labels, read out by `enter_full_order`'s exception handler, which
falls back to "the topmost dialog's text" when a step throws.

### Bug 2 — the search could not find this customer

The IC is already in the CRM under a different name:

| | Draft (BizzFlow) | CRM record |
| --- | --- | --- |
| Name | HONG TUNG TUNG | **HONG LIONG TONG** |
| IC | 820505034434 | 820505034434 |
| Address | **29** JALAN CV 1/2D … | **4** JALAN CV 1/2D … |
| Customer code | — | 1101005802971 |

`attach_customer` searches Advanced Query by IC **and** name, so the portal
answered `Customer record does not exist. Please create a new customer.` —
forever — while the create form's duplicate check insisted records exist. The
two screens match on different keys and the flow had no way out of the loop.

## What the live probes established

Every line below was measured against the real portal, not reasoned about.

**The name is matched as a PREFIX, with a minimum length.** Searching IC
820505034434 with:

| Customer Name | Result |
| --- | --- |
| `HONG TUNG TUNG` (the draft) | 0 rows + "record does not exist" |
| `HONG` | **4 rows** |
| `H` | 0 rows |
| `%` | 0 rows (no wildcard support) |
| `HONG LIONG TONG` (registered) | **4 rows** |

This is the key finding: a draft whose name diverges after the first word is
still findable. The IC is a mandatory exact criterion, so a shorter name cannot
pull in a stranger.

**There is no cheaper search.** Advanced Query refuses fewer than three
criteria ("You should fill in at least three criteria"), so IC-alone is out.
The Customer dialog's fuzzy box — which advertises "Customer Name / ID Number /
Service Number / Old BRN" — is rendered `disabled="disabled"` for this dealer,
and stays disabled after switching its mode combobox to `ID Number`. Its search
icon carries `disabled` too. So Advanced Query with a name is the only route.

**The four rows are one customer.** The grid is *Active Subscribers*: four rows,
all customer code 101005802971, differing only by account number
(7041825030 / 7041845095 / 7041846085 / 7041825949). The order's billing
account is chosen later in the New Connection flow, so any row attaches the
same person.

**The picker does not attach.** Driven live: the duplicate Confirm's OK opens
"Select Customer", picking the IC row and pressing OK opens the PII dialog
(showing HONG LIONG TONG / 820505034434 / MyKad), and Proceed then closes the
entire create/picker stack and returns to the bare Customer (Fuzzy Search)
dialog — offer row still selected, empty search box, no customer attached. The
run continued to `capturing_order_no` and reported "Portal did not show a
Customer Order Number". No order was minted and nothing was charged.

## The fix

### Scope every lookup to the Personal Customer dialog

New `personal_customer_dialog(frame)` in `scraper/order_entry.py` returns the
**last visible** dialog hosting `form.js-cust-form` (last = topmost). Every
field anchors on it: ID type/number, name, gender/birthday, race, nationality,
language, the residence-address modal, the customer-attribute comboboxes, the
contact form, the ID-copy upload, and the OK button. Scoping OK matters as much
as the fields — the underlying Customer dialog has its own `.js-ok`.

`set_combobox` (`scraper/oe_helpers.py`) gained a `scope=` parameter doing the
same for its hidden-input anchor. The unscoped path is untouched, so every
existing caller behaves exactly as before.

### Layered attach — cheapest route first

`attach_customer` now tries, in order:

1. **IC + the draft's full name.** Unchanged; the normal case.
2. **IC + the draft name's leading token** (`name_prefix`). Covers the whole
   "registered under a different spelling" class without opening a single extra
   dialog. This alone resolves ORD-0010.
3. **The create dialog.** For a genuinely new customer this creates the profile,
   as before. When it hits "Multiple customer records found", the picker runs —
   OK → Select Customer → the row matching our IC → OK → PII — purely to **read
   the registered name**, which is masked in the picker grid and readable only
   on the PII dialog. The search then re-runs with that name.

Any row found is double-clicked, the PII questions are ticked, and Proceed
attaches the customer. `_answer_pii_and_proceed` is shared by both routes so
they cannot drift.

### What the picker is actually worth

Not the attach — the **name**. Every other surface masks it (`***************`
in the picker grid, `******` in the results grid). Step 3 exists only for the
case where even the leading token differs, e.g. a draft reading `MOHD ALI`
against a record reading `MUHAMMAD ALI`.

### Deliberate choices

**Pick by IC, never the first row.** The picker can list several records. A
blind `.first` would silently attach a stranger's profile to a real order and
nothing downstream would catch it. No IC match is an error, not a guess.

**Poll the picker grid before judging it.** Its rows arrive by AJAX after the
dialog is visible. The first live run read the grid immediately, found it
empty, and reported "listed records but none matched" when nothing had loaded.
The message now states how many rows were actually listed, so an empty grid and
a real mismatch read differently.

**Say whose record it is.** A successful attach writes the discrepancy into the
attempt's permanent history:

> Matched on the name prefix 'HONG': the portal's registered name for this IC
> differs from the draft's 'HONG TUNG TUNG'.

or, via the picker:

> Customer already registered at Unifi as 'HONG LIONG TONG' (draft says 'HONG
> TUNG TUNG') — attached the existing record.

The order is placed against a profile whose name does not match what the agent
typed. That is not something to resolve silently.

**A failed recovery is never worse than before.** If the Confirm won't accept
OK, the picker never opens, or no row carries our IC, the flow falls back to the
retry search — the behaviour that shipped before this change.

**Stage 1 is left alone.** `enter_full_order`'s customer-create still treats
"multiple customer records" as a warning and carries on. Driving the picker
there would select a customer on a screen the flow immediately navigates away
from; the selection only means something at attach time, inside the order.

## Tests

`scraper/tests/test_customer_form_scope.py` (6 cases, browser fixtures):
scoped fill hits the dialog's own `custName`; an unscoped `.first` anchors
outside `form.js-cust-form` (pins the trap); the scoped `.js-ok` is the form's
OK; dismissed-dialog remains are not matched; the PII registered name parses;
a missing PII dialog answers `None`.

`scraper/tests/test_name_prefix.py` (6 cases): the live case
(`HONG TUNG TUNG` → `HONG`), single-token names have nothing new to try,
sub-3-character tokens are refused (`H` returned nothing live), whitespace is
collapsed, empty/None are safe, 3-letter tokens are allowed.

Full suite: **171 passed, 1 skipped**.

## Verified live

- Bug 1's collision, reproduced and dumped from the live DOM.
- A `fill_only` run in the failing context: every starred field visibly filled —
  Customer Name, ID Number, auto-derived Gender + Birthday (portal-locked),
  Race, Nationality, Preferred Language, Residence Address, Sub-Segment,
  Segment, Segment Code, contact name/mobile/email, ID-copy attachment.
- The picker through the production functions on the real IC: returned
  `{"status": "ok", "registered_name": "HONG LIONG TONG"}` with the PII dialog
  up.
- A full run (attempt 6, `do_pay=true`): reached attach, attached via the
  picker, then stopped at `order_id_not_found` — the evidence that produced the
  layered redesign. No order minted, nothing charged.
- The prefix search table above, measured in one session.

## NOT verified

- **The layered attach end-to-end.** Steps 1–3 are each built on measured
  behaviour, but no run has yet gone attach → order number → Pay with this
  code. The paid submit (attempt 7) was blocked by the permission classifier.
- A picker listing **more than one** record — this IC returns exactly one, so
  the multi-row branch rests on its unit test.
- Nothing is deployed.

## Open question for the agent

The CRM record and the draft disagree on **name** (HONG LIONG TONG vs HONG TUNG
TUNG) and **house number** (4 vs 29) on the same street, same IC. Most likely a
typo on one side, but it should be confirmed before an order is placed against
that profile — the flow attaches the *existing* customer, not the one the draft
describes. That customer also already has four active accounts.

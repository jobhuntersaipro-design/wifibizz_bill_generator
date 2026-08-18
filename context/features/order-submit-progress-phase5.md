# Order Entry — Submit Progress Phase 5: Appointment Booking

## Status

**Code complete, live-unverified** (2026-08-17, branch
`feature/order-submit-progress-phase5`). Build, lint, 15 new Vitest cases and two
new scraper test suites (22 + 22 checks) pass; the `app_settings` migration is
applied. Three things still need the live portal — see
[Outstanding](#outstanding-after-implementation) at the end. Follows
[order-submit-progress-phase4.md](order-submit-progress-phase4.md) (merged to
main as `9a722bc` / `9583c9a`).

One thing matters here: **submits currently cannot finish.** Every run dies at
the appointment step, so nothing reaches Pay regardless of how good the rest of
the flow is.

---

## Context

### A. The step that stops every submit

A real run ends with:

> Order 2608000121374229 was created but the flow didn't finish: **no available
> slots found in the calendar**. Verify in the portal before retrying.

The order is minted before this point, so each failure strands a real order that
has to be voided by hand. Two are outstanding already.

And the calendar is not empty. Opened by hand for the same order, it offers
slots on **18–31 August** — four per day on most days
(`09:30–12:00`, `12:00–14:30`, `14:30–17:00`, `17:00–19:30`). The reader is
returning nothing from a calendar that visibly has plenty.

### B. Why the reader might be wrong — and why the spec does not assert it

`_APPT_SLOTS_JS` ([oe_feasibility.py](../../scraper/oe_feasibility.py)) does not
read the slots structurally. It **hit-tests geometry**: it collects
`.fc-day[data-date]` cells, collects `.fc-event` elements, and assigns each event
to a day by comparing bounding boxes.

```js
const days  = [...dl.querySelectorAll('.fc-day[data-date]')].map(...)
const slots = [...dl.querySelectorAll('.fc-event')].filter(vis).map(ev => {
  const day = days.find(dd => cx >= dd.l-2 && cx < dd.r && cy >= dd.t-2 && cy < dd.b+30);
  ...
  return (day && tm) ? (day.date + ' ' + tm[1]) : null;
}).filter(Boolean);
```

Every event whose day lookup misses becomes `null` and is dropped. If `days` is
empty, **all** of them are dropped, and the function returns `[]` — reported as
"no available slots" rather than as a selector failure. The most likely cause is
a FullCalendar version whose day cells are `.fc-daygrid-day[data-date]` and whose
events are `.fc-daygrid-event`, but the geometry could equally be defeated by a
scrolled container or an off-screen dialog.

**This is a hypothesis, not a diagnosis.** Phase 4 spent several real portal
submits on exactly this kind of confident guess. The first task here is to *read
the live DOM and find out*, and the reader must afterwards report **why** it
found nothing rather than collapsing every cause into one message.

### C. The date the portal picks is a business decision, not a constant

The 12-hour lead time is hard-coded in the middle of the slot JS:

```js
const cutoff = Date.now() + 12*3600*1000;
```

Two problems. It cannot be changed without a deploy, and it makes testing
awkward — verifying a booking today means accepting whatever slot the portal
offers tomorrow. There is no way to say "book 31 August" for a test.

---

## Current State

| Piece | Where | Before | After |
|---|---|---|---|
| Slot reader | `_APPT_SLOTS_JS` → `_APPT_READ_JS` | geometric hit-test; `[]` on any selector miss | selectors tried in order and reported; structural match first, geometry as fallback; unmatched events counted |
| Lead time | reader JS → `appointment_policy.choose_slot` | hard-coded 12h inline | admin setting, carried in the job payload |
| Booking | `_set_appointment(page, policy)` | fills `firstPreferredDatetime`, clicks OK, retries up to 10 slots | same, but only over slots the policy permits |
| Failure message | `_set_appointment` | one sentence for five causes | `describe_read_failure` + typed policy outcomes |
| Manual escape | `OE_MANUAL_APPOINTMENT=1` | pauses for a hand-pick | unchanged |
| Proof | `capture_and_report(..., "appointment")` | top-of-page frame only | plus `appointment_booked`, anchored on the Appointment section |
| Admin settings | — | no global settings table | `app_settings` singleton + `/admin/settings` |

---

## Proposed Change

### 1. Diagnose the reader against the live DOM (blocking, first)

Before changing the selectors, open the Appointment dialog on a real order and
record what is actually there: the day-cell class and attribute, the event class,
the event text, and whether the events sit inside their day cells or are
absolutely positioned over them.

Everything else in this phase depends on that answer, so it comes first and its
findings get written back into this spec.

### 2. A slot reader that can explain itself

Rewrite `_APPT_SLOTS_JS` to return a diagnostic object, never a bare list:

```js
{ slots: ["2026-08-31 09:30:00", …],
  dayCells: 42, events: 96, unmatched: 0,
  daySelector: ".fc-daygrid-day[data-date]",   // whichever matched
  dialog: true }
```

- Try day-cell and event selectors in order (`.fc-daygrid-day[data-date]`,
  `.fc-day[data-date]`, `td[data-date]`) and report which one matched.
- Prefer **structural** containment (`dayCell.contains(event)`) and fall back to
  geometry only when the events are positioned outside their cells, which is the
  case the current code was written for.
- Count events that matched no day rather than silently dropping them.

`_set_appointment` then distinguishes the causes it currently merges:

| Situation | Message |
|---|---|
| dialog never opened | "the appointment dialog did not open" |
| dialog open, no day cells | "could not read the calendar (day cells not found)" |
| days and events found, none matched | "found N slots but could not map them to dates" |
| slots exist, all before the lead time | "the earliest slot is <date>, inside the N-hour lead time" |
| genuinely none offered | "the portal offered no slots" |

A caller that says *which* of these happened is the difference between a
five-minute fix and another round of production submits.

### 3. Appointment policy, set in admin

A new global settings row, edited on a new **Settings** page under
`/admin/(dashboard)`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `appointmentStrategy` | `first_available` \| `fixed_date` | `first_available` | how the slot is chosen |
| `appointmentLeadHours` | int | `12` | earliest allowed slot, from submit time |
| `appointmentFixedDate` | date \| null | null | the day to book when strategy is `fixed_date` |

Within a chosen day the **earliest** slot always wins, so `fixed_date` +
31 August books `09:30–12:00` — the case asked for.

Behaviour:

- `first_available` — earliest slot at least `appointmentLeadHours` ahead.
- `fixed_date` — earliest slot **on that date**. If the date has no slots, the
  run fails with a message naming the date rather than silently booking another
  day: a fixed date is an instruction, and quietly substituting a different one
  is worse than stopping.
- `fixed_date` in the past is refused at save time in admin, not at submit time.

The lead time still applies as a floor under `first_available` only; a fixed date
is an explicit override of the policy.

**Set to `fixed_date` = 2026-08-31 for the verification run, then flipped to
`first_available` / 12h for deployment.** The flip is a settings change, not a
deploy.

Delivery: the scraper reads the policy from the job payload (BizzFlow already
composes it), so the setting reaches the portal flow the same way every other
order field does — no new scraper config surface, and no droplet redeploy to
change a date.

### 4. Proof that the booking stuck

A new `appointment_booked` capture, taken **after** the slot is accepted and
anchored on the Appointment section, so the frame contains the portal's own
confirmation row — Appointment No., Appointment Date, Start and End.

The existing top-of-page `appointment` frame shows none of that; it is a picture
of the top of a page that happens to have an appointment somewhere below it.

Uses `capture_sections` from Phase 4, so it inherits the anchor logic that is
already fixture-tested.

### 5. Migration

One table, hand-authored. `prisma migrate dev` fails in this repo (its shadow
database trips on a pre-existing unrelated migration), so the SQL is written by
hand and applied with `migrate deploy` — the same route the
`dealer_registered_email` migration took.

```sql
CREATE TABLE app_settings (
  id                      SERIAL PRIMARY KEY,
  appointment_strategy    VARCHAR(20) NOT NULL DEFAULT 'first_available',
  appointment_lead_hours  INTEGER     NOT NULL DEFAULT 12,
  appointment_fixed_date  DATE,
  updated_at              TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_by              VARCHAR(255)
);
```

A singleton row (`id = 1`), seeded with the defaults, so a missing row can never
mean "no policy".

---

## Acceptance Criteria

1. The live Appointment dialog's day-cell and event selectors are recorded in
   this spec.
2. The reader returns slots for a calendar that has them — verified against the
   real portal, not only a fixture.
3. When it finds nothing, the failure message names which of the five causes
   applies.
4. Admin has a Settings page with strategy, lead hours and fixed date; saving a
   past fixed date is refused with an inline error.
5. With `fixed_date` = 2026-08-31, a submit books **31 Aug 09:30–12:00**.
6. With `first_available` / 12h, a submit books the earliest slot at least 12
   hours out.
7. `fixed_date` on a day with no slots fails naming that date; it does not book
   a different day.
8. An `appointment_booked` frame shows the Appointment No. and date/times.
9. The submit gets **past** the appointment step — the whole point of the phase.
10. `npm run build`, `npm run lint`, unit tests and the scraper fixture test all
    pass.

---

## Testing Plan

**Unit** (Vitest) — slot selection against fixed slot lists: earliest-after-lead;
lead time excluding a too-soon slot; fixed date picking that day's earliest;
fixed date with no slots returning the typed "no slots on this date" outcome;
past fixed date rejected by the admin validator.

**Fixture** (scraper, extending `test_scroll_to_offers.py`'s harness) — a
FullCalendar-shaped Appointment dialog reproducing the live markup found in
step 1, including a day with no events and events rendered outside their cells,
asserting the reader maps every event to the right date and counts unmatched
ones.

**Live** — one submit with `fixed_date` = 31 Aug, watched:
booking succeeds, the `appointment_booked` frame shows `09:30–12:00`, and the
flow proceeds past the appointment step. **Only after the fixture test passes** —
Phase 4's lesson was that using production submits as the debug loop costs real
orders.

---

## Rollback Plan

- Reader — restore `_APPT_SLOTS_JS`; it is self-contained.
- Policy — the settings row is read with defaults (`first_available`, 12h), so
  deleting the admin page leaves the previous behaviour exactly.
- Capture — delete the slot; no data or API change.
- The table is additive and unreferenced elsewhere; dropping it affects nothing.

---

## Effort Estimate

| Item | Est. |
|---|---|
| Live DOM diagnosis | 0.5h |
| Reader rewrite + diagnostics | 2h |
| Settings table + migration | 1h |
| Admin Settings page | 2h |
| Policy plumbed into the payload + scraper | 1.5h |
| `appointment_booked` capture | 0.5h |
| Unit + fixture tests | 2h |
| Live verification | 1h |
| **Total** | **~10.5h** |

---

## Files Reference

| File | Change |
|---|---|
| `scraper/oe_feasibility.py` | reader rewrite, policy-aware selection, new capture |
| `scraper/tests/fixture_appointment_dialog.html` | new |
| `scraper/tests/test_scroll_to_offers.py` | extended, or split per concern |
| `prisma/schema.prisma` | `AppSetting` model |
| `prisma/migrations/…_app_settings/migration.sql` | new, hand-authored |
| `src/app/admin/(dashboard)/settings/page.tsx` | new |
| `src/actions/admin-settings.ts` | new — read/update with validation |
| `src/lib/order-types.ts` | `appointment_booked` label + caption |
| `scraper/order_to_payload.py` | carry the policy into the job payload |

---

## Out of Scope

- Letting the **agent** choose an appointment per order. This is a global policy;
  a per-order preference is a different feature with its own UI.
- Rescheduling or cancelling an appointment after booking.
- The preferred time-of-day window (considered and declined — more ways to end
  up with no match).
- Voiding the stranded orders, which is manual portal work.
- Anything about the Pay gate; `do_pay` stays FALSE.

---

## Decisions Taken (2026-08-17)

| Question | Decision |
|---|---|
| Setting scope | global, one row, admin-edited — the lead time is policy, not preference |
| Config shape | strategy + lead hours + fixed date; earliest slot within the chosen day |
| Proof capture | anchored on the Appointment section after booking, showing the confirmation row |
| Testing value | `fixed_date` = 2026-08-31 → 09:30–12:00, flipped to `first_available` after |

---

## Open Questions

1. **What the live calendar's markup actually is.** Still unanswered — see
   Outstanding below. It is no longer *blocking*: the reader now tries the
   candidate selectors in order and reports which matched, so the next run
   answers the question instead of the question having to be answered first.
2. Whether `fixed_date` should auto-expire back to `first_available` once the
   date passes, or keep failing until an admin changes it. **Decided: keep
   failing** — a booking policy that silently changes itself is how a test
   setting reaches production unnoticed. The admin form says so on screen.

---

## Outstanding (after implementation)

1. **The live calendar's markup is still unrecorded.** Acceptance criterion 1
   cannot be met from a fixture. What changed is that it is now *cheap* to meet:
   one run prints
   `calendar: dialog=… days=… events=… unmatched=… via '<daySelector>'/'<eventSelector>' matched-by=… -> N slots`
   plus the class and text of the first three events. Copy that line back into
   this spec.
2. **Nothing has run against the real portal.** Criteria 2, 5, 6, 7, 8 and 9 are
   all live-only. The order to run them in is: `fixed_date` = a day the calendar
   visibly offers → confirm it books that day's **earliest** slot and that the
   flow gets *past* the appointment step → then a day with no slots to confirm it
   fails naming the date rather than booking another → then flip to
   `first_available` / 12h.
3. **`appointment_booked` anchors on the pattern `appointment`**, which is a
   commoner substring than the Phase 4 section names. The deepest-match rule
   should land it on the Appointment section (the right-hand nav repeats the name
   but sits at the top), but like every anchor here it **fails by framing the
   wrong thing, not by throwing** — check the first frame it produces.
4. The two stranded orders from Phase 4 (`2608000121355110`,
   `2608000121374229`) still need voiding by hand.

### Deviations from the spec as written

- **Slot selection is tested in Python, not Vitest.** The spec put both under
  one Vitest bullet, but the slots are read by the scraper, so selection lives in
  `scraper/appointment_policy.py` and is tested there
  (`tests/test_appointment_policy.py`). Vitest covers the admin validator, which
  is the half that really is TypeScript. Every behaviour the spec listed is
  covered; only the framework differs.
- **The lead time moved out of the browser entirely.** The spec left it inside
  the reader's JS. Returning every offered slot and filtering in Python is what
  makes the policy testable against fixed lists, and it is why the same reader
  output can serve both strategies.
- **A second fixture was added** (`fixture_appointment_dialog_legacy.html`) for
  the events-outside-their-cells shape. One fixture would have proved only the
  structural path and let the geometric fallback rot unnoticed — and the
  fallback is what the *current* live portal may well need.

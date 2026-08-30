# Phase 1 — Failure → Action, and a Section-Aware Required Bar

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 1 of 9.
**Scope:** Vercel-only. No scraper change, no migration.

Two asks that share one purpose: an agent who hits a problem should know **what to do next**, and be
one click from doing it.

---

## Part A — Failure → action

### The gap, measured

When a submit fails, the agent sees a title, the portal's sentence and a "fix" paragraph — **for 10 of
the scraper's 15 named codes.** The other five (`address_already_has_service`, `address_not_found`,
`msr_customer_id_limit`, `msr_offline_approval`, `login_id_invalid`, `login_id_taken`,
`vobb_unavailable`, `unknown_error`) fall through to the raw message. BizzFlow's own five outcomes —
`session_expired`, `abandoned`, `portal_timeout`, `infra`, `cancelled` — have **no copy at all**.

And even where copy exists, the fix is **prose**. *"Change the device and resubmit"* is a sentence; it
is not a button that opens the draft on the Device card. Today the agent reads the advice, closes the
panel, finds the row, opens the menu, picks Edit, scrolls to the card. Six steps between knowing and
doing.

### What changes

Every failure gets a **primary action**, chosen from a fixed set:

| Action | Meaning | Where it goes |
|---|---|---|
| `fix_field` | The draft is wrong; the agent must change something | Opens the draft **on the card that needs fixing**, field focused |
| `resubmit` | Nothing to change; try again | The existing Submit / Resubmit path |
| `wait` | An automatic retry is owed | No button — the pill already says *Retrying · 2 of 3* |
| `check_portal` | The run may have left a real order at Unifi | Link to the portal order, with the "void before resubmitting" wording |
| `reconnect` | The dealer session is gone | The Order Entry connect card |
| `contact_admin` | Nothing the agent can do | A note with what to tell the admin |

**One table drives all of it.** `SUBMIT_ERROR_CODES` gains `action` and, for `fix_field`, a `section`.
The table is the single place a code is understood, and a code without an entry gets `contact_admin`
with the raw message — never a blank panel, never a guessed button.

### The full table

| Code | Action | Section |
|---|---|---|
| `address_no_tm_service` | fix_field | address |
| `address_not_found` | fix_field | address |
| `address_already_has_service` | fix_field | address |
| `customer_ic_name_mismatch` | fix_field | customer |
| `device_out_of_stock` | fix_field | package |
| `login_id_invalid` / `login_id_taken` | resubmit | — the scraper already picks a new one |
| `voice_number_taken` | resubmit | — same |
| `appointment_slot_taken` / `appointment_not_booked` | resubmit | — |
| `vobb_unavailable` | contact_admin | — |
| `msr_customer_id_limit` / `msr_offline_approval` | contact_admin | — portal-side limits |
| `erf_not_downloaded` | check_portal | — the order exists; only the PDF is missing |
| `pay_page_not_ready` / `pay_click_did_not_take` | check_portal | — |
| `submit_stopped` | check_portal | — |
| `session_expired` | reconnect | — |
| `abandoned` | check_portal | — |
| `portal_timeout` / `infra` | resubmit | — |
| `unknown_error` / no code | contact_admin | — |

`wait` is not in the table because it is not a property of the code: it is `isRetryPending(order)`,
already computed, and it **overrides** whatever the table says while a retry is owed.

### Deep-linking into the draft

`fix_field` needs the form to open on a card. The New Order page already reads `useSearchParams`; it
gains `?focus=<section>`. The form scrolls that card into view and focuses its first input.

**This needs the cards to have anchors, and today they do not** — the only `id`s on the form are
`lead-hours` and the two document tab panels. Part B adds them, which is why the two parts ship
together.

### Where the button appears

Three surfaces already render the failure copy and get the button beside it: the expanded row in the
Orders table (`SubmitProgress`), the order detail hero, and the failure e-mail (as a link to the draft
with `?focus=`, since e-mail cannot carry a button that does anything else).

---

## Part B — A section-aware required bar

### The gap

The sticky bar reads *"4 required fields left · ID Number, Email, Postcode…"* — a flat list of eleven
possible names, truncated at three. On a form that scrolls for six cards, it says **how many** but not
**where**, and the agent scrolls to find out.

### What changes

`missingRequired` becomes a list of `{ label, section }`, and the bar groups by section:

> **4 left** · Customer 1 · Address 2 · Documents 1

Each section name is a **button that scrolls to that card** and focuses its first empty required
field. On a phone (under `sm`) the section names collapse to counts only — *4 left · C1 A2 D1* — with
the full names on tap.

The save gate does not change. `handleSubmit` stays the sole validator; the bar is still informational.

### Sections

Six, matching the cards that exist: `customer` · `contact` · `address` · `package` · `appointment` ·
`documents`. Each card gets `id="section-<name>"`, and one pure `sectionOf(fieldLabel)` maps the
eleven required labels onto them so Part A's `fix_field` and Part B's bar use the same anchors.

---

## Not in scope, deliberately

- **Splitting `OrderForm.tsx`.** This phase adds ~40 lines to a 2,035-line file. It will make the case
  for the split; it is not the split. Proposed as its own decision afterwards.
- **New copy for the uncovered codes** beyond the action. Titles and fix text for the five uncovered
  scraper codes are written here, but they are short — the point of this phase is the button, not the
  prose.
- **A "wait" button.** The retry pill already carries that state.

---

## Tests

Pure, all of it:

- `actionFor(code, order)` — every code in the table resolves to an action; an unknown code resolves to
  `contact_admin`; a pending retry overrides any code to `wait`; a `check_portal` action is never
  produced without an `orderId` to link to (it degrades to `contact_admin`).
- `sectionOf(label)` — all eleven required labels map to a section; an unknown label throws in tests
  (so a new required field cannot be added without placing it).
- `groupMissing(missing)` — grouping and ordering by card order, and the collapsed mobile form.

Browser: a failed order's card showing the button, the button opening the draft on the right card with
the field focused, the bar's section links scrolling and focusing, and 375px collapsing to counts.

---

## Open before building

1. **`contact_admin` — what does the agent actually do?** There is no in-app way to reach an admin
   (that is Phase 2's territory). Until then the note says *"Tell your admin: <code> on <reference>"*.
   Acceptable for now, or should this phase wait for Phase 2?
2. **Failure e-mail link:** the e-mail goes to the notification address, which may be read on a phone
   without a session. The link lands on sign-in, then the draft. Fine, or omit the link from e-mail?

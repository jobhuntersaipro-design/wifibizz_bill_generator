# Order Entry — Full Address + Confirm

Feature request for the **Installation Address** card on `/dashboard/order-entry`
([src/components/order-entry/OrderForm.tsx:540-620](../../src/components/order-entry/OrderForm.tsx#L540-L620)).

## Status

Not started — spec only.

## Goal

Make the agent type **one complete, portal-verified address** and press **Confirm**.
Postcode / State / City stop being things the agent fills in and become **outputs**
of that confirmation. Ownership of address correctness moves explicitly to the agent:
the address must already exist and be serviceable in the Unifi dealer portal.

## Current behaviour (what changes)

| Today | After |
|---|---|
| Field label "Street Address — type it, then Search & pick the serviceable unit" | "Full Address" + subtext stating it must be the complete address, already verified in the Unifi portal |
| Button reads **Search** | Button reads **Confirm** |
| Agent must pick State **before** searching (`runAddressSearch` hard-fails with "Select the State (above) before searching.") | State is **parsed out of the typed full address**; no pre-selection needed |
| Postcode typed by the agent → Google/static geocode fills City + State (`handlePostcode`) | Postcode / State / City are filled **from the confirmed address**; manual typing remains possible but is no longer the primary path |
| No format validation — any ≥3-char string is searched | Address is validated as a plausible Malaysian address **before** any portal call |

Unchanged: `addressId` (`resourceInstId`) is still what feasibility runs on, and the
green "✓ Serviceable" confirmation strip + Clear button stay exactly as they are.

## Reference address

```
A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 FTTH BSP 21 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610
```

This is the shape the portal itself returns as `concatAddress`
(see [order-entry-address-api.md](order-entry-address-api.md)) — unit, street,
section, city/town, **STATE**, **MALAYSIA**, **postcode**. Validation is modelled on it.

## 1. Field: Full Address

- Label: **Full Address** `*`
- Subtext (below the input, replacing the current "Pick a unit to confirm…" hint):
  > Enter the **complete** address exactly as it appears in the Unifi portal —
  > unit, street, area, city, state, MALAYSIA, postcode. The agent is responsible
  > for making sure this address is correct and findable in the Unifi portal.
- Placeholder: the reference address above (truncated with `…`).
- Stays uppercase-on-input, stays `Enter`-to-submit (now triggers Confirm).
- Still bound to the existing `street` state — it is what gets persisted as the
  profile street on save, so no schema change.

## 2. Button: Confirm

Rename `Search` → `Confirm`; busy label `Searching…` → `Confirming…`.
`runAddressSearch()` becomes `confirmAddress()`. Behaviour on click:

1. **Validate** the typed string (§4). Invalid → inline red error under the field,
   no network call.
2. **Parse** state + postcode out of the string.
3. **Search the portal** — `searchDealerAddress(parsedState, fullAddress, "keyword")`
   as today, with the parsed state instead of the dropdown value.
4. **Show the results — always.** No auto-select, even on a single or exact match
   (decided 2026-08-14). The ranked list appears and the agent clicks the unit;
   `pickAddress` is unchanged and the field then snaps to the portal's
   `concatAddress`. Ranking (closest match to what was typed first) stays as-is.
   - Zero results → red inline error: *"Not found in the Unifi portal. Check the
     address in the portal first — it must exist and be serviceable."*
5. **Populate** Postcode / State / City from the selected portal record
   (`pickAddress` already does this — it sets `postcode`, `city`, `stateVal`,
   `street`, `addressId`, `serviceCategory`). The portal record is the source of
   truth; parsed values are only a fallback when the portal omits a field.

## 3. Postcode / State / City become auto-filled

- Keep all three visible — the agent must be able to see and correct what was
  derived, and the customer-profile save still validates them
  ([OrderForm.tsx:366-381](../../src/components/order-entry/OrderForm.tsx#L366-L381)).
- Mark them `(auto — filled on Confirm)` and render them read-only-styled until a
  successful Confirm, then editable.
- Keep `handlePostcode` (static `malaysia-postcodes.json` → Google geocode fallback)
  as the manual escape hatch and as the fallback filler when the portal record has
  no `city`.
- Clearing the confirmed address (existing Clear button) clears `addressId`,
  `addressFull`, `serviceCategory` and re-enables manual entry. It should **not**
  wipe postcode/state/city — the agent may be mid-correction.

## 4. Malaysian address validation (client-side, before the portal call)

A pure helper — `validateMalaysianAddress(input): { ok: true, state, postcode, city? } | { ok: false, reason }`
in `src/lib/malaysia-address.ts`. Rules, each with its own message:

| # | Rule | Failure message |
|---|---|---|
| 1 | Length ≥ 20 chars and ≥ 5 whitespace-separated tokens | "Enter the full address, not just the street." |
| 2 | Contains exactly one 5-digit postcode (`\b\d{5}\b`) | "Missing a 5-digit postcode." / "More than one 5-digit number — remove the extra." |
| 3 | Contains a recognised state — match against `MALAYSIA_STATES` + `STATE_ALIASES` via the existing `extractState()` in [src/lib/malaysia-states.ts:47](../../src/lib/malaysia-states.ts#L47) | "Couldn't find a Malaysian state in the address." |
| 4 | Postcode ↔ state agree — look the postcode up in `malaysia-postcodes.json`; if present, its state must equal the parsed state | "Postcode 42610 belongs to SELANGOR, but the address says PAHANG." |
| 5 | State must be one the portal accepts (`ADDRESS_SEARCH_STATES` in [src/actions/order.ts](../../src/actions/order.ts)) | "The portal doesn't support address search for that state." |
| 6 | Has a street-ish token — one of `JALAN JLN LORONG LRG PERSIARAN LEBUH LEBUHRAH TAMAN BANDAR KAMPUNG KG PARIT SOLOK SIMPANG BLOK LOT NO` **or** a unit pattern (`^[A-Z]?-?\d+-\d+`, `LOT 123`, `NO 45`) | "Include the street / unit (e.g. A-07-15 PERSIARAN …)." |
| 7 | `MALAYSIA` / `M'SIA` is **not** required (warn only) | soft hint: "Tip: portal addresses usually end with MALAYSIA <postcode>." |

Rule 4 is the one that catches real typos; rules 1–3 catch "agent typed half an address".
Nothing here proves the address is *real* — only the portal search does. Validation
exists to stop obviously-malformed input from burning a portal round-trip.

**Server-side mirror:** `searchDealerAddress` already whitelists the state. Add the
same `validateMalaysianAddress` call in the save path (`saveOrder`) so an order can
never be persisted with a malformed address if the client is bypassed.

### Deliberately NOT doing

- No Google Places / geocoding call for validation. The authority is the Unifi
  portal, not Google — an address Google likes but the portal can't find is useless,
  and the reverse (new FTTH estates) happens too.
- No autocomplete-as-you-type against the portal. Each search is an authenticated
  dealer-session round trip through the scraper service; typing-rate calls would
  hammer it. Confirm stays an explicit click.

## 5. Files touched

| File | Change |
|---|---|
| [src/components/order-entry/OrderForm.tsx](../../src/components/order-entry/OrderForm.tsx) | label + subtext, Search→Confirm, `confirmAddress()`, auto-select exact match, auto-fill/lock postcode·state·city |
| `src/lib/malaysia-address.ts` *(new)* | `validateMalaysianAddress()` + `parseMalaysianAddress()` |
| [src/lib/malaysia-states.ts](../../src/lib/malaysia-states.ts) | reuse `extractState` / `STATE_ALIASES`; no change expected |
| [src/actions/order.ts](../../src/actions/order.ts) | server-side validation in `saveOrder`; `searchDealerAddress` unchanged |
| `src/lib/__tests__/malaysia-address.test.ts` *(new)* | Vitest cases per rule, incl. the reference address |

No Prisma/schema change — `Order.addressId` / `addressFull` / `postcode` / `city` /
`state` / `street` all already exist.

## 6. Acceptance criteria

1. Pasting the reference address and clicking **Confirm** — with **no** State
   pre-selection — returns the portal's ranked results. Clicking the matching unit
   fills Postcode `42610`, State `Selangor`, City (from the portal record), shows
   the green ✓ Serviceable strip, and sets `addressId`.
2. A partial address ("PERSIARAN SAUJANA PUTRA UTAMA 7") is rejected client-side
   with "Enter the full address, not just the street." — no portal call is made.
3. A postcode/state mismatch is rejected with the specific mismatch message.
4. A well-formed address the portal doesn't know shows the "not found in the Unifi
   portal" error and leaves `addressId` empty. The order can still be saved —
   submit is **not** gated on `addressId` (see §7).
5. A well-formed address matching several portal units shows the ranked picker;
   picking one behaves exactly as today.
6. `npm run build` and `npm run lint` clean.

## 7. Decisions (settled 2026-08-14)

- **Submit is NOT hard-blocked on a confirmed `addressId`.** `handleSave` keeps
  validating postcode / state / city / street only, as today. An order with an
  unconfirmed address still saves — Confirm is the strongly-encouraged path, not a
  gate, so existing drafts keep working.
- **No auto-select — Confirm always shows the picker.** No normalized exact-match
  shortcut and no auto-select on a single result. The agent's click on a specific
  unit is what sets `addressId`. This also removes the need for a live run to prove
  the portal's `concatAddress` round-trips identically to pasted text.

# Netflix / Max Offer Layer — Group Kinds, Item Options, and a Device Picker That Only Lists Devices

**Ask (2026-08-29, from portal screenshots of order `2608000122935691` and `/admin/plans`).** Two problems, one cause.

1. The Netflix (and Max) plans have **a third level the model cannot hold**. The portal's Offer dialog reads
   `Unifi Home 300Mbps with Netflix OTT[Pick 0, N]` → `Netflix Basic (Unifi)` → `Netflix Basic` (auto-ticked,
   RM0) / `Netflix Standard` (RM20) / `Netflix Premium` (RM33). `Plan → PlanOfferGroup → PlanOfferItem` stops
   at two levels, so Plan Details records the middle row and loses the tiers entirely.
2. The New Order device picker mixes the two. For `Unifi Home 300Mbps Premium Value Netflix With Device (36M)`
   it offers **"Netflix Basic (Unifi)"** and **"Premium Value Samsung TV 43inch 1 (RM20)"** side by side under
   *INDIVIDUAL MODELS 2* — one is a TV the agent picks, the other is a channel bundle the portal ticks itself.
   An agent choosing the wrong one writes a channel row into `Order.deviceCode`.

## Decisions taken with the user

- **The tier is never chosen.** Every order takes whatever the portal pre-ticks (Netflix Basic). The tiers are
  recorded in Plan Details for reference only — no tier field on the order, no tier in the payload.
- **An order still carries exactly ONE device.** No per-group selection, no schema change on `Order`. The
  channel row is not a device and simply stops being offered as one.
- **The portal pre-ticks the channel row itself** — confirmed by the user against the live order. So the
  scraper does not have to tick it, and the happy path needs no scraper change.
- **The kind is set by an admin, not inferred from the name.** A `kind` on the offer group
  (`device` / `channel` / `discount`) rather than another `/netflix|max|ott/i` regex beside the existing
  `/discount/i` one — the admin is already copying these names verbatim off the dialog, and a naming the
  portal has not invented yet must not silently classify as a device.

## 1. Data model — one migration, two columns

`prisma/migrations/20260829120000_plan_offer_kind_and_options` (hand-authored + `migrate deploy`;
`migrate dev`'s shadow DB fails on a pre-existing migration in this repo).

- `plan_offer_groups.kind TEXT NOT NULL DEFAULT 'device'` — `device` | `channel` | `discount`.
  **Backfilled `'discount'` for every name matching `/discount/i`**, which is exactly what
  `isDiscountGroupName()` derives today, so the deploy changes no behaviour. The Netflix/Max OTT groups are
  re-tagged `channel` by hand afterwards (1–2 clicks per plan).
- `plan_offer_items.parent_id TEXT NULL REFERENCES plan_offer_items(id) ON DELETE CASCADE` — the third level.
  `Netflix Basic (Unifi)` is an ordinary item; the three tiers are its children.
- `plan_offer_items.included BOOLEAN NOT NULL DEFAULT false` — marks the child the portal auto-ticks. An
  inference from `monthly = 0` would be wrong the first time a bundle includes a paid tier.

`@@unique([groupId, name])` is unchanged: a child's name is unique within its group too.

## 2. `src/actions/plans.ts`

- `OfferGroupView.isDiscount` → `OfferGroupView.kind`. `isDiscountGroupName` survives only as the migration's
  backfill rule and is deleted from the runtime path.
- `OfferItemView` gains `options: OfferItemView[]` (children, empty for every existing row) and `included`.
- `adminAddOfferGroup(planId, name, mandatory, kind)`; new `adminSetOfferGroupKind(id, kind)` for the groups
  that already exist.
- `adminAddOfferItem(groupId, name, code, monthly, parentId?, included?)` — a child is added against its
  parent; the group is derived from the parent so the two cannot disagree.
- `getPlanOffer` returns `{ devices, channels, discounts, known }`. `devices` = items of mandatory
  **device**-kind groups only. `channels` = items of mandatory channel groups, each carrying its `options`.
- **`known` changes meaning** from "devices recorded" to "anything recorded for this plan". A plan whose only
  recorded group is a channel must say *no selectable device* rather than fall back to the 126-row static
  catalogue, which holds devices that plan never offered.

## 3. Admin Plan Details (`src/components/admin/plan-details.tsx`)

- Add-group form gains a Device / Channel / Discount selector; each existing group row gains an inline kind
  switch. Badges: `auto-applied` (discount, unchanged), `included with plan` (channel).
- A channel group's items render their children indented, with `included` / `RM20/mth` chips and a
  `+ Add option` control. Device and discount groups are untouched.
- The Guide gains one paragraph: what a channel group is, and that its tiers are recorded, not chosen.

## 4. New Order (`src/components/order-entry/OrderForm.tsx`)

- The Device dropdown and its type chips are fed by `devices` only — the channel row disappears from
  *INDIVIDUAL MODELS*, so the screenshot's "2" becomes "1".
- A read-only **Included with this plan** block below the Device card lists the channel items with their
  included tier and the auto-applied discounts, so the agent can see what is bundled without being able to
  pick it.
- The `isWithDevice && !deviceCode` save guard only fires when the picker actually has a device to offer
  (`!known || devices.length > 0`); otherwise a channel-only plan named "With Device" could never be saved.
- `PlanDetailsView` (the agent-facing tab) shows the same kind badges and nested options.

## 5. Scraper — `device_offer_groups`

The happy path needs nothing. But `offer_groups` in the job payload carries **all** mandatory group names, and
`starred_devices()` treats every row inside them as a substitutable device — so a portal refusal of the TV
could substitute `Netflix Basic (Unifi)` and submit that as the order's device. `buildOrderJobRequest` now
also sends `device_offer_groups` (device-kind only), which `mandatory_group_indices` prefers when present.
`offer_groups` is left intact so group expansion and `ensure_promo_discounts` are unaffected.

**This makes the feature not Vercel-only: it needs a droplet deploy AND an `api_server` restart** (a deploy
alone keeps the old imports).

## Testing

- vitest on the pure helpers: the discount backfill rule, the device/channel/discount partition, the
  `known` rule, and the relaxed save guard.
- Browser: `/admin/plans` — re-tag the Netflix group, add the three tiers under `Netflix Basic (Unifi)`,
  reload; New Order on that plan — one device in the dropdown, Netflix shown as included.
- `npm run build`, lint against the 9642 baseline, `tsc` unchanged.

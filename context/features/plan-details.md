# Plan Details — admin-curated offer groups

## Problem

The device a package may carry is decided by the portal's **Offer dialog**, whose
mandatory groups are marked with a red `*`:

```
  Unifi Home 500Mbps Mesh WIFI [Pick 0-2]
  Unifi Home 500Mbps VAS [Pick 0-N]
  Unifi Home Broadband Smart Device (Set H) [Pick 0-1]
  Unifi Home 500Mbps Premium Value With Device Discount[Pick 0-1]  *   ← mandatory
  Unifi Home 500Mbps Premium Value With Device[Pick 0-1]           *   ← mandatory
```

That dialog only exists on an order's own detail page — verified live with
[probe_offer_catalog.py](../../scraper/devtools/probe_offer_catalog.py), which found **zero**
`[Pick n-m]` text anywhere before the Order button is clicked. So automation
cannot read it without first minting a real order, which is what the (now
removed) Catalogue tab did.

Two further problems with automatic discovery:

1. **Detecting the `*` is guesswork.** `expand_starred_groups` matches against
   markup we have only ever seen in screenshots, and a miss silently yields the
   wrong device list.
2. **The device catalogue is the wrong list.** `src/lib/dealer-devices.ts` came
   from the portal's VAS tree and holds entirely different offers — it lists
   `LG 75inch TV (24mth contract)` while the 500Mbps starred group holds
   `Premium Value Samsung TV 55inch/65inch`. Picking from it is what produced
   *"the current offer can't be subscribed through Contactless Journey"*.

## Approach

An admin curates the mapping once, by reading it off the portal, instead of the
system paying a real order per package to guess at it. Automation then works from
a name a human confirmed, not from markup detection.

## Data model

```prisma
model Plan {
  id           String   @id @default(cuid())
  name         String   @unique   // exact portal offer name, matched verbatim
  category     String              // Home / Business / VOF …
  bandwidth    String?             // 100M / 500M / 1G …
  published    Boolean  @default(false)
  offerGroups  PlanOfferGroup[]
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PlanOfferGroup {
  id        String  @id @default(cuid())
  planId    String
  plan      Plan    @relation(fields: [planId], references: [id], onDelete: Cascade)
  // Verbatim from the dialog, including the pick-range:
  //   "Unifi Home 500Mbps Premium Value With Device[Pick 0-1]"
  name      String
  mandatory Boolean @default(true)   // the red *
  sortOrder Int     @default(0)
}
```

`Plan` is seeded from `DEALER_OFFERS` (61 packages) so the admin starts with the
full list and only has to fill in the groups.

## Admin — new "Plan Details" tab

Route `/admin/plans`, alongside Users in the sidebar.

- **All plans, grouped by category**, then by bandwidth within a category.
- Per plan: **Publish / Unpublish** toggle, and the offer-group names.
- Add / edit / remove offer groups. The name is typed **verbatim** from the
  portal dialog, with `mandatory` ticked for the starred ones.
- **A guide panel** showing the annotated Offer-dialog screenshot, so the admin
  can see exactly which text to copy and which rows carry the `*`.
- Coverage badge per plan: *Published*, *Needs offer groups*, *Unpublished*.

## Order Entry — "Plan Details" tab (replaces Catalogue)

Read-only for agents. Lists the **published** plans with their mandatory offer
groups, so an agent can see what a package will require before selling it.

## Order Entry — New Order

The package picker offers **published plans only**. An unpublished plan is one an
admin has not verified, and selling it risks the rejection above.

## Scraper

`expand_starred_groups` stops guessing at the `*`. The payload carries the
admin-entered mandatory group names, and the scraper expands and reads **those
groups by name**. Star detection remains only as a fallback when no group names
are configured.

## Removed

Everything from the Catalogue feature: the `/dashboard/order-entry/catalogue`
route, `CatalogueTable.tsx`, `getCatalogue`, `discoverPackageDevices`, and the
`discover_only` path through the scraper. See the open questions below on whether
`PackageOffer` (learning from real runs) is removed with it.

## Acceptance criteria

1. Admin sees every plan from `DEALER_OFFERS`, grouped by category.
2. Admin can publish/unpublish a plan, and can add mandatory offer-group names.
3. The guide screenshot is visible in the admin tab.
4. Order Entry's Plan Details tab shows published plans and their groups.
5. The New Order package picker lists only published plans.
6. No Catalogue route, component, or action remains.

## Decisions taken

| Decision | Choice |
| --- | --- |
| Admin input | **Group names only.** The scraper expands the named group at run time and reads its devices — the admin never types device names, and star-detection guesswork is gone. |
| Unpublish | **Hidden from the agent's package picker entirely.** An unpublished plan is one nobody has verified, so it cannot be sold. |
| Auto-learning | **Deleted.** `PackageOffer`, `DeviceRejection`, `recordPackageOffers`, `recordDeviceRejection` and the preflight rejection block all go. Admin data is the single source of truth. |
| Guide screenshot | **Text instructions for now**; the image can be added later at `public/admin/offer-groups-guide.png`. |

### Consequence worth knowing

With learning deleted and devices read at run time, nothing warns before a submit
that a device is wrong — the agent's picker still shows the static catalogue,
which holds different offers from the portal's groups. What protects the order is
that the scraper now selects from the **admin-named group** rather than from the
catalogue, so the agent's device choice is matched against the real list at the
moment it matters.

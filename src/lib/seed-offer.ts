// Choosing which package (and device) a seeded draft should carry.
//
// The rule that matters: the package comes from the offers the PORTAL listed for
// that address, never from a static catalog. Picking from the catalog is how the
// existing drafts ended up on a package the address does not sell, which is
// indistinguishable from the address not being serviceable at all until a submit
// fails on it.
//
// The catalog is still consulted, but only to look up the category and device
// metadata for an offer the portal has already named.

import { DEALER_OFFERS, OFFER_CATEGORIES } from "@/lib/dealer-offers";
import { DEALER_DEVICES } from "@/lib/dealer-devices";

export interface PickedOffer {
  offerName: string;
  offerCategory: string;
  deviceCode?: string;
  deviceName?: string;
}

const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * True for a grid row that is a CATEGORY header, not a purchasable offer.
 *
 * The portal's Subscription Plan List groups its rows, and the group headers
 * ("unifi Home Bundle Sale Catg") come back from the row reader looking exactly
 * like offers — they carry a title cell like everything else. Writing one into
 * `Order.offerName` produces a draft naming a package that does not exist, and
 * the submit would only discover that at the plan step.
 */
export function isOfferCategoryRow(name: string): boolean {
  const n = norm(name);
  return (
    Object.values(OFFER_CATEGORIES).some((c) => norm(c) === n) ||
    /\bcatg\b$/.test(n)
  );
}

/** True when an offer name says it ships hardware. */
export function isWithDevice(offerName: string): boolean {
  return /\bwith device\b/i.test(offerName || "");
}

/**
 * The portal's offer category for a name it listed, or the Home category.
 *
 * The fallback is deliberate rather than a failure: the portal's grid is the
 * live truth and the transcribed catalog lags it, so an unrecognised name means
 * the catalog is stale, not that the offer is unusable. `all_categories: false`
 * in the payload means the category only narrows the portal's own search.
 */
export function offerCategoryFor(offerName: string): string {
  const want = norm(offerName);
  const hit = DEALER_OFFERS.find((o) => norm(o.name) === want)
    ?? DEALER_OFFERS.find((o) => norm(o.name).includes(want) || want.includes(norm(o.name)));
  return hit?.category ?? OFFER_CATEGORIES.HOME;
}

/**
 * Pick one offer out of what the portal listed.
 *
 * Default preference is an offer WITHOUT a device: a device bundle drags in the
 * sub-product tabs, the stock check and a delivery address, so a plain package
 * is the shorter path to proving the submit works at all. `withDevice` reverses
 * the preference for when those steps are the point.
 *
 * Returns null when the portal listed nothing — the caller must skip the
 * address rather than substitute a package of its own.
 */
export function pickOffer(offers: string[], withDevice = false): PickedOffer | null {
  const usable = (offers || [])
    .map((o) => (o || "").trim())
    .filter(Boolean)
    .filter((o) => !isOfferCategoryRow(o));
  if (usable.length === 0) return null;

  const wanted = usable.filter((o) => isWithDevice(o) === withDevice);
  // Preference, not a requirement: an address that only sells device bundles is
  // still worth a draft. Reporting "no offers" for it would be a lie about what
  // the portal said.
  const offerName = (wanted[0] ?? usable[0]) as string;

  const picked: PickedOffer = { offerName, offerCategory: offerCategoryFor(offerName) };
  if (isWithDevice(offerName)) {
    const device = cheapestDevice();
    if (device) {
      picked.deviceCode = device.code;
      picked.deviceName = device.name;
    }
  }
  return picked;
}

/**
 * The cheapest real device in the catalog, for a bundle that needs one.
 *
 * Cheapest because a seeded draft is never meant to be paid for; charge and
 * discount line items are excluded because they are not devices at all and
 * picking one would fail the portal's own tab, far from here.
 */
export function cheapestDevice() {
  const real = DEALER_DEVICES.filter(
    (d) => d.monthly !== null && !/STAMP DUTY|PROMO DISCOUNT|PROFESSIONAL CHARGE/i.test(d.name)
  );
  return real.sort((a, b) => (a.monthly as number) - (b.monthly as number))[0] ?? null;
}

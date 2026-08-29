/**
 * The shape of a plan's offer tree, and the pure rules over it.
 *
 * Lives outside `src/actions/plans.ts` because a `"use server"` module may only
 * export async functions — and because these rules decide what an agent is
 * allowed to pick, which is worth testing without a database.
 */

/** What an offer group holds. Set by an admin, not derived from its name. */
export type OfferGroupKind = "device" | "channel" | "discount";

export const OFFER_GROUP_KINDS: OfferGroupKind[] = ["device", "channel", "discount"];

export const OFFER_GROUP_KIND_LABEL: Record<OfferGroupKind, string> = {
  device: "Device",
  channel: "Channel",
  discount: "Discount",
};

/**
 * Coerce a stored kind.
 *
 * Anything unrecognised reads as `device`, which is also what the migration
 * defaulted every existing row to (backfilling `discount` by name — the
 * `isDiscountGroupName` rule the runtime used before kinds existed, which lives
 * on only in that migration's SQL).
 */
export function toOfferGroupKind(raw: string | null | undefined): OfferGroupKind {
  return raw === "channel" || raw === "discount" ? raw : "device";
}

export interface OfferItemOptionView {
  id: string;
  name: string;
  code: string | null;
  monthly: number | null;
  /** The one the portal auto-ticks. */
  included: boolean;
}

export interface OfferItemView {
  id: string;
  name: string;
  code: string | null;
  monthly: number | null;
  /**
   * The third level, e.g. Netflix Basic / Standard / Premium under
   * "Netflix Basic (Unifi)". Recorded for reference only — an order never
   * chooses a tier, it takes whichever one the portal pre-ticks.
   */
  options: OfferItemOptionView[];
}

export interface OfferGroupView {
  id: string;
  name: string;
  mandatory: boolean;
  /**
   * `device` groups are the only ones the agent picks from. `channel` groups
   * (the Netflix / Max OTT bundles) are ticked by the portal itself and
   * `discount` groups are applied automatically, so both are shown read-only —
   * which is what stops "Netflix Basic (Unifi)" being offered as a device.
   */
  kind: OfferGroupKind;
  items: OfferItemView[];
}

export interface PlanView {
  id: string;
  name: string;
  category: string;
  bandwidth: string | null;
  published: boolean;
  notes: string | null;
  offerGroups: OfferGroupView[];
}

/** One `plan_offer_items` row, as stored. */
export interface OfferItemRow {
  id: string;
  name: string;
  code: string | null;
  monthly: number | null;
  parentId: string | null;
  included: boolean;
}

/**
 * A group's flat item rows as a two-level tree.
 *
 * The database holds every row in one table with a nullable parent, so the
 * nesting is rebuilt on read. A child whose parent is not in the list is
 * DROPPED rather than promoted: surfacing "Netflix Premium" as a top-level row
 * would put it back in the device picker, which is the confusion this exists to
 * remove.
 */
export function nestOfferItems(rows: OfferItemRow[]): OfferItemView[] {
  return rows
    .filter((r) => !r.parentId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      monthly: r.monthly,
      options: rows
        .filter((c) => c.parentId === r.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          monthly: c.monthly,
          included: c.included,
        })),
    }));
}

export interface PlanOfferSplit {
  /** The only rows the agent may pick from. */
  devices: OfferItemView[];
  /** OTT bundles the portal ticks itself — shown, never chosen. */
  channels: OfferItemView[];
  /** Applied automatically during the order. */
  discounts: OfferItemView[];
  /**
   * True once ANY row is recorded for this plan.
   *
   * Deliberately not "devices.length > 0": a plan whose only recorded group is
   * a channel must read as "no device to pick", not fall back to the 126-row
   * static catalogue, which holds devices that plan never offered.
   */
  known: boolean;
}

export function splitPlanOffer(groups: OfferGroupView[]): PlanOfferSplit {
  const devices: OfferItemView[] = [];
  const channels: OfferItemView[] = [];
  const discounts: OfferItemView[] = [];
  for (const g of groups) {
    const into = g.kind === "channel" ? channels : g.kind === "discount" ? discounts : devices;
    into.push(...g.items);
  }
  return {
    devices,
    channels,
    discounts,
    known: devices.length + channels.length + discounts.length > 0,
  };
}

/**
 * Whether the order form must insist on a device.
 *
 * A "With Device" plan whose recorded groups hold only a channel offers the
 * agent nothing to pick, and demanding one would make that plan unsaveable.
 */
export function deviceRequired(isWithDevice: boolean, split: Pick<PlanOfferSplit, "devices" | "known">): boolean {
  if (!isWithDevice) return false;
  return !split.known || split.devices.length > 0;
}

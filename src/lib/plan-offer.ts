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

/**
 * The speed a plan sells, as a person says it: "100M" → "100 Mbps", "1G" → "1 Gbps".
 *
 * The portal's own shorthand is what `dealer-offers.ts` records and what the
 * collapsed plan row prints, so it is kept as the sort key while only the
 * heading is spelled out.
 */
export function bandwidthLabel(bandwidth: string | null | undefined): string {
  const raw = (bandwidth ?? "").trim().toUpperCase();
  const m = /^(\d+(?:\.\d+)?)\s*([MG])B?P?S?$/.exec(raw);
  if (!m) return raw || "Other speeds";
  return `${m[1]} ${m[2] === "G" ? "Gbps" : "Mbps"}`;
}

/** Megabits per second, for ordering. Unparseable speeds sort last. */
export function bandwidthMbps(bandwidth: string | null | undefined): number {
  const raw = (bandwidth ?? "").trim().toUpperCase();
  const m = /^(\d+(?:\.\d+)?)\s*([MG])B?P?S?$/.exec(raw);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * (m[2] === "G" ? 1000 : 1);
}

export interface BandwidthGroup<T> {
  /** The raw value, unique per group — usable as a React key and a toggle id. */
  key: string;
  label: string;
  plans: T[];
}

/**
 * Split plans into speed groups, slowest first.
 *
 * Grouped on the raw value rather than the label so two spellings of one speed
 * cannot collapse into a heading whose count disagrees with the rows under it.
 */
export function groupPlansByBandwidth<T extends { bandwidth: string | null }>(
  plans: T[],
): BandwidthGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const p of plans) {
    const key = (p.bandwidth ?? "").trim().toUpperCase();
    const list = by.get(key);
    if (list) list.push(p);
    else by.set(key, [p]);
  }
  return [...by.entries()]
    .map(([key, list]) => ({ key, label: bandwidthLabel(key), plans: list }))
    .sort((a, b) => bandwidthMbps(a.key) - bandwidthMbps(b.key) || a.key.localeCompare(b.key));
}

/**
 * The bandwidth an admin typed, in the shorthand `dealer-offers.ts` records.
 *
 * Grouping keys on the RAW value, so "100 Mbps" and "100M" typed on two
 * different days would otherwise open two speed sections for one speed, each
 * with a count that disagrees with the other. Anything unrecognised is kept
 * verbatim (uppercased) rather than rejected — a new portal speed spelling must
 * not stop a plan being recorded; it lands under "Other speeds".
 */
export function normalizeBandwidth(bandwidth: string | null | undefined): string | null {
  const raw = (bandwidth ?? "").trim().toUpperCase();
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([MG])B?P?S?$/.exec(raw);
  return m ? `${m[1]}${m[2]}` : raw;
}

export interface PlanNameCheck {
  name: string;
  error?: string;
}

/**
 * The plan name as it will be stored.
 *
 * It is matched VERBATIM against the portal's Subscription Plan List, so the
 * only tidying done is collapsing whitespace — a name pasted with a double
 * space would never match the grid row it was copied from, and the mismatch
 * only surfaces mid-submit.
 */
export function normalizePlanName(rawName: string): PlanNameCheck {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (name.length < 5) {
    return { name, error: "Enter the plan name exactly as the portal's plan list writes it." };
  }
  return { name };
}

export interface SellableOffer {
  category: string;
  name: string;
  bandwidth: string;
}

/**
 * The packages the agent's picker may list.
 *
 * Built from the PUBLISHED PLAN ROWS, not by filtering the static catalogue by
 * name: `DEALER_OFFERS` is a transcription of the portal's list, and an admin
 * can record a package it does not carry. Filtering would let such a plan be
 * published into a picker that could never show it.
 *
 * `published` is null while the lookup is in flight — the catalogue stands in,
 * so the dropdown is never briefly empty.
 */
export function sellableOffers(
  published: { name: string; category: string; bandwidth: string | null }[] | null,
  catalogue: SellableOffer[],
): SellableOffer[] {
  if (published === null) return catalogue;
  return published.map((p) => ({
    category: p.category,
    name: p.name,
    bandwidth: p.bandwidth ?? "",
  }));
}

/**
 * The speed chip an offer belongs under.
 *
 * Business and VOF plans are keyed by CATEGORY — their bandwidth is a
 * placeholder `1M` that means nothing to an agent. Everything else is keyed by
 * its bandwidth, whatever that turns out to be.
 *
 * The rule the picker used before was `category === HOME && bandwidth === chip`,
 * expressed once in the filter and again, differently, in the counts. So a
 * published plan whose category was not byte-identical to one of the three
 * portal strings, or whose speed was not one of five hardcoded chips, matched
 * NO chip and was invisible under every one of them — while still being
 * counted in the "All" total. Keying here, once, is what makes that
 * unrepresentable: every offer has a key, so every offer has a chip.
 */
export const NO_SPEED = "?";

export function offerSpeedKey(o: { category: string; bandwidth: string | null }): string {
  if (o.category === "unifi Biz Bundle Sale Catg") return "BIZ";
  if (o.category === "VOF Sales Catg") return "VOF";
  return (o.bandwidth ?? "").trim().toUpperCase() || NO_SPEED;
}

/** The chips in the portal's own order. Anything else found is appended. */
const KNOWN_SPEED_KEYS = ["100M", "300M", "500M", "1G", "2G", "BIZ", "VOF"];

/**
 * Which chips to render, given what is actually sellable.
 *
 * The known ones always render, so the row looks the same as it always has and
 * a zero count still reads as "none at this speed". Any OTHER key present in
 * the published set is appended — which is what stops a plan an admin recorded
 * under a speed or category nobody hardcoded from having nowhere to appear.
 * A new portal speed spelling then needs no deploy, which is the same reason
 * `normalizeBandwidth` keeps an unrecognised value verbatim.
 */
export function speedChipKeys(
  offers: { category: string; bandwidth: string | null }[],
): string[] {
  const present = new Set(offers.map(offerSpeedKey));
  const extra = [...present]
    .filter((k) => !KNOWN_SPEED_KEYS.includes(k))
    .sort((a, b) => bandwidthMbps(a) - bandwidthMbps(b) || a.localeCompare(b));
  return [...KNOWN_SPEED_KEYS, ...extra];
}

/** A chip's label. `NO_SPEED` reads as a state, never as a speed. */
export function speedChipLabel(key: string): string {
  const known: Record<string, string> = {
    "100M": "100Mbps", "300M": "300Mbps", "500M": "500Mbps",
    "1G": "1Gbps", "2G": "2Gbps", BIZ: "Business", VOF: "VOF",
  };
  if (known[key]) return known[key];
  return key === NO_SPEED ? "No speed set" : bandwidthLabel(key);
}

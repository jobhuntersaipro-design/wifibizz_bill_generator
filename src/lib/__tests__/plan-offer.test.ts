import { describe, it, expect } from "vitest";
import {
  deviceRequired,
  isDiscountGroupName,
  nestOfferItems,
  splitPlanOffer,
  toOfferGroupKind,
  type OfferGroupView,
  type OfferItemRow,
} from "@/lib/plan-offer";

function row(p: Partial<OfferItemRow> & { id: string; name: string }): OfferItemRow {
  return { code: null, monthly: null, parentId: null, included: false, ...p };
}

function group(p: Partial<OfferGroupView> & { id: string; name: string }): OfferGroupView {
  return { mandatory: true, kind: "device", items: [], ...p };
}

const tv = { id: "tv", name: "Premium Value Samsung TV 43inch 1 (RM20)", code: "1", monthly: 20, options: [] };
const netflix = {
  id: "nf",
  name: "Netflix Basic (Unifi)",
  code: "2",
  monthly: 0,
  options: [
    { id: "b", name: "Netflix Basic", code: null, monthly: 0, included: true },
    { id: "s", name: "Netflix Standard", code: null, monthly: 20, included: false },
  ],
};
const promo = { id: "p", name: "Promo Discount RM10.90 (Perpetual) - 36 Months", code: null, monthly: -10.9, options: [] };

describe("toOfferGroupKind", () => {
  it("accepts the three kinds and treats anything else as a device", () => {
    expect(toOfferGroupKind("channel")).toBe("channel");
    expect(toOfferGroupKind("discount")).toBe("discount");
    expect(toOfferGroupKind("device")).toBe("device");
    // A row written by an older build, or a value nobody has defined yet.
    expect(toOfferGroupKind(null)).toBe("device");
    expect(toOfferGroupKind("bundle")).toBe("device");
  });
});

describe("isDiscountGroupName — the migration's backfill rule", () => {
  it("matches how the runtime classified groups before kinds existed", () => {
    expect(isDiscountGroupName("Unifi Home 300M Premium Value with Netflix Discount[Pick 0, N]")).toBe(true);
    expect(isDiscountGroupName("Unifi Home 300M Premium Value with Smart Device (36M)[Pick 0-1]")).toBe(false);
    // The Netflix OTT group is NOT a discount, which is why it has to be
    // re-tagged by hand rather than inferred.
    expect(isDiscountGroupName("Unifi Home 300Mbps with Netflix OTT[Pick 0, N]")).toBe(false);
  });
});

describe("nestOfferItems", () => {
  it("hangs the tiers under their item", () => {
    const tree = nestOfferItems([
      row({ id: "nf", name: "Netflix Basic (Unifi)" }),
      row({ id: "b", name: "Netflix Basic", parentId: "nf", included: true }),
      row({ id: "s", name: "Netflix Standard", parentId: "nf", monthly: 20 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].options.map((o) => o.name)).toEqual(["Netflix Basic", "Netflix Standard"]);
    expect(tree[0].options[0].included).toBe(true);
  });

  it("drops an orphan rather than promoting it to the top level", () => {
    // A promoted orphan would reappear in the agent's device picker, which is
    // the exact confusion this feature removes.
    const tree = nestOfferItems([row({ id: "s", name: "Netflix Premium", parentId: "gone" })]);
    expect(tree).toEqual([]);
  });

  it("leaves rows recorded before the third level existed alone", () => {
    const tree = nestOfferItems([row({ id: "tv", name: "Samsung TV" })]);
    expect(tree).toEqual([{ id: "tv", name: "Samsung TV", code: null, monthly: null, options: [] }]);
  });
});

describe("splitPlanOffer", () => {
  it("keeps a channel bundle out of the devices the agent picks from", () => {
    const split = splitPlanOffer([
      group({ id: "g1", name: "…with Netflix OTT[Pick 0, N]", kind: "channel", items: [netflix] }),
      group({ id: "g2", name: "…with Netflix Discount[Pick 0, N]", kind: "discount", items: [promo] }),
      group({ id: "g3", name: "…with Smart Device (36M)[Pick 0-1]", kind: "device", items: [tv] }),
    ]);
    expect(split.devices.map((d) => d.name)).toEqual([tv.name]);
    expect(split.channels.map((c) => c.name)).toEqual([netflix.name]);
    expect(split.discounts.map((d) => d.name)).toEqual([promo.name]);
  });

  it("is known when only a channel is recorded, so the picker doesn't fall back to the catalogue", () => {
    const split = splitPlanOffer([
      group({ id: "g1", name: "…OTT", kind: "channel", items: [netflix] }),
    ]);
    expect(split.devices).toEqual([]);
    expect(split.known).toBe(true);
  });

  it("is not known when nothing has been recorded", () => {
    expect(splitPlanOffer([]).known).toBe(false);
    expect(splitPlanOffer([group({ id: "g", name: "…", items: [] })]).known).toBe(false);
  });
});

describe("deviceRequired", () => {
  it("does not demand a device from a plan that offers none", () => {
    expect(deviceRequired(true, { devices: [], known: true })).toBe(false);
  });

  it("still demands one while the plan's offer is unrecorded", () => {
    // Nothing recorded means the picker is showing the static catalogue, and a
    // "With Device" package does need one — the portal blocks the order without.
    expect(deviceRequired(true, { devices: [], known: false })).toBe(true);
  });

  it("demands one when the plan records devices", () => {
    expect(deviceRequired(true, { devices: [tv], known: true })).toBe(true);
  });

  it("never demands one from a package that carries no device", () => {
    expect(deviceRequired(false, { devices: [tv], known: true })).toBe(false);
  });
});

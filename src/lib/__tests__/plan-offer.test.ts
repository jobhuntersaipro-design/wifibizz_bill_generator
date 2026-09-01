import { describe, it, expect } from "vitest";
import {
  bandwidthLabel,
  deviceRequired,
  groupPlansByBandwidth,
  nestOfferItems,
  normalizeBandwidth,
  normalizePlanName,
  sellableOffers,
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

describe("bandwidth grouping", () => {
  it("spells the portal's shorthand out", () => {
    expect(bandwidthLabel("100M")).toBe("100 Mbps");
    expect(bandwidthLabel("1G")).toBe("1 Gbps");
    expect(bandwidthLabel("500Mbps")).toBe("500 Mbps");
  });

  it("keeps an unrecognised speed rather than inventing one", () => {
    expect(bandwidthLabel("FTTH")).toBe("FTTH");
    expect(bandwidthLabel(null)).toBe("Other speeds");
    expect(bandwidthLabel("  ")).toBe("Other speeds");
  });

  it("orders slowest first, with gigabits above megabits", () => {
    const groups = groupPlansByBandwidth([
      { bandwidth: "1G" },
      { bandwidth: "100M" },
      { bandwidth: "2G" },
      { bandwidth: "300M" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["100M", "300M", "1G", "2G"]);
  });

  it("sorts a plan with no speed last instead of dropping it", () => {
    const groups = groupPlansByBandwidth([{ bandwidth: null }, { bandwidth: "100M" }]);
    expect(groups.map((g) => g.label)).toEqual(["100 Mbps", "Other speeds"]);
    expect(groups[1].plans).toHaveLength(1);
  });

  it("groups on the raw value, so every plan lands in exactly one heading", () => {
    const plans = [
      { bandwidth: "100M" },
      { bandwidth: "100m" },
      { bandwidth: "300M" },
    ];
    const groups = groupPlansByBandwidth(plans);
    expect(groups).toHaveLength(2);
    expect(groups.reduce((n, g) => n + g.plans.length, 0)).toBe(plans.length);
  });
});

describe("normalizeBandwidth", () => {
  it("stores the portal's own shorthand, however the admin typed it", () => {
    expect(normalizeBandwidth("500 Mbps")).toBe("500M");
    expect(normalizeBandwidth(" 1gbps ")).toBe("1G");
    expect(normalizeBandwidth("300m")).toBe("300M");
  });

  it("puts a typed speed in the SAME group as the catalogue's", () => {
    // The grouping keys on the raw value, so two spellings of one speed would
    // otherwise open two sections for it.
    const plans = [{ bandwidth: "100M" }, { bandwidth: normalizeBandwidth("100 Mbps") }];
    expect(groupPlansByBandwidth(plans)).toHaveLength(1);
  });

  it("keeps an unrecognised speed rather than refusing the plan", () => {
    expect(normalizeBandwidth("10G bonded")).toBe("10G BONDED");
    expect(bandwidthLabel(normalizeBandwidth("10G bonded"))).toBe("10G BONDED");
  });

  it("reads a blank speed as none, not as an empty group key", () => {
    expect(normalizeBandwidth("")).toBeNull();
    expect(normalizeBandwidth("   ")).toBeNull();
    expect(normalizeBandwidth(null)).toBeNull();
  });
});

describe("normalizePlanName", () => {
  it("collapses whitespace, which a pasted name never matches the grid with", () => {
    expect(normalizePlanName("  Unifi Home  500Mbps  Premium Value ").name).toBe(
      "Unifi Home 500Mbps Premium Value",
    );
  });

  it("refuses a name too short to be a portal package", () => {
    expect(normalizePlanName("  ").error).toBeTruthy();
    expect(normalizePlanName("Home").error).toBeTruthy();
  });

  it("accepts a real package name unchanged", () => {
    const res = normalizePlanName("Unifi Home 1Gbps Premium Value (30M)");
    expect(res.error).toBeUndefined();
    expect(res.name).toBe("Unifi Home 1Gbps Premium Value (30M)");
  });
});

describe("sellableOffers", () => {
  const catalogue = [
    { category: "unifi Home Bundle Sale Catg", name: "Unifi Home 1Gbps Broadband", bandwidth: "1G" },
  ];

  it("lists a published plan the static catalogue has never carried", () => {
    // The whole point of letting an admin create a plan: filtering the
    // catalogue by name would publish it into a picker that can never show it.
    const offers = sellableOffers(
      [{ name: "Unifi Home 800Mbps Test Plan (36M)", category: "unifi Home Bundle Sale Catg", bandwidth: "800M" }],
      catalogue,
    );
    expect(offers.map((o) => o.name)).toEqual(["Unifi Home 800Mbps Test Plan (36M)"]);
  });

  it("shows the catalogue while the lookup is still in flight", () => {
    expect(sellableOffers(null, catalogue)).toEqual(catalogue);
  });

  it("shows nothing when nothing is published — not the whole catalogue", () => {
    expect(sellableOffers([], catalogue)).toEqual([]);
  });

  it("gives a plan with no speed an empty string, so the speed chips still group it", () => {
    const [offer] = sellableOffers(
      [{ name: "Some VOF package", category: "VOF Sales Catg", bandwidth: null }],
      catalogue,
    );
    expect(offer.bandwidth).toBe("");
  });
});

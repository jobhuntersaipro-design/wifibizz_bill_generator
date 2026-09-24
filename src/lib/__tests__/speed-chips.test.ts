import { describe, expect, it } from "vitest";
import { DEALER_OFFERS, OFFER_CATEGORIES } from "../dealer-offers";
import { NO_SPEED, offerSpeedKey, speedChipKeys, speedChipLabel } from "../plan-offer";

/**
 * Every published plan has a chip to appear under.
 *
 * Reported: plans published on /admin/plans did not show in Order Entry's
 * package picker. The picker filtered with
 *
 *   category === HOME && bandwidth === chip
 *
 * against five hardcoded speeds and three hardcoded category strings, while the
 * admin form validates a plan against neither — the category is a free-text
 * datalist, and `normalizeBandwidth` deliberately keeps an unrecognised speed
 * verbatim so a new portal spelling cannot block a plan. A plan outside both
 * lists therefore matched NO chip, and was invisible under every one of them
 * while still counting towards the "All" total.
 */

/** The rule the picker shipped with, kept so the fix can be shown to fix it. */
const OLD_RULE = (o: { category: string; bandwidth: string | null }, chip: string) =>
  chip === "BIZ" || chip === "VOF"
    ? o.category === OFFER_CATEGORIES[chip]
    : o.category === OFFER_CATEGORIES.HOME && o.bandwidth === chip;

const OLD_CHIPS = ["100M", "300M", "500M", "1G", "2G", "BIZ", "VOF"];

/** Reachable under at least one chip — which is what "shows in the picker" means. */
const hasAChip = (
  o: { category: string; bandwidth: string | null },
  chips: string[],
  rule: (o: { category: string; bandwidth: string | null }, chip: string) => boolean,
) => chips.some((c) => rule(o, c));

const NEW_RULE = (o: { category: string; bandwidth: string | null }, chip: string) =>
  offerSpeedKey(o) === chip;

// The two shapes the admin form lets through, and which the report is about.
const ODD_SPEED = { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 800Mbps", bandwidth: "800M" };
const ODD_CATEGORY = { category: "unifi Home Bundle sale Catg", name: "Typo'd category", bandwidth: "300M" };
const NO_BANDWIDTH = { category: OFFER_CATEGORIES.HOME, name: "Speed left blank", bandwidth: "" };

describe("the reported bug", () => {
  for (const [label, plan] of [
    ["a speed nobody hardcoded", ODD_SPEED],
    ["a category off by one letter", ODD_CATEGORY],
    ["no speed recorded at all", NO_BANDWIDTH],
  ] as const) {
    it(`used to be invisible under every chip: ${label}`, () => {
      // The control. Without it the assertion below could pass on a build that
      // never had the bug.
      expect(hasAChip(plan, OLD_CHIPS, OLD_RULE)).toBe(false);
    });

    it(`now has a chip: ${label}`, () => {
      const chips = speedChipKeys([...DEALER_OFFERS, plan]);
      expect(hasAChip(plan, chips, NEW_RULE)).toBe(true);
    });
  }
});

describe("no offer can be invisible, by construction", () => {
  it("gives every catalogue offer a chip", () => {
    const chips = speedChipKeys(DEALER_OFFERS);
    for (const o of DEALER_OFFERS) expect(chips).toContain(offerSpeedKey(o));
  });

  it("gives every offer a chip whatever the plan set", () => {
    const odd = [ODD_SPEED, ODD_CATEGORY, NO_BANDWIDTH, { category: "", name: "x", bandwidth: null }];
    const chips = speedChipKeys(odd);
    for (const o of odd) expect(chips).toContain(offerSpeedKey(o));
  });

  it("keeps the known chips in the portal's order, extras after", () => {
    const chips = speedChipKeys([...DEALER_OFFERS, ODD_SPEED]);
    expect(chips.slice(0, 7)).toEqual(["100M", "300M", "500M", "1G", "2G", "BIZ", "VOF"]);
    expect(chips).toContain("800M");
  });

  it("adds no chip when nothing odd is published", () => {
    // The row must look exactly as it does today for a normal catalogue.
    expect(speedChipKeys(DEALER_OFFERS)).toEqual(["100M", "300M", "500M", "1G", "2G", "BIZ", "VOF"]);
  });
});

describe("chip keys and labels", () => {
  it("keys Business and VOF by category, since their 1M bandwidth means nothing", () => {
    expect(offerSpeedKey({ category: OFFER_CATEGORIES.BIZ, bandwidth: "1M" })).toBe("BIZ");
    expect(offerSpeedKey({ category: OFFER_CATEGORIES.VOF, bandwidth: "1M" })).toBe("VOF");
  });

  it("labels an unhardcoded speed as a person says it", () => {
    expect(speedChipLabel("800M")).toBe("800 Mbps");
    expect(speedChipLabel("2.5G")).toBe("2.5 Gbps");
  });

  it("labels a missing speed as a state, never as a speed", () => {
    expect(offerSpeedKey({ category: "whatever", bandwidth: null })).toBe(NO_SPEED);
    expect(speedChipLabel(NO_SPEED)).toBe("No speed set");
  });

  it("never keys an offer to the empty string, which the picker uses for All", () => {
    // `speedFilter === ""` means no chip selected. A key of "" would make the
    // All chip and a real chip the same value.
    for (const o of [...DEALER_OFFERS, ODD_SPEED, NO_BANDWIDTH]) {
      expect(offerSpeedKey(o)).not.toBe("");
    }
  });
});

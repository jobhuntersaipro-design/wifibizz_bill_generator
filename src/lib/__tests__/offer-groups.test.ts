import { describe, it, expect } from "vitest";

/**
 * The Offer dialog's grouping rules, mirrored from
 * scraper/oe_feasibility.py (_GROUP_RE / starred_devices / has_starred_group).
 *
 * These are the rules that decide what may be ordered, so they are pinned here
 * against the exact group names seen in the portal.
 */
const GROUP_RE = /\[\s*Pick\s+\d+\s*-\s*[\dN]+\s*\]/i;
const isGroup = (text: string) => GROUP_RE.test(text);
const isStarred = (text: string) => isGroup(text) && text.includes("*");

// Verbatim from the two portal screenshots.
const WITH_DEVICE_500 = [
  "Unifi Home 500Mbps Mesh WIFI [Pick 0-2]",
  "Unifi Home 500Mbps Mesh Deco [Pick 0-5]",
  "Unifi Home 500Mbps VAS [Pick 0-N]",
  "Unifi Home 500Mbps SH Shield Add on Pack [Pick 0-N]",
  "Unifi Home 500Mbps SH Shield Add on Device [Pick 0-N]",
  "Unifi Home Broadband Smart Device (Set H) [Pick 0-1]",
  "Unifi Home 500Mbps Premium Value With Device Discount[Pick 0-1] *",
  "Unifi Home 500Mbps Premium Value With Device[Pick 0-1] *",
];

const PLAIN_100 = [
  "Unifi Home 100Mbps Mesh WIFI [Pick 0-2]",
  "Unifi Home 100Mbps Mesh Deco [Pick 0-5]",
  "Unifi Home 100Mbps VAS [Pick 0-N]",
  "Unifi Home 100Mbps SH Shield Add on Pack [Pick 0-N]",
  "Unifi Home 100Mbps SH Shield Add on Device [Pick 0-N]",
  "Unifi Home 100Mbps Premium Value (36M) Discount [Pick 0-N]",
  "Unifi Home Broadband Smart Device (Set J) [Pick 0-2]",
];

describe("offer group detection", () => {
  it("recognises every group header by its pick-range", () => {
    for (const g of [...WITH_DEVICE_500, ...PLAIN_100]) {
      expect(isGroup(g), g).toBe(true);
    }
  });

  it("does not treat a device row as a group", () => {
    // Device rows carry a price, never a pick-range.
    expect(isGroup("Premium Value Samsung TV 55inch 1 (RM20)")).toBe(false);
    expect(isGroup("Promo Discount RM10 (Perpetual) - 36 Months")).toBe(false);
  });

  it("finds exactly the two mandatory groups on a with-device package", () => {
    const starred = WITH_DEVICE_500.filter(isStarred);
    expect(starred).toEqual([
      "Unifi Home 500Mbps Premium Value With Device Discount[Pick 0-1] *",
      "Unifi Home 500Mbps Premium Value With Device[Pick 0-1] *",
    ]);
  });

  it("finds no mandatory group on a package that takes no device", () => {
    // This is what tells us to skip the device step entirely rather than
    // ordering something the package never asked for.
    expect(PLAIN_100.filter(isStarred)).toEqual([]);
  });

  it("does not mistake a [Pick 0-N] discount for a mandatory group", () => {
    // The 100Mbps package HAS a discount group, but unstarred — optional, and
    // not ours to tick.
    const discount = "Unifi Home 100Mbps Premium Value (36M) Discount [Pick 0-N]";
    expect(isGroup(discount)).toBe(true);
    expect(isStarred(discount)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  deviceCategory,
  deviceFamily,
  groupDevices,
  isAmbiguousDevice,
  DEVICE_CATEGORY_COUNTS,
  variantLabel,
} from "@/lib/device-catalog";
import { DEALER_DEVICES } from "@/lib/dealer-devices";

describe("deviceCategory", () => {
  it("buckets the main device types", () => {
    expect(deviceCategory("Apple 11-inch iPad Wi-Fi 128GB – Blue (RM10)")).toBe("Tablet");
    expect(deviceCategory("SAMSUNG Tab WiFi (24mth contract)")).toBe("Tablet");
    expect(deviceCategory("SHARP 55inch TV (24mth contract)")).toBe("TV");
    expect(deviceCategory("Smart Home Motion Sensor")).toBe("Smart Home");
    expect(deviceCategory("Mesh Wifi Deco BE65")).toBe("Mesh Wi-Fi");
    expect(deviceCategory("Asus Expertbook (24mth contract)")).toBe("Laptop & PC");
  });

  it("files a PlayStation+TV bundle under Gaming, not TV", () => {
    expect(deviceCategory("PlayStation 5 + SHARP TV 65inch (24mth contract)")).toBe("Gaming");
    expect(deviceCategory("Sony PS5 Digital Edition")).toBe("Gaming");
  });

  it("separates line items that are not devices at all", () => {
    expect(deviceCategory("Stamp Duty")).toBe("Charges & discounts");
    expect(deviceCategory("Professional Charge")).toBe("Charges & discounts");
    expect(deviceCategory("Promo Discount RM10 (Perpetual) - 36 Months")).toBe("Charges & discounts");
  });

  it("puts protection packs in add-on packs", () => {
    expect(deviceCategory("Unifi Home Shield Complete Protection Pack")).toBe("Add-on packs");
  });

  it("classifies every catalog entry", () => {
    for (const d of DEALER_DEVICES) expect(deviceCategory(d.name)).toBeTruthy();
    const total = Object.values(DEVICE_CATEGORY_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(DEALER_DEVICES.length);
  });
});

describe("deviceFamily", () => {
  it("splits a colour/price variant off the model", () => {
    expect(deviceFamily("Apple 11-inch iPad Wi-Fi 256GB – Blue (RM31)")).toEqual({
      family: "Apple 11-inch iPad Wi-Fi 256GB",
      variant: "Blue (RM31)",
    });
  });

  it("splits a trailing parenthetical", () => {
    expect(deviceFamily("SHARP 55inch TV (24mth contract)")).toEqual({
      family: "SHARP 55inch TV",
      variant: "24mth contract",
    });
  });

  it("leaves a plain name whole", () => {
    expect(deviceFamily("Smart Home Smart Hub")).toEqual({
      family: "Smart Home Smart Hub",
      variant: "",
    });
  });
});

describe("variantLabel", () => {
  it("drops the price the RM/mth column already shows", () => {
    expect(variantLabel("Blue (RM31)", 31)).toBe("Blue");
  });

  it("keeps a contract term alongside the dropped price", () => {
    expect(variantLabel("Blue (RM10)(36M)", 10)).toBe("Blue (36M)");
  });

  it("leaves the variant intact when there is no price column", () => {
    expect(variantLabel("24mth contract", null)).toBe("24mth contract");
  });

  it("falls back to the original when stripping would empty it", () => {
    expect(variantLabel("RM59", 59)).toBe("RM59");
    expect(variantLabel("(RM59)", 59)).toBe("(RM59)");
  });
});

describe("groupDevices", () => {
  const tablets = DEALER_DEVICES.filter((d) => deviceCategory(d.name) === "Tablet");

  it("collapses the two big iPad families into headed groups", () => {
    const groups = groupDevices(tablets);
    const headers = groups.map((g) => g.header);
    expect(headers).toContain("Apple 11-inch iPad Wi-Fi 256GB");
    expect(headers).toContain("Apple 11-inch iPad Wi-Fi 128GB");
    const big = groups.find((g) => g.header === "Apple 11-inch iPad Wi-Fi 256GB")!;
    expect(big.items.length).toBe(21);
  });

  it("puts one-off models in a single bucket at the end", () => {
    const groups = groupDevices(tablets);
    const last = groups[groups.length - 1]!;
    expect(last.singles).toBe(true);
    expect(last.header).toBe("Individual models");
    expect(last.items.length).toBeGreaterThan(1);
  });

  it("sorts a group cheapest first, unpriced last", () => {
    const groups = groupDevices(tablets);
    const big = groups.find((g) => g.header === "Apple 11-inch iPad Wi-Fi 256GB")!;
    const priced = big.items.filter((d) => d.monthly !== null).map((d) => d.monthly as number);
    expect([...priced].sort((a, b) => a - b)).toEqual(priced);
    const firstNullAt = big.items.findIndex((d) => d.monthly === null);
    if (firstNullAt !== -1) {
      expect(big.items.slice(firstNullAt).every((d) => d.monthly === null)).toBe(true);
    }
  });

  it("keeps every input device (nothing dropped by grouping)", () => {
    const groups = groupDevices(tablets);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(tablets.length);
  });

  it("returns nothing for an empty list", () => {
    expect(groupDevices([])).toEqual([]);
  });
});

describe("isAmbiguousDevice", () => {
  it("flags names the portal repeats under different codes", () => {
    expect(isAmbiguousDevice("Smart Home Solar Outdoor Camera (7 days video Cloud Storage)")).toBe(true);
    expect(isAmbiguousDevice("Smart Home Door/Window Sensor")).toBe(true);
  });

  it("leaves unique names alone", () => {
    expect(isAmbiguousDevice("Smart Home Advance Pack")).toBe(false);
    expect(isAmbiguousDevice("Stamp Duty")).toBe(false);
  });
});

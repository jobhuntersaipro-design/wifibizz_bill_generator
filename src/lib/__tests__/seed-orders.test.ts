import { describe, expect, it } from "vitest";

import { validateMalaysianAddress } from "@/lib/malaysia-address";
import { parseMykad } from "@/lib/mykad";
import { keywordCandidates } from "@/lib/seed-address-keywords";
import { SEED_REMARK, seedCustomer, seedIdNumber } from "@/lib/seed-customer";
import {
  cheapestDevice,
  isOfferCategoryRow,
  isWithDevice,
  offerCategoryFor,
  pickOffer,
} from "@/lib/seed-offer";

describe("seedIdNumber", () => {
  it("always produces an ID the app can parse", () => {
    // A row whose ID does not parse would reach the portal with no gender and
    // no birthday, and fail its validation rather than the submit under test.
    for (let n = 0; n < 200; n++) {
      expect(parseMykad(seedIdNumber(n, 4242))).not.toBeNull();
    }
  });

  it("never repeats an ID within a run", () => {
    // A repeat sends the submit down the multiple_customer_records path, which
    // is a different code path from the one these drafts exist to exercise.
    const ids = Array.from({ length: 200 }, (_, n) => seedIdNumber(n, 4242));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives different runs different IDs", () => {
    expect(seedIdNumber(0, 1)).not.toBe(seedIdNumber(0, 2));
  });

  it("encodes a real calendar date, February included", () => {
    // The day is capped at 28 precisely so a 31st of February can never be
    // generated — parseMykad rejects those, and the throw would land mid-run.
    const days = Array.from({ length: 200 }, (_, n) => seedIdNumber(n, 7).slice(4, 6));
    expect(Math.max(...days.map(Number))).toBeLessThanOrEqual(28);
  });
});

describe("seedCustomer", () => {
  it("is deterministic in n and runId", () => {
    expect(seedCustomer(3, 99)).toEqual(seedCustomer(3, 99));
  });

  it("reports the gender and birthday its own ID encodes", () => {
    // Read back with the app's parser rather than tracked alongside: if the two
    // disagreed, the portal would see the parsed values and the row would say
    // something else.
    const c = seedCustomer(5, 99);
    expect(parseMykad(c.idNumber)).toEqual({ gender: c.gender, birthday: c.birthday });
  });

  it("marks the row as generated", () => {
    expect(SEED_REMARK).toMatch(/SEED DRAFT/);
  });
});

describe("pickOffer", () => {
  const OFFERS = [
    "Unifi Home 500Mbps Premium Value With Device (36M)",
    "Unifi Home 100Mbps Premium Value (36M)",
  ];

  it("prefers a package without a device by default", () => {
    expect(pickOffer(OFFERS)?.offerName).toBe("Unifi Home 100Mbps Premium Value (36M)");
  });

  it("takes a device bundle when asked, and fills the device", () => {
    const picked = pickOffer(OFFERS, true);
    expect(picked?.offerName).toBe("Unifi Home 500Mbps Premium Value With Device (36M)");
    expect(picked?.deviceCode).toBeTruthy();
    expect(picked?.deviceName).toBeTruthy();
  });

  it("still picks when only device bundles are offered", () => {
    // Preference, not requirement — reporting "no offers" for an address that
    // listed one would be a lie about what the portal said.
    const picked = pickOffer(["Unifi Home 500Mbps Premium Value With Device (36M)"]);
    expect(picked?.offerName).toContain("With Device");
    expect(picked?.deviceCode).toBeTruthy();
  });

  it("never picks a grid category header as the package", () => {
    // Seen live: the portal's plan grid returns its group headers looking exactly
    // like offers. Picking one writes a package that does not exist into the
    // draft, and the submit only finds out at the plan step.
    const withHeaders = [
      "unifi Biz Bundle Sale Catg",
      "Unifi Business 300Mbps (MESH6)",
      "unifi Home Bundle Sale Catg",
      "Unifi Home 1Gbps Broadband",
    ];
    expect(pickOffer(withHeaders)?.offerName).toBe("Unifi Business 300Mbps (MESH6)");
    expect(isOfferCategoryRow("unifi Home Bundle Sale Catg")).toBe(true);
    expect(isOfferCategoryRow("VOF Sales Catg")).toBe(true);
    expect(isOfferCategoryRow("Unifi Home 1Gbps Broadband")).toBe(false);
  });

  it("returns null when a grid held nothing but category headers", () => {
    expect(pickOffer(["unifi Home Bundle Sale Catg"])).toBeNull();
  });

  it("returns null when the portal listed nothing", () => {
    // The caller must skip the address, never substitute a package of its own —
    // that substitution is exactly how the BSP 21 drafts came about.
    expect(pickOffer([])).toBeNull();
    expect(pickOffer(["", "   "])).toBeNull();
  });

  it("never attaches a charge line item as a device", () => {
    const device = cheapestDevice();
    expect(device?.name).not.toMatch(/STAMP DUTY|PROMO DISCOUNT|PROFESSIONAL CHARGE/i);
    expect(device?.monthly).not.toBeNull();
  });

  it("recognises a device bundle by name", () => {
    expect(isWithDevice("Unifi Home 500Mbps Premium Value With Device (36M)")).toBe(true);
    expect(isWithDevice("Unifi Home 100Mbps Premium Value (36M)")).toBe(false);
  });

  it("falls back to the Home category for an offer the catalog has not got", () => {
    // The portal's grid is live truth and the transcribed catalog lags it, so an
    // unknown name means a stale catalog, not an unusable offer.
    expect(offerCategoryFor("Unifi Home 9Gbps Something New (12M)")).toContain("Catg");
  });
});

describe("keywordCandidates", () => {
  const LINE = "NO 12, JALAN SS 15/4B, 47500 SUBANG JAYA, SELANGOR";

  it("drops the postcode, the state and MALAYSIA", () => {
    // The portal stores street text without them; leaving them in returns nothing.
    const [first] = keywordCandidates(LINE, "Selangor");
    expect(first).not.toMatch(/47500|SELANGOR|MALAYSIA/);
    expect(first).toContain("JALAN SS 15/4B");
  });

  it("offers a wider retry without the leading house number", () => {
    const candidates = keywordCandidates(LINE, "Selangor");
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[1]).not.toMatch(/^NO 12/);
  });

  it("does not repeat the same search twice", () => {
    const candidates = keywordCandidates("JALAN GASING PETALING JAYA SELANGOR", "Selangor");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("returns nothing for an empty line", () => {
    expect(keywordCandidates("", "Selangor")).toEqual([]);
  });
});

describe("the address a seeded draft stores", () => {
  it("accepts a portal concatAddress with the double spaces the portal emits", () => {
    // The portal's own strings carry runs of whitespace where an upstream
    // segment was blank ("3 -  TAMAN"), and its Address field then marks them
    // n-invalid. Normalizing before the write is what keeps the row editable.
    const fromPortal = "NO 3 -  JALAN  BESAR,  43300 SERI KEMBANGAN,  SELANGOR";
    expect(validateMalaysianAddress(fromPortal.replace(/\s+/g, " ").trim()).ok).toBe(true);
  });
});

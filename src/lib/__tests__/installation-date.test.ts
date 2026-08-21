import { describe, it, expect } from "vitest";
import { erfKey, needsInstallationDate } from "@/lib/installation-date";

const order = (over: Partial<Parameters<typeof needsInstallationDate>[0]> = {}) => ({
  id: "o1",
  userId: "u1",
  orderId: "2608000121625616",
  status: "submitted",
  installationDate: null,
  installationCheckedAt: null,
  ...over,
});

describe("erfKey", () => {
  it("matches the key the scraper writes", () => {
    // Derived on both sides from the same three parts (scraper r2_upload.erf_key).
    // If these ever drift, every lookup silently misses and the column goes
    // blank without an error anywhere — hence pinning the exact string.
    expect(erfKey("u1", "o9", "2608000121625616")).toBe(
      "order-screenshots/u1/o9/2608000121625616_erf.pdf",
    );
  });

  it("strips anything that would break a key or a URL", () => {
    expect(erfKey("u", "o", "2608/000 121")).toBe("order-screenshots/u/o/2608000121_erf.pdf");
    expect(erfKey("u", "o", "../../etc")).toBe("order-screenshots/u/o/etc_erf.pdf");
  });

  it("never produces a bare underscore name", () => {
    expect(erfKey("u", "o", "")).toBe("order-screenshots/u/o/order_erf.pdf");
  });
});

describe("needsInstallationDate", () => {
  it("wants a completed order that has never been read", () => {
    expect(needsInstallationDate(order())).toBe(true);
  });

  it("never reads twice", () => {
    // The whole point of the checked-at column. A second load must do no work,
    // including for an order whose e-RF printed no appointment at all.
    expect(needsInstallationDate(order({ installationCheckedAt: new Date() }))).toBe(false);
    expect(
      needsInstallationDate({
        ...order(),
        installationDate: null,
        installationCheckedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("leaves alone every status that has no e-RF", () => {
    // Only a run that went through Pay produces one — `submitted` is decided on
    // erf_key in the first place. Probing R2 for any other status is a
    // guaranteed miss on every page load.
    for (const status of ["draft", "submitting", "order_entered", "warning", "failed", "cancelled"]) {
      expect(needsInstallationDate(order({ status }))).toBe(false);
    }
  });

  it("cannot build a key without a portal order number", () => {
    expect(needsInstallationDate(order({ orderId: null }))).toBe(false);
  });
});

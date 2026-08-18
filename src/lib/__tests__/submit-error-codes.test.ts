import { describe, it, expect } from "vitest";
import {
  SUBMIT_ERROR_CODES,
  portalCodeFrom,
  submitErrorCopy,
} from "@/lib/order-types";

const STOCK_MESSAGE =
  '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.';

describe("submitErrorCopy", () => {
  it("explains a device out-of-stock refusal and names the fix", () => {
    const copy = submitErrorCopy("device_out_of_stock");
    expect(copy?.title).toBe("Device out of stock");
    // The whole point of classifying: the portal says what is wrong, this says
    // which field to change.
    expect(copy?.fix.toLowerCase()).toContain("device");
    expect(copy?.subtext.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown code so the raw message still renders", () => {
    // A code the scraper learns before the UI does must degrade to the old
    // behaviour, never to a blank panel.
    expect(submitErrorCopy("some_future_code")).toBeNull();
  });

  it("returns null for null/undefined/empty", () => {
    expect(submitErrorCopy(null)).toBeNull();
    expect(submitErrorCopy(undefined)).toBeNull();
    expect(submitErrorCopy("")).toBeNull();
  });

  it("keeps every entry complete — a half-filled entry renders a gap", () => {
    for (const [code, copy] of Object.entries(SUBMIT_ERROR_CODES)) {
      expect(copy.title, code).toBeTruthy();
      expect(copy.subtext, code).toBeTruthy();
      expect(copy.fix, code).toBeTruthy();
    }
  });
});

describe("portalCodeFrom", () => {
  it("pulls the portal's code out of its message", () => {
    expect(portalCodeFrom(STOCK_MESSAGE)).toBe("40300338");
  });

  it("ignores the RESERVELOGIN field marker", () => {
    // "[1]:LOGIN_ID [tklee812@iptv] already in use" — [1] is a field index, not
    // an error code, and showing it as one would be worse than showing nothing.
    expect(
      portalCodeFrom("RESERVELOGIN error. [1]:LOGIN_ID [tklee812@iptv] already in use"),
    ).toBeNull();
  });

  it("returns null when there is no code, or no message at all", () => {
    expect(portalCodeFrom("The portal returned an error.")).toBeNull();
    expect(portalCodeFrom(null)).toBeNull();
    expect(portalCodeFrom(undefined)).toBeNull();
  });

  it("tolerates padding inside the brackets", () => {
    expect(portalCodeFrom("[ 40300338 ]: out of stock")).toBe("40300338");
  });
});

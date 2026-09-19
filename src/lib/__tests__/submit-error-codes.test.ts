import { describe, it, expect } from "vitest";
import {
  ERF_NOT_DOWNLOADED,
  errorShortLabel,
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

  it("names a blacklisted IC and never offers a resubmit", () => {
    const copy = submitErrorCopy("blacklisted_ic");
    // The user asked for this exact title: it is what the agent reads on the
    // row, in the e-mail and on the detail page.
    expect(copy?.title).toBe("Blacklisted IC");
    // The refusal lands before the Order click, so there is no portal order to
    // void — saying otherwise sends an agent hunting for one that never existed.
    expect(copy?.subtext.toLowerCase()).toContain("nothing to void");
    // contact_admin, not resubmit: the same IC gets the same answer.
    expect(copy?.action).toBe("contact_admin");
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

describe("the e-RF completeness code", () => {
  it("has copy, so a missing registration form never renders a blank panel", () => {
    // Unlike every other code here this one is NOT matched from portal wording —
    // the portal never says it. It is our own completeness rule, so if the copy
    // is ever dropped the agent sees an unexplained warning on every order.
    const copy = submitErrorCopy(ERF_NOT_DOWNLOADED);
    expect(copy?.title).toBe("No e-RF (registration form)");
    expect(copy?.fix).toMatch(/portal/i);
  });

  it("keeps the same string the scraper emits", () => {
    // scraper/oe_errors.py ERF_NOT_DOWNLOADED. These are two constants in two
    // languages naming one code; drift makes the panel silently fall back to
    // the raw message.
    expect(ERF_NOT_DOWNLOADED).toBe("erf_not_downloaded");
    expect(SUBMIT_ERROR_CODES[ERF_NOT_DOWNLOADED]).toBeDefined();
  });
});


describe("errorShortLabel", () => {
  it("cases the acronyms a slug spells lowercase", () => {
    // The reported bug: the admin Error column printed "Blacklisted ic".
    expect(errorShortLabel("blacklisted_ic")).toBe("Blacklisted IC");
    expect(errorShortLabel("customer_ic_name_mismatch")).toBe("Customer IC name mismatch");
    expect(errorShortLabel("erf_not_downloaded")).toBe("ERF not downloaded");
    expect(errorShortLabel("msr_customer_id_limit")).toBe("MSR customer ID limit");
    expect(errorShortLabel("login_id_taken")).toBe("Login ID taken");
  });

  it("reads sensibly for an ordinary code", () => {
    expect(errorShortLabel("device_out_of_stock")).toBe("Device out of stock");
    expect(errorShortLabel("address_not_found")).toBe("Address not found");
  });

  it("labels a code nobody has written copy for", () => {
    // Only ~10 of the scraper's codes have copy. Building the label from the
    // code is what lets the column say something for the other ~45.
    expect(SUBMIT_ERROR_CODES["order_id_not_found"]).toBeUndefined();
    expect(errorShortLabel("order_id_not_found")).toBe("Order ID not found");
  });

  it("matches the admin table's Unclassified bucket", () => {
    expect(errorShortLabel("unclassified")).toBe("Unclassified");
  });

  it("returns null for nothing at all, so the caller can show a dash", () => {
    expect(errorShortLabel(null)).toBeNull();
    expect(errorShortLabel(undefined)).toBeNull();
    expect(errorShortLabel("")).toBeNull();
    expect(errorShortLabel("__")).toBeNull();
  });
});

describe("next_click_failed", () => {
  it("has copy so the UI does not render the internal nonext token as the title", () => {
    const copy = submitErrorCopy("next_click_failed");
    expect(copy?.title).toBeTruthy();
    expect(copy?.title.toLowerCase()).not.toContain("nonext");
    expect(copy?.subtext.toLowerCase()).not.toContain("nonext");
    expect(copy?.fix.toLowerCase()).not.toContain("nonext");
    expect(copy?.action).toBe("check_portal");
  });
});

describe("pii_verification_required", () => {
  it("says the code goes to the customer, not to the agent", () => {
    const copy = submitErrorCopy("pii_verification_required");
    // The one thing an agent must take from this row: nothing in the draft is
    // at fault, and the missing piece is on the customer's phone.
    expect(copy?.subtext.toLowerCase()).toContain("customer's own");
    expect(copy?.fix.toLowerCase()).toContain("otp");
    // Not resubmit: the same dialog is waiting on the other side of one.
    expect(copy?.action).toBe("check_portal");
  });

  it("reads as an acronym in a table cell", () => {
    // Humanising the slug alone would print "Pii verification required".
    expect(errorShortLabel("pii_verification_required")).toBe(
      "PII verification required",
    );
  });
});

/**
 * What a failed submit tells the agent to DO.
 *
 * The prose remedy already existed; this is the button. The rules pinned here
 * are the ones whose failure would look like a working button pointing at the
 * wrong thing.
 */
import { describe, it, expect } from "vitest";
import { actionFor, contactAdminNote } from "@/lib/failure-action";
import { SUBMIT_ERROR_CODES } from "@/lib/order-types";
import { sectionOf, groupMissing, isFormSection, FORM_SECTIONS, SECTION_SHORT } from "@/lib/order-sections";

const failed = (over: Partial<Parameters<typeof actionFor>[0]> = {}) => ({
  status: "failed", errorCode: null, orderId: null, autoRetries: 0, autoRetryAt: null, ...over,
});

describe("every code has a button", () => {
  it("resolves each entry in the copy table to an action", () => {
    for (const [code, copy] of Object.entries(SUBMIT_ERROR_CODES)) {
      const r = actionFor(failed({ errorCode: code, orderId: "2608000121750632" }));
      expect(r.action, code).toBe(copy.action);
      if (copy.action === "fix_field") expect(r.section, code).toBe(copy.section);
      else expect(r.section, code).toBeNull();
    }
  });

  it("gives every fix_field entry a section", () => {
    // A "fix the draft" button with nowhere to open is the bug this exists to prevent.
    for (const [code, copy] of Object.entries(SUBMIT_ERROR_CODES)) {
      if (copy.action === "fix_field") expect(copy.section, code).toBeDefined();
    }
  });

  it("falls back to contact_admin for a code nobody has mapped", () => {
    const r = actionFor(failed({ errorCode: "something_new" }));
    expect(r.action).toBe("contact_admin");
    expect(r.copy).toBeNull();
  });

  it("falls back to contact_admin for no code at all", () => {
    expect(actionFor(failed()).action).toBe("contact_admin");
  });
});

describe("state overrides the code", () => {
  it("says wait while a retry is owed, whatever the code", () => {
    const r = actionFor(failed({
      errorCode: "device_out_of_stock", autoRetries: 1, autoRetryAt: new Date(Date.now() + 60_000),
    }));
    expect(r.action).toBe("wait");
    expect(r.section).toBeNull();
  });

  it("never offers check_portal without a portal order to check", () => {
    // A dead button that points at a record that does not exist.
    const r = actionFor(failed({ errorCode: "submit_stopped", orderId: null }));
    expect(r.action).toBe("contact_admin");
    const ok = actionFor(failed({ errorCode: "submit_stopped", orderId: "2608000121750632" }));
    expect(ok.action).toBe("check_portal");
  });

  it("knows BizzFlow's own codes as well as the scraper's", () => {
    expect(actionFor(failed({ errorCode: "session_expired" })).action).toBe("reconnect");
    expect(actionFor(failed({ errorCode: "portal_timeout" })).action).toBe("resubmit");
    expect(actionFor(failed({ errorCode: "abandoned", orderId: "x" })).action).toBe("check_portal");
  });
});

describe("the contact_admin note", () => {
  it("names the code and the reference so the admin can find it", () => {
    expect(contactAdminNote({ errorCode: "vobb_unavailable", reference: "ORD-0042" }))
      .toBe("Tell your admin: vobb_unavailable on ORD-0042.");
  });
  it("copes with neither", () => {
    expect(contactAdminNote({ errorCode: null, reference: null }))
      .toBe("Tell your admin: an unclassified failure.");
  });
});

describe("form sections", () => {
  it("places every required field on a card", () => {
    const REQUIRED = ["ID Number", "Full Name", "Email", "Contact Number", "Full Address",
      "Postcode", "State", "City", "Package", "MyKad / Passport", "Supporting Document"];
    for (const label of REQUIRED) expect(FORM_SECTIONS).toContain(sectionOf(label));
  });

  it("refuses a required field nobody placed, loudly", () => {
    // Silently defaulting would send the agent to the wrong card with total confidence.
    expect(() => sectionOf("Shoe Size")).toThrow(/not placed/);
  });

  it("groups missing fields by card, in card order", () => {
    const g = groupMissing([
      { label: "Supporting Document", section: "documents" },
      { label: "Postcode", section: "address" },
      { label: "Full Name", section: "customer" },
      { label: "City", section: "address" },
    ]);
    expect(g.map((x) => x.section)).toEqual(["customer", "address", "documents"]);
    expect(g[1].fields).toEqual(["Postcode", "City"]);
    expect(g[1].label).toBe("Address");
  });

  it("validates a ?focus= value", () => {
    expect(isFormSection("address")).toBe(true);
    expect(isFormSection("nope")).toBe(false);
    expect(isFormSection(null)).toBe(false);
  });
});

describe("short section labels", () => {
  it("are unique — single initials gave Customer and Contact the same chip", () => {
    const shorts = FORM_SECTIONS.map((s) => SECTION_SHORT[s]);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});

import { describe, it, expect } from "vitest";
import {
  validateMalaysianAddress,
  parseMalaysianAddress,
  toPortalState,
  addressKey,
} from "@/lib/malaysia-address";

// The shape the portal itself returns as `concatAddress`.
const REFERENCE =
  "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 FTTH BSP 21 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610";

describe("validateMalaysianAddress", () => {
  it("accepts the reference address and derives postcode/state/city", () => {
    const r = validateMalaysianAddress(REFERENCE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcode).toBe("42610");
    expect(r.state).toBe("Selangor");
    expect(r.city).toBe("JENJAROM");
    expect(r.hint).toBeUndefined();
  });

  it("accepts a lowercase address (the field uppercases, but be tolerant)", () => {
    const r = validateMalaysianAddress(REFERENCE.toLowerCase());
    expect(r.ok).toBe(true);
  });

  // Rule 1 — too short / too few tokens
  it("rejects a street fragment", () => {
    const r = validateMalaysianAddress("PERSIARAN SAUJANA PUTRA UTAMA 7");
    expect(r).toEqual({ ok: false, reason: "Enter the full address, not just the street." });
  });

  it("rejects an empty address", () => {
    expect(validateMalaysianAddress("")).toEqual({
      ok: false,
      reason: "Enter the installation address.",
    });
  });

  // Rule 2 — postcode
  it("rejects an address with no postcode", () => {
    const r = validateMalaysianAddress(
      "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA"
    );
    expect(r).toEqual({ ok: false, reason: "Missing a 5-digit postcode." });
  });

  it("rejects an address with two 5-digit numbers", () => {
    const r = validateMalaysianAddress(
      "A-07-15 JALAN SAUJANA 12345 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610"
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("More than one 5-digit number");
  });

  // Rule 3 — state
  it("rejects an address with no recognisable state", () => {
    const r = validateMalaysianAddress(
      "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM MALAYSIA 42610"
    );
    expect(r).toEqual({ ok: false, reason: "Couldn't find a Malaysian state in the address." });
  });

  it("resolves a state alias (PENANG -> Pulau Pinang)", () => {
    const r = validateMalaysianAddress("NO 12 JALAN BUKIT GAMBIR TANJUNG BUNGAH PENANG MALAYSIA 10000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toBe("Pulau Pinang");
  });

  it("takes the state from the END, not a street named after another state", () => {
    // "JALAN PERAK" is a real Pulau Pinang street — the trailing state must win.
    const r = validateMalaysianAddress("NO 88 JALAN PERAK GEORGETOWN PULAU PINANG MALAYSIA 10150");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toBe("Pulau Pinang");
  });

  // Rule 4 — postcode/state agreement (the rule that catches real typos)
  it("rejects a postcode that belongs to a different state", () => {
    const r = validateMalaysianAddress(
      "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM PAHANG MALAYSIA 42610"
    );
    expect(r).toEqual({
      ok: false,
      reason: "Postcode 42610 belongs to SELANGOR, but the address says PAHANG.",
    });
  });

  it("allows a postcode the dataset doesn't know", () => {
    const r = validateMalaysianAddress("NO 1 JALAN TEST SATU KAMPUNG BARU SELANGOR MALAYSIA 99999");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.city).toBeUndefined();
  });

  // Rule 6 — street / unit token
  it("rejects an address with no street or unit marker", () => {
    const r = validateMalaysianAddress("SOMEWHERE OVER THERE SOMEPLACE ELSE SELANGOR MALAYSIA 42610");
    expect(r).toEqual({ ok: false, reason: "Include the street / unit (e.g. A-07-15 PERSIARAN …)." });
  });

  // Rule 7 — MALAYSIA is a soft hint, not a requirement
  it("accepts an address without MALAYSIA but returns a hint", () => {
    const r = validateMalaysianAddress(
      "A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM SELANGOR 42610"
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hint).toContain("MALAYSIA");
  });

  it("accepts a KL address and maps it to the portal's federal-territory name", () => {
    const r = validateMalaysianAddress("NO 5 JALAN AMPANG BUKIT NANAS KUALA LUMPUR MALAYSIA 50450");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toBe("Kuala Lumpur");
    expect(toPortalState(r.state)).toBe("W.P. KUALA LUMPUR");
  });
});

describe("toPortalState", () => {
  it("passes ordinary states through uppercased", () => {
    expect(toPortalState("Selangor")).toBe("SELANGOR");
    expect(toPortalState("Negeri Sembilan")).toBe("NEGERI SEMBILAN");
  });

  it("maps the three federal territories to their W.P. names", () => {
    expect(toPortalState("Kuala Lumpur")).toBe("W.P. KUALA LUMPUR");
    expect(toPortalState("Putrajaya")).toBe("W.P. PUTRAJAYA");
    expect(toPortalState("Labuan")).toBe("W.P. LABUAN");
  });

  it("returns null for anything the portal doesn't list", () => {
    expect(toPortalState("Atlantis")).toBeNull();
  });
});


describe("parseMalaysianAddress", () => {
  it("extracts parts without validating", () => {
    expect(parseMalaysianAddress(REFERENCE)).toEqual({
      postcode: "42610",
      state: "Selangor",
      city: "JENJAROM",
    });
  });

  it("returns undefined parts for junk", () => {
    expect(parseMalaysianAddress("hello")).toEqual({
      postcode: undefined,
      state: undefined,
      city: undefined,
    });
  });
});

describe("addressKey", () => {
  it("ignores punctuation, case and spacing differences", () => {
    expect(addressKey("NO.12, Jalan Mawar 3,  43000 Kajang, Selangor")).toBe(
      addressKey("no 12 jalan mawar 3 43000 kajang selangor"),
    );
  });

  it("ignores a trailing MALAYSIA", () => {
    expect(addressKey(REFERENCE)).toBe(addressKey(REFERENCE.replace(" MALAYSIA", "")));
  });

  it("keeps genuinely different addresses apart", () => {
    expect(addressKey("NO 12 JALAN MAWAR 3 43000 KAJANG SELANGOR")).not.toBe(
      addressKey("NO 13 JALAN MAWAR 3 43000 KAJANG SELANGOR"),
    );
  });

  it("returns an empty key for nothing comparable", () => {
    expect(addressKey("")).toBe("");
    expect(addressKey("  ,, -- ")).toBe("");
  });
});

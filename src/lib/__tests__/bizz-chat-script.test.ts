import { describe, it, expect } from "vitest";
import {
  BIZZ_AGREEMENT_REPLY,
  BIZZ_TERMS,
  buildBizzScriptLines,
  formatBizzInstallDate,
  type BizzScriptInput,
} from "../bizz-chat-script";

const FILLED: BizzScriptInput = {
  customerName: "PHONG KONE LEE",
  contactNumber: "+60148893212",
  customerId: "201501012345",
  businessOwnerName: "PHONG KONE LEE",
  email: "phong@example.com",
  installationAddress: "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
  packageName: "Unifi Biz 100Mbps + Router",
  createdAt: "2026-03-28T12:00:00",
  installOffsetDays: 3,
  representativeName: "AI CHAT BOT (ACE999)",
};

const EMPTY: BizzScriptInput = {
  customerName: null,
  contactNumber: null,
  customerId: null,
  businessOwnerName: null,
  email: null,
  installationAddress: null,
  packageName: null,
  createdAt: "2026-03-28T12:00:00",
  installOffsetDays: 0,
  representativeName: null,
};

const AC_LABELS = [
  "Customer Name (as per NRIC/Passport) :",
  "Contact Number :",
  "Customer ID ( i.e BRN):",
  "Business Owner Name:",
  "Email Address :",
  "Installation Address:",
  "Billing Address :",
  "Package to be subscribed :",
  "Preferred Installation Date :",
  "Representative Name ( if any) :",
] as const;

describe("buildBizzScriptLines", () => {
  it("returns the ten AC labels with exact spacing and no numbered prefixes", () => {
    const lines = buildBizzScriptLines(FILLED);
    expect(lines).toHaveLength(10);
    expect(lines.map((l) => l.label)).toEqual([...AC_LABELS]);
    for (const line of lines) {
      expect(line.label).not.toMatch(/^\d+\./);
    }
  });

  it("fills every field from a complete fixture and never uses placeholders there", () => {
    const lines = buildBizzScriptLines(FILLED);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel["Customer Name (as per NRIC/Passport) :"]).toBe("PHONG KONE LEE");
    expect(byLabel["Contact Number :"]).toBe("60148893212");
    expect(byLabel["Customer ID ( i.e BRN):"]).toBe("201501012345");
    expect(byLabel["Business Owner Name:"]).toBe("PHONG KONE LEE");
    expect(byLabel["Email Address :"]).toBe("phong@example.com");
    expect(byLabel["Installation Address:"]).toBe(
      "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
    );
    expect(byLabel["Package to be subscribed :"]).toBe("Unifi Biz 100Mbps");
    expect(byLabel["Preferred Installation Date :"]).toBe("31/03/2026");
    expect(byLabel["Representative Name ( if any) :"]).toBe("AI CHAT BOT (ACE999)");
    expect(Object.values(byLabel)).not.toContain("—");
  });

  it("always sets Billing Address to SAME AS ABOVE, not a copied installation address", () => {
    const filled = buildBizzScriptLines(FILLED).find((l) => l.label === "Billing Address :");
    const empty = buildBizzScriptLines(EMPTY).find((l) => l.label === "Billing Address :");
    expect(filled?.value).toBe("SAME AS ABOVE");
    expect(empty?.value).toBe("SAME AS ABOVE");
  });

  it("uses an em dash for missing fields and a hyphen when there is no representative", () => {
    const byLabel = Object.fromEntries(
      buildBizzScriptLines(EMPTY).map((l) => [l.label, l.value]),
    );
    expect(byLabel["Customer Name (as per NRIC/Passport) :"]).toBe("—");
    expect(byLabel["Contact Number :"]).toBe("—");
    expect(byLabel["Customer ID ( i.e BRN):"]).toBe("—");
    expect(byLabel["Business Owner Name:"]).toBe("—");
    expect(byLabel["Email Address :"]).toBe("—");
    expect(byLabel["Installation Address:"]).toBe("—");
    expect(byLabel["Package to be subscribed :"]).toBe("—");
    expect(byLabel["Representative Name ( if any) :"]).toBe("-");
    expect(byLabel["Preferred Installation Date :"]).toBe("28/03/2026");
  });

  it("treats whitespace-only fields as missing", () => {
    const byLabel = Object.fromEntries(
      buildBizzScriptLines({
        ...EMPTY,
        customerName: "   ",
        contactNumber: " + ",
        representativeName: "  ",
        packageName: "   ",
      }).map((l) => [l.label, l.value]),
    );
    expect(byLabel["Customer Name (as per NRIC/Passport) :"]).toBe("—");
    expect(byLabel["Contact Number :"]).toBe("—");
    expect(byLabel["Package to be subscribed :"]).toBe("—");
    expect(byLabel["Representative Name ( if any) :"]).toBe("-");
  });
});

describe("BIZZ_TERMS and agreement", () => {
  it("exports the four T&C strings without leading checkmarks", () => {
    expect(BIZZ_TERMS).toEqual([
      "I hereby consent to subscribed the service with subscription contract of 24/36months.",
      "I have been informed on the Terms & Condition as at https://biz.unifi.com.my/business/biz-tnc and Privacy Notice of TM",
      "I agree to pay advance payment of RM 100 within 10 days after installation complete",
      "I hereby consent TM representative to proceed and process my order. Kindly notify me if there is any issues pertaining to my request.",
    ]);
    for (const term of BIZZ_TERMS) {
      expect(term.startsWith("✅")).toBe(false);
    }
  });

  it("uses lowercase i agreed as the reply", () => {
    expect(BIZZ_AGREEMENT_REPLY).toBe("i agreed");
  });
});

describe("formatBizzInstallDate", () => {
  it("adds offsetDays onto createdAt as DD/MM/YYYY", () => {
    expect(formatBizzInstallDate("2026-03-28T12:00:00", 3)).toBe("31/03/2026");
    expect(formatBizzInstallDate("2026-03-28T12:00:00", 0)).toBe("28/03/2026");
  });
});

describe("exported script helpers", () => {
  it("do not carry Conversation Chat consent copy", () => {
    const dumped = JSON.stringify({
      terms: BIZZ_TERMS,
      reply: BIZZ_AGREEMENT_REPLY,
      lines: buildBizzScriptLines(FILLED),
    });
    expect(dumped).not.toMatch(/By replying/);
    expect(dumped).not.toMatch(/YES I AGREED/);
  });
});

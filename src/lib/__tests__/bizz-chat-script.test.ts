import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBizzChatScript, type BizzChatSource } from "../bizz-chat-script";
import type { ChatScript } from "../chat-script";

const CASE: BizzChatSource = {
  full_name: "MONBLEU CAFE(JM0920662-D)",
  mobile: "+60148893212",
  id_no: "981020016087",
  email: "phong@example.com",
  full_address: "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
  package: "Unifi Biz 100Mbps + Router",
  case_created_at: "2026-03-28T12:00:00",
  company_reg: "JM0920662-D",
  director_name: "TIAN ZI XUAN",
};

const EMPTY: BizzChatSource = {
  full_name: null,
  mobile: null,
  id_no: null,
  email: null,
  full_address: null,
  package: null,
  case_created_at: "2026-03-28T12:00:00",
};

// What the chrome prints, line for line: label then value on one line, the
// heading over the ✅-prefixed terms, a gap, then the customer's reply.
function asChatText(script: ChatScript): string {
  return [
    ...script.lines.map((l) => l.label + l.value),
    "",
    "Terms & Conditions:",
    ...script.terms.map((t) => `✅ ${t}`),
    "",
    script.agreement,
  ].join("\n");
}

describe("buildBizzChatScript", () => {
  it("prints the ticket's template word for word from a full case", () => {
    expect(asChatText(buildBizzChatScript(CASE, 3))).toBe(
      [
        "Customer Name (as per NRIC/Passport) : MONBLEU CAFE(JM0920662-D)",
        "Contact Number : 60148893212",
        "Customer ID ( i.e BRN): JM0920662-D",
        "Business Owner Name: TIAN ZI XUAN",
        "Email Address : phong@example.com",
        "Installation Address: C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
        "Billing Address : SAME AS ABOVE",
        "Package to be subscribed : Unifi Biz 100Mbps",
        "Preferred Installation Date : 31/03/2026",
        "Representative Name ( if any) : -",
        "",
        "Terms & Conditions:",
        "✅ I hereby consent to subscribed the service with subscription contract of 24/36months.",
        "✅ I have been informed on the Terms & Condition as at https://biz.unifi.com.my/business/biz-tnc and Privacy Notice of TM",
        "✅ I agree to pay advance payment of RM 100 within 10 days after installation complete",
        "✅ I hereby consent TM representative to proceed and process my order. Kindly notify me if there is any issues pertaining to my request.",
        "",
        "i agreed",
      ].join("\n"),
    );
  });

  // The chrome prints a heading and a consent sentence only when the script
  // carries them; the Bizz template has neither ("UNIFI" and "By replying YES"
  // belong to the Conversation Chat).
  it("carries only lines, terms and the reply", () => {
    expect(Object.keys(buildBizzChatScript(CASE, 3)).sort()).toEqual(["agreement", "lines", "terms"]);
  });

  it("dashes what the case lacks, and never the billing or representative lines", () => {
    expect(buildBizzChatScript(EMPTY, 0).lines.map((l) => l.label + l.value)).toEqual([
      "Customer Name (as per NRIC/Passport) : —",
      "Contact Number : —",
      "Customer ID ( i.e BRN): —",
      "Business Owner Name: —",
      "Email Address : —",
      "Installation Address: —",
      "Billing Address : SAME AS ABOVE",
      "Package to be subscribed : —",
      "Preferred Installation Date : 28/03/2026",
      "Representative Name ( if any) : -",
    ]);
  });

  it("treats whitespace-only fields and a digit-less phone number as missing", () => {
    const lines = buildBizzChatScript(
      { ...EMPTY, full_name: "   ", mobile: " + ", package: "   " },
      0,
    ).lines;
    const value = (label: string) => lines.find((l) => l.label === label)?.value;
    expect(value("Customer Name (as per NRIC/Passport) : ")).toBe("—");
    expect(value("Business Owner Name: ")).toBe("—");
    expect(value("Contact Number : ")).toBe("—");
    expect(value("Package to be subscribed : ")).toBe("—");
  });

  it("never prints NRIC as Customer ID or the company as Business Owner", () => {
    const lines = buildBizzChatScript(
      {
        ...CASE,
        company_reg: null,
        director_name: null,
      },
      3,
    ).lines;
    const value = (label: string) => lines.find((l) => l.label === label)?.value;
    expect(value("Customer ID ( i.e BRN): ")).toBe("JM0920662-D");
    expect(value("Business Owner Name: ")).toBe("—");
    expect(value("Customer ID ( i.e BRN): ")).not.toBe("981020016087");
    expect(value("Business Owner Name: ")).not.toBe("MONBLEU CAFE(JM0920662-D)");
  });

  describe("preferred installation date", () => {
    afterEach(() => vi.useRealTimers());

    // Order Entry has no creation date, so the offset counts from today, the
    // same way the Conversation Chat's date does.
    it("counts from today when the source has no creation date", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0));
      const line = buildBizzChatScript({ ...CASE, case_created_at: null }, 5).lines[8];
      expect(line).toEqual({ label: "Preferred Installation Date : ", value: "15/09/2026" });
    });

    it("rolls over the month end", () => {
      expect(buildBizzChatScript(CASE, 4).lines[8].value).toBe("01/04/2026");
    });
  });
});

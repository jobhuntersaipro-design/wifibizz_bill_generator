import { describe, expect, it } from "vitest";
import {
  buildConsentChatScript,
  contractMonths,
  fillConsentTemplate,
  formatMobileRaw,
} from "../chat-script";
import { feeFromPackageName, formatFee, parseMonthlyFee } from "../plan-offer";

// The ticket's template (ClickUp z8v9xnjzb8), copied verbatim, [XX] included.
const TICKET = `1.	Customer Name (as per NRIC/Passport/BRN) :
2.	Contact Number :
3.	Customer IC (NRIC/Passport/BRN) :
4.	Email Address :
5.	Installation Address :
6.	Billing Address :
7.	Order Type (New Install / Upgrade / Add-On / Other) :
8.	Package / Service to be Subscribed :
9.	Monthly Subscription Fee :
10.	Contract Period (if applicable) :
11.	Preferred Installation Date (if applicable) :
12.	Representative Name (for Business customers, if applicable) :
13.	Existing Service Login ID / Account Number (for Upgrade or Add-On orders, if applicable) :

Terms & Conditions:
✅ I hereby consent to subscribe to the above service/package with a contract period of *[XX] months* (if applicable).
✅  I acknowledge that I have been informed, understood and agree to be bound by the applicable Terms & Conditions and TM Privacy Notice available at:
•	Consumer Customers: https://unifi.com.my/personal/home/fibre-broadband/tnc
•	Business Customers: https://biz.unifi.com.my/business/biz-tnc
✅  As a Business Customer representative, I confirm that I am authorised to act on behalf of the Company and in a capacity to request the subscription, upgrade or any add on with regards to the service.
✅  I agree to subscribe to the service/package at the monthly fee of *RM[XX]* (if applicable).
✅  For new installations, customers are required to pay any applicable advance payment starting from RM100, in accordance with TM's prevailing policies. Foreign customers shall be subject to a mandatory deposit of RM500. The deposit must be paid prior to the submission of the installation order, while the advance payment must be settled within fourteen (14) days after the completion of the installation order.
✅  I understand and agree that early termination of the service/package may result to early termination penalty based on the remaining contract commitment including any outstanding fees, device penalty (including where the device has already been processed, dispatched or delivered) and/or other applicable charges (if applicable).
✅  I acknowledge and agree that the service/package order cannot be cancelled once the order has been submitted for processing.
✅ I acknowledge that free installation covers up to 50 meters under Standard Installation. Additional charges may apply for cabling beyond 50 meters or any Non-Standard Installation works. For details, refer to the https://unifi.com.my/support/installation
✅  I confirm that all information and supporting documents provided to TM is true, accurate, complete and genuine.
✅  I hereby authorize TM and its representatives to verify and process my order. Kindly notify me if there are any issues pertaining to my request.
✅  I acknowledge that this confirmation, whether provided electronically, digitally, verbally through recorded channels, or by any other method accepted by TM, shall constitute valid evidence of my consent and agreement to the service/package subscription and applicable contractual obligation`;

const CASE = {
  full_name: "TAN AH KOW",
  mobile: "+60137089093",
  id_no: "900101-14-5678",
  email: "tan@example.com",
  full_address: "12 JALAN MAWAR 3 TAMAN BUNGA 43000 KAJANG SELANGOR",
  package: "Unifi Home 300Mbps Premium Value (36M)",
  case_created_at: "2026-11-01T02:00:00Z",
  preferred_install_date: "2026-11-20",
};

describe("TM consent template", () => {
  it("is the ticket text character for character (AC1)", () => {
    expect(fillConsentTemplate({ fields: [], months: "[XX]", fee: "[XX]" })).toBe(TICKET);
  });

  it("fills all 13 fields and both placeholders from the order (AC2, AC3)", () => {
    const { text, agreement } = buildConsentChatScript(CASE, { variant: "conversation", monthlyFee: "139.00" });
    const line = (n: number) => text.split("\n")[n - 1];
    expect(line(1)).toBe("1.\tCustomer Name (as per NRIC/Passport/BRN) : TAN AH KOW");
    expect(line(2)).toBe("2.\tContact Number : +60 13-708 9093");
    expect(line(3)).toBe("3.\tCustomer IC (NRIC/Passport/BRN) : 900101-14-5678");
    expect(line(4)).toBe("4.\tEmail Address : tan@example.com");
    expect(line(5)).toContain(": 12 JALAN MAWAR 3 TAMAN BUNGA 43000 KAJANG SELANGOR");
    expect(line(6)).toBe("6.\tBilling Address : SAME AS ABOVE");
    expect(line(7)).toBe("7.\tOrder Type (New Install / Upgrade / Add-On / Other) : New Install");
    expect(line(8)).toBe("8.\tPackage / Service to be Subscribed : Unifi Home 300Mbps Premium Value (36M)");
    expect(line(9)).toBe("9.\tMonthly Subscription Fee : RM139");
    expect(line(10)).toBe("10.\tContract Period (if applicable) : 36 months");
    expect(line(11)).toBe("11.\tPreferred Installation Date (if applicable) : 20/11/2026");
    expect(text).toContain("contract period of *36 months*");
    expect(text).toContain("monthly fee of *RM139*");
    expect(agreement).toBe("YES I AGREED");
  });

  it("leaves empty fields blank, never null/undefined/N/A/[XX] (AC4)", () => {
    const { text } = buildConsentChatScript(
      { full_name: null, mobile: null, id_no: null, email: null, full_address: null, package: "No term plan", case_created_at: null },
      { variant: "conversation", monthlyFee: "99" },
    );
    expect(text).not.toMatch(/null|undefined|N\/A|\[XX\]|—/);
    expect(text.split("\n")[0]).toBe("1.\tCustomer Name (as per NRIC/Passport/BRN) :");
    expect(text.split("\n")[9]).toBe("10.\tContract Period (if applicable) :");
    expect(text.split("\n")[11]).toBe("12.\tRepresentative Name (for Business customers, if applicable) :");
  });

  it("prints field 12 and the Business line for both variants; bizz prints the BRN (AC5)", () => {
    for (const variant of ["conversation", "bizz"] as const) {
      const { text } = buildConsentChatScript({ ...CASE, company_reg: "202301012345" }, { variant, monthlyFee: "1" });
      expect(text).toContain("12.\tRepresentative Name");
      expect(text).toContain("As a Business Customer representative");
      expect(text.split("\n")[2]).toBe(
        `3.\tCustomer IC (NRIC/Passport/BRN) : ${variant === "bizz" ? "202301012345" : "900101-14-5678"}`,
      );
    }
  });

  it("prints contract months the agent entered when the plan name has none", () => {
    const { text } = buildConsentChatScript(
      { ...CASE, package: "Unifi Home 500Mbps" },
      { variant: "conversation", monthlyFee: "189", contractMonths: "24" },
    );
    expect(text.split("\n")[9]).toBe("10.\tContract Period (if applicable) : 24 months");
    expect(text).toContain("contract period of *24 months*");
  });

  it("defaults the install date to the case date + 3 days", () => {
    const { text } = buildConsentChatScript({ ...CASE, preferred_install_date: null }, { variant: "conversation", monthlyFee: "1" });
    expect(text.split("\n")[10]).toMatch(/: 04\/11\/2026$/);
  });
});

describe("helpers", () => {
  it("reads the contract from the plan name", () => {
    expect(contractMonths("Unifi Home 100Mbps Broadband (24M)")).toBe("24");
    expect(contractMonths("Unifi Home 500Mbps")).toBe("");
  });

  it("parses a monthly fee", () => {
    expect(parseMonthlyFee("139")).toBe(139);
    expect(parseMonthlyFee("RM 1,139.50")).toBe(1139.5);
    expect(parseMonthlyFee("")).toBeNull();
    expect(parseMonthlyFee("abc")).toBeUndefined();
    expect(parseMonthlyFee("0")).toBeUndefined();
    expect(parseMonthlyFee("1.234")).toBeUndefined();
  });

  it("reads the price written in the plan name", () => {
    expect(feeFromPackageName("Unifi Home 500Mbps Premium Value With Device TV 65inch RM189")).toBe(189);
    expect(feeFromPackageName("Unifi Biz RM 139.50 promo")).toBe(139.5);
    expect(feeFromPackageName("Unifi Home 300Mbps Premium Value (36M)")).toBeNull();
  });

  it("prints whole ringgit without decimals", () => {
    expect(formatFee(189)).toBe("189");
    expect(formatFee(139.5)).toBe("139.50");
  });

  it("formats mobiles from both entry points the same way", () => {
    expect(formatMobileRaw("+60137089093")).toBe("+60 13-708 9093");
    expect(formatMobileRaw("60137089093")).toBe("+60 13-708 9093");
  });
});

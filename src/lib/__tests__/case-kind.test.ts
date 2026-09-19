import { describe, expect, it } from "vitest";
import {
  closingScriptVariant,
  isBusinessCase,
  parseCompanyPair,
  resolveBizzChatFields,
  umobileBillCustomerName,
  UMOBILE_BILL_LABEL,
  UMOBILE_BILL_SHORT,
} from "../case-kind";

describe("parseCompanyPair", () => {
  it("splits the crawled list-view company(BRN) shape", () => {
    expect(parseCompanyPair("MONBLEU CAFE(JM0920662-D)")).toEqual({
      companyName: "MONBLEU CAFE",
      companyReg: "JM0920662-D",
    });
  });

  it("rejects a plain personal name", () => {
    expect(parseCompanyPair("TIAN ZI XUAN")).toBeNull();
    expect(parseCompanyPair("PHONG KONE LEE")).toBeNull();
  });

  it("rejects blanks", () => {
    expect(parseCompanyPair(null)).toBeNull();
    expect(parseCompanyPair("   ")).toBeNull();
    expect(parseCompanyPair("()")).toBeNull();
  });
});

describe("isBusinessCase", () => {
  it("treats Unifi Business / Business Fibre product text as business", () => {
    expect(isBusinessCase({ provider: "Unifi Business" })).toBe(true);
    expect(isBusinessCase({ provider: "Unifi Business With Device" })).toBe(true);
    expect(isBusinessCase({ package: "Unifi Business Fibre 300Mbps" })).toBe(true);
    expect(isBusinessCase({ provider: "Unifi Premium Value" })).toBe(false);
    expect(isBusinessCase({ package: "Unifi Home 500Mbps" })).toBe(false);
  });

  it("treats the WifiBizz biz_fibre module as the Bizz tag", () => {
    expect(
      isBusinessCase({
        provider: "TIME FTTH",
        case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      }),
    ).toBe(true);
    expect(
      isBusinessCase({
        case_url: "https://wifibizz.com/applications/1?module=home_fibre",
      }),
    ).toBe(false);
  });

  it("treats the Order Entry Biz catalogue as business", () => {
    expect(isBusinessCase({ offer_category: "unifi Biz Bundle Sale Catg" })).toBe(true);
    expect(isBusinessCase({ offer_category: "unifi Home Bundle Sale Catg" })).toBe(false);
  });

  it("treats an explicit Bizz tag token as business", () => {
    expect(isBusinessCase({ tags: "Bizz" })).toBe(true);
    expect(isBusinessCase({ tags: "follow-up, Bizz" })).toBe(true);
    expect(isBusinessCase({ tags: "Business-ish" })).toBe(false);
  });

  it("treats company fields, including COMPANY(REG) in full_name, as business", () => {
    expect(isBusinessCase({ company_name: "MONBLEU CAFE" })).toBe(true);
    expect(isBusinessCase({ company_reg: "JM0920662-D" })).toBe(true);
    expect(isBusinessCase({ full_name: "MONBLEU CAFE(JM0920662-D)" })).toBe(true);
    expect(isBusinessCase({ full_name: "TIAN ZI XUAN" })).toBe(false);
  });

  it("XORs the visible closing-script button", () => {
    expect(closingScriptVariant({ provider: "Unifi Business" })).toBe("bizz");
    expect(closingScriptVariant({ full_name: "MONBLEU CAFE(JM0920662-D)" })).toBe("bizz");
    expect(closingScriptVariant({ provider: "Unifi Premium Value", package: "Unifi Home 500Mbps" })).toBe(
      "conversation",
    );
  });

  it("is normal when none of the signals fire", () => {
    expect(
      isBusinessCase({
        provider: "Unifi Premium Value",
        package: "Unifi Home 500Mbps",
        full_name: "NURSUEHAIDA BINTI JAFFAR HAS",
        case_url: "https://wifibizz.com/applications/2?module=home_fibre",
      }),
    ).toBe(false);
  });
});

describe("resolveBizzChatFields", () => {
  it("maps the golden case: BRN from company_reg, owner from director Name", () => {
    expect(
      resolveBizzChatFields({
        full_name: "MONBLEU CAFE(JM0920662-D)",
        company_reg: "JM0920662-D",
        director_name: "TIAN ZI XUAN",
      }),
    ).toEqual({
      customerId: "JM0920662-D",
      businessOwnerName: "TIAN ZI XUAN",
    });
  });

  it("parses BRN out of COMPANY(REG) when company_reg was never stored", () => {
    expect(
      resolveBizzChatFields({
        full_name: "MONBLEU CAFE(JM0920662-D)",
        director_name: "TIAN ZI XUAN",
      }),
    ).toEqual({
      customerId: "JM0920662-D",
      businessOwnerName: "TIAN ZI XUAN",
    });
  });

  it("never falls back to NRIC or the company name", () => {
    expect(
      resolveBizzChatFields({
        full_name: "MONBLEU CAFE(JM0920662-D)",
      }),
    ).toEqual({
      customerId: "JM0920662-D",
      businessOwnerName: null,
    });
  });

  it("uses a personal full_name as owner when the case is not COMPANY(REG)", () => {
    expect(
      resolveBizzChatFields({
        full_name: "PHONG KONE LEE",
        company_reg: "201501012345",
      }),
    ).toEqual({
      customerId: "201501012345",
      businessOwnerName: "PHONG KONE LEE",
    });
  });
});

describe("umobileBillCustomerName", () => {
  const residentialNric = "TAN PEI SHAN(940924045066)";

  it("keeps a residential name+(NRIC) when no business signal is present", () => {
    expect(umobileBillCustomerName(residentialNric)).toBe(residentialNric);
    expect(
      umobileBillCustomerName(residentialNric, {
        full_name: residentialNric,
        case_url: "https://wifibizz.com/applications/1?module=home_fibre",
        provider: "Unifi Premium Value",
        package: "Unifi Home 500Mbps",
      }),
    ).toBe(residentialNric);
  });

  it("does not treat NAME(NRIC) as COMPANY(REG) just because full_name parses", () => {
    expect(umobileBillCustomerName(residentialNric, { full_name: residentialNric })).toBe(
      residentialNric,
    );
  });

  it("strips a digit parenthetical on a Business Fibre / biz_fibre case", () => {
    expect(
      umobileBillCustomerName(residentialNric, {
        case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      }),
    ).toBe("TAN PEI SHAN");
    expect(
      umobileBillCustomerName(residentialNric, {
        provider: "Unifi Business",
        package: "Unifi Business Fibre 300Mbps",
      }),
    ).toBe("TAN PEI SHAN");
  });

  it("strips COMPANY(letter-BRN) even when other signals were not passed", () => {
    expect(umobileBillCustomerName("MONBLEU CAFE(JM0920662-D)")).toBe("MONBLEU CAFE");
    expect(umobileBillCustomerName("U Mobile Sdn. Bhd.(223969-U)")).toBe("U Mobile Sdn. Bhd.");
  });

  it("strips a 12-digit new-format BRN when company_reg or the Biz catalogue is set", () => {
    expect(
      umobileBillCustomerName("ACME SDN BHD(201501012345)", { company_reg: "201501012345" }),
    ).toBe("ACME SDN BHD");
    expect(
      umobileBillCustomerName("ACME SDN BHD(201501012345)", {
        offer_category: "unifi Biz Bundle Sale Catg",
      }),
    ).toBe("ACME SDN BHD");
  });

  it("leaves a plain name alone", () => {
    expect(umobileBillCustomerName("PHONG KONE LEE")).toBe("PHONG KONE LEE");
    expect(
      umobileBillCustomerName("PHONG KONE LEE", {
        case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      }),
    ).toBe("PHONG KONE LEE");
  });

  it("exports the Umobile labels the UI surfaces share", () => {
    expect(UMOBILE_BILL_LABEL).toBe("Umobile Bill");
    expect(UMOBILE_BILL_SHORT).toBe("Umobile");
  });
});

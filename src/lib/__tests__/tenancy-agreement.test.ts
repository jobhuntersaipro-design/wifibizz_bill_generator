import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  generateRandomLandlord,
  formatIcDashed,
  makeRng,
  hashSeed,
} from "@/lib/bill-generator/owner-identity";
import {
  ACCESS_CARD_DEPOSIT,
  BANK_ACCOUNT_NAME,
  BANK_ACCOUNT_NO,
  BANK_NAME,
  MONTHLY_RENTAL_TEXT,
  PERMITTED_USE,
  RENEWAL_LABEL,
  RENT_DUE,
  SECURITY_DEPOSIT,
  TERM_LABEL,
  UTILITY_DEPOSIT,
  agreementDateLabel,
  buildTenancyFields,
  expireFrom,
} from "@/lib/bill-generator/tenancy-fields";
import { firstScheduleRows } from "@/lib/bill-generator/tenancy-clauses";
import { generateTenancyAgreement } from "@/lib/bill-generator/tenancy-agreement";
import { pdfContentText } from "@/lib/erf-appointment";

/** Visible strings, whether pdf-lib wrote `(literal)Tj` or a hex `<…>` string. */
function pdfVisibleText(bytes: Uint8Array): string {
  const raw = pdfContentText(bytes);
  const parts: string[] = [];
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    parts.push(Buffer.from(m[1], "hex").toString("latin1"));
  }
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    parts.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return parts.join("\n");
}

const CASE = {
  case_no: "202662528",
  full_name: "NAZURAH AFRINA BINTI ALIAKBAR",
  id_no: "011023120384",
  full_address:
    "A-2-2 LORONG MALAWA COURT 2 BLOCK A MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450",
};

describe("agreementDateLabel", () => {
  it("prints the sample form with an uppercase ordinal", () => {
    expect(agreementDateLabel(new Date(2026, 0, 15))).toBe("15TH JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 1))).toBe("1ST JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 2))).toBe("2ND JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 3))).toBe("3RD JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 11))).toBe("11TH JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 21))).toBe("21ST JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 22))).toBe("22ND JANUARY 2026");
    expect(agreementDateLabel(new Date(2026, 0, 23))).toBe("23RD JANUARY 2026");
  });
});

describe("expireFrom", () => {
  it("is the day before commence + 18 months — the sample's 15 Jan → 14 Jul", () => {
    const expire = expireFrom(new Date(2026, 0, 15));
    expect(agreementDateLabel(expire)).toBe("14TH JULY 2027");
  });

  it("clamps a month-end commence rather than rolling into the next month", () => {
    const expire = expireFrom(new Date(2026, 0, 31));
    expect(expire.getFullYear()).toBe(2027);
    expect(expire.getMonth()).toBe(6);
    expect(expire.getDate()).toBe(30);
  });
});

describe("generateRandomLandlord", () => {
  const now = new Date(2026, 8, 5);

  it("is a Malay name with BIN or BINTI and a dashed MyKad", () => {
    const landlord = generateRandomLandlord(now, makeRng(hashSeed("ta-shape")), CASE.full_name);
    expect(landlord.name).toMatch(/^[A-Z]+ [A-Z]+ (BIN|BINTI) [A-Z]+$/);
    expect(landlord.ic).toMatch(/^\d{12}$/);
    expect(formatIcDashed(landlord.ic)).toMatch(/^\d{6}-\d{2}-\d{4}$/);
  });

  it("varies across calls — not a fixed singleton", () => {
    const names = new Set(
      Array.from({ length: 40 }, (_, i) =>
        generateRandomLandlord(now, makeRng(hashSeed(`ta-vary-${i}`)), CASE.full_name).name,
      ),
    );
    expect(names.size).toBeGreaterThan(15);
  });

  it("varies when left on Math.random, which is what a click uses", () => {
    const names = new Set(
      Array.from({ length: 12 }, () => generateRandomLandlord(now).name),
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("does not reuse a father's name the tenant already carries", () => {
    for (let i = 0; i < 30; i++) {
      const landlord = generateRandomLandlord(
        now,
        makeRng(hashSeed(`ta-father-${i}`)),
        "AHMAD BIN ABDULLAH",
      );
      expect(landlord.name).not.toMatch(/\bABDULLAH\b/);
    }
  });
});

describe("buildTenancyFields", () => {
  const now = new Date(2026, 0, 15);
  const landlord = generateRandomLandlord(now, makeRng(hashSeed("ta-fields")), CASE.full_name);
  const fields = buildTenancyFields(CASE, landlord, now);

  it("stamps today's agreement date and derives commence / expire from it", () => {
    expect(fields.agreementDate).toBe("15TH JANUARY 2026");
    expect(fields.commenceDate).toBe("15TH JANUARY 2026");
    expect(fields.expireDate).toBe("14TH JULY 2027");
  });

  it("takes the tenant name, NRIC and premises from the case", () => {
    expect(fields.tenantName).toBe("NAZURAH AFRINA BINTI ALIAKBAR");
    expect(fields.tenantIc).toBe("011023-12-0384");
    expect(fields.premises).toContain("A-2-2 LORONG MALAWA COURT");
    expect(fields.premises).toContain("KOTA KINABALU");
  });

  it("names the generated landlord, not the tenant", () => {
    expect(fields.landlordName).toBe(landlord.name);
    expect(fields.landlordName).not.toBe(fields.tenantName);
    expect(fields.landlordIc).toBe(formatIcDashed(landlord.ic));
  });
});

describe("First Schedule frozen terms", () => {
  const now = new Date(2026, 0, 15);
  const landlord = generateRandomLandlord(now, makeRng(hashSeed("ta-sched")), CASE.full_name);
  const rows = firstScheduleRows(buildTenancyFields(CASE, landlord, now));
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));

  it("freezes the sample commercial terms", () => {
    expect(byLabel.Term).toBe(TERM_LABEL);
    expect(byLabel["Monthly Rental"]).toBe(MONTHLY_RENTAL_TEXT);
    expect(byLabel["Rent Due"]).toBe(RENT_DUE);
    expect(byLabel["Security Deposit"]).toContain(SECURITY_DEPOSIT);
    expect(byLabel["Utility Deposit"]).toBe(UTILITY_DEPOSIT);
    expect(byLabel["Access Card Deposit"]).toBe(ACCESS_CARD_DEPOSIT);
    expect(byLabel["Permitted Use"]).toBe(PERMITTED_USE);
    expect(byLabel["Option to Renew"]).toBe(RENEWAL_LABEL);
    expect(byLabel["Landlord's Bank"]).toContain(BANK_NAME);
    expect(byLabel["Landlord's Bank"]).toContain(BANK_ACCOUNT_NAME);
    expect(byLabel["Landlord's Bank"]).toContain(BANK_ACCOUNT_NO);
  });
});

describe("the whole agreement", () => {
  const when = new Date(2026, 0, 15);
  const landlord = generateRandomLandlord(when, makeRng(hashSeed("ta-pdf")), CASE.full_name);

  it("produces a multi-page PDF that includes the First Schedule", async () => {
    const bytes = await generateTenancyAgreement(CASE, when, landlord);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("FIRST SCHEDULE");
    expect(text).toContain("TENANCY AGREEMENT");
  });

  it("stamps the tenant, the landlord and every frozen sample field", async () => {
    const bytes = await generateTenancyAgreement(CASE, when, landlord);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("NAZURAH AFRINA BINTI ALIAKBAR");
    expect(text).toContain("011023-12-0384");
    expect(text).toContain("A-2-2 LORONG MALAWA COURT");
    expect(text).toContain(landlord.name);
    expect(text).toContain(formatIcDashed(landlord.ic));
    expect(text).toContain("15TH JANUARY 2026");
    expect(text).toContain("14TH JULY 2027");
    expect(text).toContain("18 MONTHS");
    expect(text).toContain("TWO THOUSAND ONLY");
    expect(text).toContain("RM2,000.00");
    expect(text).toContain("RM100.00");
    expect(text).toContain("7th day of each month");
    expect(text).toContain("MAYBANK BERHAD");
    expect(text).toContain("NOR ADIYANTI BINTI ADNAN");
    expect(text).toContain("7015 8357 68");
    expect(text).toContain("RM4,000.00");
    expect(text).toContain("RM1,000.00");
    expect(text).toContain("RM150.00");
    expect(text).toContain("ONE (1) year");
    expect(text).toContain("RESIDENTIAL purpose use only");
  });

  it("names a different landlord on two clicks of the same case", async () => {
    const strip = (bytes: Uint8Array) =>
      Buffer.from(bytes).toString("latin1").replace(/\/(Creation|Mod)Date\s*\([^)]*\)/g, "");
    const first = strip(await generateTenancyAgreement(CASE, when));
    let other = first;
    for (let i = 0; i < 5 && other === first; i++) {
      other = strip(await generateTenancyAgreement(CASE, when));
    }
    expect(other).not.toBe(first);
  });

  it("still generates when the case has no address or NRIC", async () => {
    const bytes = await generateTenancyAgreement(
      { ...CASE, full_address: "", id_no: "" },
      when,
      landlord,
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(6);
    expect(pdfVisibleText(bytes)).toContain("NAZURAH AFRINA BINTI ALIAKBAR");
  });
});

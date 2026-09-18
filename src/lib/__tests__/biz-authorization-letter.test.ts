import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  companyLine,
  formatContactNumber,
  generateBizAuthorizationLetter,
  letterheadLines,
  resolveBizLetterFields,
} from "@/lib/bill-generator/biz-authorization-letter";
import { authLetterVariant, AUTH_LETTER_LABEL } from "@/lib/case-kind";
import { generatableDocTypes } from "@/lib/order-documents";
import { buildMergeItems, mergeItemUrl } from "@/lib/bill-generator/merge-plan";

/** Every drawn text run, in the order the page draws them. */
async function letterRuns(bytes: Uint8Array): Promise<string[]> {
  const { extractTextRuns, loadPageCmaps } = await import("@/lib/bill-generator/tenancy-stamp");
  const { getPageStreamRefs, transformStream } = await import("@/lib/bill-generator/pdf-utils");
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    const cmaps = loadPageCmaps(doc, page);
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        for (const run of extractTextRuns(buf.toString("latin1"), cmaps)) {
          if (run.text.trim()) parts.push(run.text);
        }
        return { data: buf, count: 0 };
      });
    }
  }
  return parts;
}

const CASE = {
  full_name: "MONBLEU CAFE(JM0920662-D)",
  company_name: "MONBLEU CAFE SDN BHD",
  company_reg: "JM0920662-D",
  director_name: "Tan Wei Ming",
  id_no: "940811034224",
  full_address: "NO 12 JALAN ABC, TAMAN XYZ, 81200 JOHOR BAHRU, JOHOR",
  package: "Unifi Biz 300Mbps Broadband",
  mobile: "60137089093",
};

const WHEN = new Date(2026, 8, 18);

describe("companyLine", () => {
  it("is NAME (BRN) when both are known", () => {
    expect(companyLine("MONBLEU CAFE SDN BHD", "JM0920662-D")).toBe(
      "MONBLEU CAFE SDN BHD (JM0920662-D)",
    );
  });

  // An empty bracket reads as a missing value the reader should chase; the name
  // alone simply reads as a company.
  it("prints the name alone rather than an empty bracket", () => {
    expect(companyLine("MONBLEU CAFE SDN BHD", "")).toBe("MONBLEU CAFE SDN BHD");
  });

  it("is blank when nothing is known", () => {
    expect(companyLine("", "")).toBe("");
  });
});

describe("formatContactNumber", () => {
  it.each([
    ["60137089093", "+60137089093"],
    ["+60137089093", "+60137089093"],
    ["0137089093", "+60137089093"],
    ["013-708 9093", "+60137089093"],
  ])("normalises %s to the template's +60 style", (raw, want) => {
    expect(formatContactNumber(raw)).toBe(want);
  });

  // The brief forbids inventing a number, and a country code is part of one.
  it("leaves a non-Malaysian number as typed", () => {
    expect(formatContactNumber("+65 9123 4567")).toBe("+65 9123 4567");
  });

  it("is blank for nothing", () => {
    expect(formatContactNumber("")).toBe("");
    expect(formatContactNumber(null)).toBe("");
  });
});

/** `940811-03-4224` → the parts the format guarantees. */
const MALAY_NAME = /^[A-Z]+ [A-Z]+ (BIN|BINTI) [A-Z]+$/;
const DASHED_IC = /^(\d{2})(\d{2})(\d{2})-(\d{2})-(\d{3})(\d)$/;

describe("resolveBizLetterFields", () => {
  it("takes the company and BRN off the detail-page fields", () => {
    const f = resolveBizLetterFields(CASE);
    expect(f.companyName).toBe("MONBLEU CAFE SDN BHD");
    expect(f.companyReg).toBe("JM0920662-D");
  });

  // The crawler's list view stores a biz customer as COMPANY(REG); a case whose
  // detail page has not been fetched has only that to go on.
  it("falls back to the COMPANY(REG) shape in the customer name", () => {
    const f = resolveBizLetterFields({
      full_name: "MONBLEU CAFE(JM0920662-D)",
      id_no: "940811034224",
    });
    expect(f.companyName).toBe("MONBLEU CAFE");
    expect(f.companyReg).toBe("JM0920662-D");
    expect(f.companyLine).toBe("MONBLEU CAFE (JM0920662-D)");
  });

  // The BRN goes in the company line and the NRIC in the director's — swapping
  // them is the one mistake that would look plausible on the page.
  it("never puts a NRIC where the BRN belongs", () => {
    const f = resolveBizLetterFields(CASE);
    expect(f.companyReg).not.toBe(f.directorIc);
    expect(f.companyLine).not.toMatch(DASHED_IC);
  });

  it("leaves the company fields blank rather than guessing when nothing is known", () => {
    const f = resolveBizLetterFields({});
    expect(f).toMatchObject({
      companyName: "",
      companyReg: "",
      companyLine: "",
      packageName: "",
      contact: "",
    });
  });
});

describe("the invented director", () => {
  it("is a Malay name with the right particle for its IC's gender", () => {
    // Across many companies, not one: the gender is drawn per seed, so a single
    // sample would pass with the parity rule broken half the time.
    for (let i = 0; i < 40; i++) {
      const f = resolveBizLetterFields({ company_name: `TEST COMPANY ${i} SDN BHD`, company_reg: "X1" });
      expect(f.directorName).toMatch(MALAY_NAME);

      const m = DASHED_IC.exec(f.directorIc);
      expect(m, `bad IC ${f.directorIc}`).not.toBeNull();
      const [, , mm, dd, pb, , last] = m!;
      expect(Number(mm)).toBeGreaterThanOrEqual(1);
      expect(Number(mm)).toBeLessThanOrEqual(12);
      expect(Number(dd)).toBeGreaterThanOrEqual(1);
      expect(Number(dd)).toBeLessThanOrEqual(28);
      // MyKad birth-state codes 01-16: the 13 states plus KL, Labuan, Putrajaya.
      expect(Number(pb)).toBeGreaterThanOrEqual(1);
      expect(Number(pb)).toBeLessThanOrEqual(16);
      // Final digit odd = male, even = female. The name must not contradict it.
      const male = Number(last) % 2 === 1;
      expect(f.directorName.includes(" BIN ")).toBe(male);
      expect(f.directorName.includes(" BINTI ")).toBe(!male);
    }
  });

  /**
   * Nothing is stored, so an unseeded director would differ on every download
   * and an agent could submit two letters naming two directors of one company.
   */
  it("is the same person every time for the same company", () => {
    const a = resolveBizLetterFields(CASE);
    const b = resolveBizLetterFields(CASE);
    expect(b.directorName).toBe(a.directorName);
    expect(b.directorIc).toBe(a.directorIc);
  });

  it("is a different person for a different company", () => {
    const names = new Set(
      Array.from({ length: 12 }, (_, i) =>
        resolveBizLetterFields({ company_name: `COMPANY ${i}`, company_reg: `R${i}` }).directorName,
      ),
    );
    expect(names.size).toBeGreaterThan(6);
  });

  // The whole point of the change: the case's own person is not the director.
  it("ignores the director and IC recorded on the case", () => {
    const f = resolveBizLetterFields(CASE);
    expect(f.directorName).not.toBe("TAN WEI MING");
    expect(f.directorIc.replace(/\D/g, "")).not.toBe("940811034224");
  });
});

describe("letterheadLines", () => {
  it("splits the address on its own commas and nothing else", () => {
    expect(letterheadLines("NO 12 JALAN ABC, TAMAN XYZ, 81200 JOHOR BAHRU, JOHOR")).toEqual([
      "NO 12 JALAN ABC",
      "TAMAN XYZ",
      "81200 JOHOR BAHRU",
      "JOHOR",
    ]);
  });

  /**
   * The shared address parser removes the first state name it finds anywhere in
   * the string, which eats the one inside a city. Both of these came off a real
   * render through that parser, and both are why the letterhead does not use it.
   */
  it("keeps a city that contains a state name, and a two-word state", () => {
    expect(letterheadLines("81200 JOHOR BAHRU, JOHOR")).toEqual(["81200 JOHOR BAHRU", "JOHOR"]);
    expect(letterheadLines("40150 SHAH ALAM, SELANGOR DARUL EHSAN")).toEqual([
      "40150 SHAH ALAM",
      "SELANGOR DARUL EHSAN",
    ]);
  });

  // Portal addresses frequently carry no commas at all.
  it("leaves a comma-less address as one segment for the caller to wrap", () => {
    expect(letterheadLines("NO 12 JALAN ABC TAMAN XYZ 81200 JOHOR BAHRU JOHOR")).toEqual([
      "NO 12 JALAN ABC TAMAN XYZ 81200 JOHOR BAHRU JOHOR",
    ]);
  });

  it("is empty for no address", () => {
    expect(letterheadLines("")).toEqual([]);
    expect(letterheadLines(null)).toEqual([]);
  });
});

describe("the whole letter", () => {
  it("is one page", async () => {
    const doc = await PDFDocument.load(await generateBizAuthorizationLetter(CASE, WHEN));
    expect(doc.getPageCount()).toBe(1);
  });

  it("prints the template's static legal copy unchanged", async () => {
    const text = (await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN))).join("\n");
    expect(text).toContain("LETTER OF AUTHORISATION FOR TM UNIFI BUSINESS APPLICATION");
    expect(text).toContain("is the Board of Director(BOD) of the company.");
    expect(text).toContain("DESIGNATION : DIRECTOR");
    expect(text).toContain("DESIGNATION : TM AUTHORISED AGENT");
    expect(text).toContain("The authorised representative is permitted to:");
    expect(text).toContain("Submit and manage TM Unifi Business application");
    expect(text).toContain("Liaise with Telekom Malaysia (TM)");
    expect(text).toContain("Submit required documents and complete necessary procedures");
    expect(text).toContain(
      "This authorisation is valid until the completion of the application process.",
    );
    expect(text).toContain("Yours faithfully,");
  });

  it("fills the company, director, package, service address, date and contact", async () => {
    const f = resolveBizLetterFields(CASE, WHEN);
    const text = (await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN))).join("\n");
    expect(text).toContain("MONBLEU CAFE SDN BHD (JM0920662-D)");
    expect(text).toContain(f.directorName);
    expect(text).toContain(f.directorIc);
    // The case's own person never reaches the page.
    expect(text).not.toContain("TAN WEI MING");
    expect(text).not.toContain("940811034224");
    expect(text).toContain("Unifi Biz 300Mbps Broadband");
    // The letterhead keeps the city intact, not the parser's "81200 BAHRU JOHOR".
    expect(text).toContain("81200 JOHOR BAHRU");
    expect(text).not.toContain("81200 BAHRU");
    expect(text).toContain("DATE : 18 SEPTEMBER 2026");
    expect(text).toContain("+60137089093");
  });

  /**
   * The load-bearing test. Four values must come out visually empty, and the
   * plausible bug is the director's details being reused for the agent's — the
   * two IC labels sit eight lines apart and read almost alike.
   */
  it("leaves the agent name, agent IC, signature and chop empty", async () => {
    const f = resolveBizLetterFields(CASE, WHEN);
    const runs = await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN));
    const text = runs.join("\n");

    // The director appears exactly twice — their own block and the footer. A
    // third would mean they had been written into the representative line.
    expect(runs.filter((r) => r.trim() === f.directorName)).toHaveLength(2);
    expect(runs.filter((r) => r.trim() === f.directorIc)).toHaveLength(2);

    // Labels present, values absent.
    expect(text).toContain("AUTHORISED REPRESENTATIVE :");
    expect(text).toContain("IC NUMBER :");
    expect(text).toContain("_________________");

    // The chop is the last thing drawn, so a value would follow it.
    expect(runs[runs.length - 1].trim()).toBe("COMPANY CHOP :");
  });

  // The footer must agree with the header and body, not restate them loosely.
  it("repeats the header's company line and the director in the footer", async () => {
    const runs = await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN));
    expect(runs.filter((r) => r.trim() === "MONBLEU CAFE SDN BHD (JM0920662-D)").length,
    ).toBeGreaterThanOrEqual(2);
  });

  // The brief: incomplete data still produces a letter, with blanks.
  it("still generates with nothing but a name", async () => {
    const doc = await PDFDocument.load(
      await generateBizAuthorizationLetter({ full_name: "SOME COMPANY(123-X)" }, WHEN),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  // Fifty-odd lines on one sheet leaves little room; a long company name and a
  // long address are what would push the chop off the bottom.
  it("keeps the footer on the page for a worst-case record", async () => {
    const bytes = await generateBizAuthorizationLetter(
      {
        ...CASE,
        company_name: "PERBADANAN PEMBANGUNAN PERTANIAN DAN PERINDUSTRIAN BERSEPADU SDN BHD",
        full_address:
          "LOT 12345-A, TINGKAT 8, MENARA PERDANA SELATAN, JALAN TUN DR ISMAIL BESAR, " +
          "TAMAN PERINDUSTRIAN BUKIT JELUTONG SEKSYEN U8, 40150 SHAH ALAM, SELANGOR DARUL EHSAN",
        package: "Unifi Biz 500Mbps Broadband with Static IP and Mesh WiFi Bundle (36M)",
      },
      WHEN,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const runs = await letterRuns(bytes);
    expect(runs[runs.length - 1].trim()).toBe("COMPANY CHOP :");
  });
});

describe("Combine bundles the letter the case actually gets", () => {
  const mergeCase = (over: Record<string, unknown> = {}) => ({
    case_no: "202661159",
    full_name: "MONBLEU CAFE(JM0920662-D)",
    id_no: "940811034224",
    internet_bill_url: null,
    utility_bill_url: null,
    ...over,
  });

  it("points a business case's letter row at the biz endpoint", () => {
    const [item] = buildMergeItems([mergeCase()], ["letter"]);
    expect(item.bizLetter).toBe(true);
    expect(mergeItemUrl(item)).toContain("/api/bills/biz-authorization-letter");
    expect(item.label).toContain("Biz Auth Letter");
  });

  it("leaves a normal case on the residential endpoint", () => {
    const [item] = buildMergeItems(
      [mergeCase({ full_name: "AHMAD BIN ALI", package: "Unifi Home 300Mbps Broadband" })],
      ["letter"],
    );
    expect(item.bizLetter).toBeUndefined();
    expect(mergeItemUrl(item)).toContain("/api/bills/authorization-letter");
    expect(mergeItemUrl(item)).not.toContain("biz-authorization-letter");
    expect(item.label).toContain("Auth Letter");
  });

  // The residential route refuses a case with no IC; the business one prints a
  // blank and carries on, so the same missing field must not drop it.
  it("keeps a business letter with no IC, and still drops a residential one", () => {
    const [biz] = buildMergeItems([mergeCase({ id_no: "" })], ["letter"]);
    expect(biz.unavailable).toBeNull();

    const [normal] = buildMergeItems(
      [mergeCase({ full_name: "AHMAD BIN ALI", id_no: "", package: "Unifi Home 300Mbps" })],
      ["letter"],
    );
    expect(normal.unavailable).toBe("Case has no ID number");
  });
});

describe("which letter a case gets", () => {
  it("gives a business case the Biz Auth Letter", () => {
    expect(authLetterVariant(CASE)).toBe("biz");
    expect(AUTH_LETTER_LABEL[authLetterVariant(CASE)]).toBe("Biz Auth Letter");
  });

  it("gives a normal case the residential Auth Letter", () => {
    const normal = { full_name: "AHMAD BIN ALI", package: "Unifi Home 300Mbps Broadband" };
    expect(authLetterVariant(normal)).toBe("residential");
    expect(AUTH_LETTER_LABEL[authLetterVariant(normal)]).toBe("Auth Letter");
  });

  // The generator CARDS are filtered in the form itself, not by
  // generatableDocTypes, so "never both" has to be pinned there too.
  it("gates the two letter cards on the order form by plan type", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/components/order-entry/OrderForm.tsx", "utf8");
    expect(src).toContain('if (g.type === "biz_authorization_letter") return isBusinessOrder(genSource);');
    expect(src).toContain('if (g.type === "authorization_letter") return !isBusinessOrder(genSource);');
  });

  it("offers exactly one of the two letters, never both", () => {
    const biz = generatableDocTypes(
      {
        fullName: "MONBLEU CAFE(JM0920662-D)",
        idNumber: "940811034224",
        fullAddress: CASE.full_address,
        mobile: CASE.mobile,
        offerName: CASE.package,
        offerCategory: "unifi Biz Bundle Sale Catg",
      },
      [],
      10,
    );
    expect(biz).toContain("biz_authorization_letter");
    expect(biz).not.toContain("authorization_letter");

    const normal = generatableDocTypes(
      {
        fullName: "AHMAD BIN ALI",
        idNumber: "940811034224",
        fullAddress: CASE.full_address,
        mobile: CASE.mobile,
        offerName: "Unifi Home 300Mbps Broadband",
        offerCategory: "unifi Home Bundle Sale Catg",
      },
      [],
      10,
    );
    expect(normal).toContain("authorization_letter");
    expect(normal).not.toContain("biz_authorization_letter");
  });
});

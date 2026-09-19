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
import { buildBizzChatScript } from "@/lib/bizz-chat-script";
import { bizSignatureRng } from "@/lib/biz-director";

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
  id_type: "mykad",
  full_address: "NO 12 JALAN ABC, TAMAN XYZ, 81200 JOHOR BAHRU, JOHOR",
  package: "Unifi Biz 300Mbps Broadband",
  mobile: "60137089093",
};

const WHEN = new Date(2026, 8, 18);

const PNG_1PX = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const hasImage = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1").includes("/XObject");

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

describe("the director — WifiBizz's own, never invented", () => {
  it("prints the director and IC the case records", () => {
    const f = resolveBizLetterFields(CASE);
    expect(f.directorName).toBe("TAN WEI MING");
    expect(f.directorIc).toBe("940811-03-4224");
  });

  // The user's call (2026-09-19): print the case's original data. Real case
  // 202655047 holds its company reg in the ID field — it prints as typed.
  it("prints the ID field as typed, even when it is the company registration no.", () => {
    const f = resolveBizLetterFields({ ...CASE, company_reg: "JR0191646-W", id_no: "JR0191646W" });
    expect(f.directorName).toBe("TAN WEI MING");
    expect(f.directorIc).toBe("JR0191646W");
  });

  it("dashes a real MyKad, including one that is also in the reg field", () => {
    const f = resolveBizLetterFields({ ...CASE, company_reg: "960808086675", id_no: "960808086675" });
    expect(f.directorIc).toBe("960808-08-6675");
  });

  // A new-format SSM number is 12 digits too, but not a date: no IC dashes.
  it("never dresses a 12-digit registration number up as an IC", () => {
    expect(resolveBizLetterFields({ ...CASE, id_no: "202301024655" }).directorIc).toBe("202301024655");
  });

  it("prints a passport as typed", () => {
    expect(resolveBizLetterFields({ ...CASE, id_no: "ek1234567" }).directorIc).toBe("EK1234567");
  });

  // No name on the portal: the letter keeps the portal's `-` and still prints
  // the ID the case holds — original data, nothing invented, nothing hidden.
  it("prints '-' for a missing name and still fills the IC", () => {
    for (const director_name of ["", "-", "  —  ", null]) {
      const f = resolveBizLetterFields({ ...CASE, director_name });
      expect(f.directorName).toBe("-");
      expect(f.directorNamed).toBe(false);
      expect(f.directorIc).toBe("940811-03-4224");
    }
  });

  it("leaves the IC blank only when the case holds no ID at all", () => {
    expect(resolveBizLetterFields({ ...CASE, id_no: "" }).directorIc).toBe("");
  });

  // Both IC lines — the director block and the footer — carry the value.
  it("fills both IC / PASSPORT NUMBER lines, with or without a name", async () => {
    for (const c of [CASE, { ...CASE, director_name: "" }, { ...CASE, id_no: "JR0191646W" }]) {
      const f = resolveBizLetterFields(c);
      const runs = await letterRuns(await generateBizAuthorizationLetter(c, WHEN));
      expect(runs.filter((r) => r.trim() === f.directorIc)).toHaveLength(2);
      expect(runs.filter((r) => r.trim() === f.directorName)).toHaveLength(2);
    }
  });

  // One person signs in one hand across downloads and across their cases.
  it("picks the same pool signature every time for the same director", () => {
    const a = bizSignatureRng(CASE)!;
    const b = bizSignatureRng({ ...CASE, company_name: "OTHER SDN BHD", case_no: "999" })!;
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("picks a different pool signature for a different director", () => {
    expect(bizSignatureRng({ ...CASE, director_name: "LEE KEE BENG" })!()).not.toBe(
      bizSignatureRng(CASE)!(),
    );
  });

  it("picks no signature when the case names no director", () => {
    for (const director_name of ["", "-", null]) {
      expect(bizSignatureRng({ ...CASE, director_name })).toBeNull();
    }
  });

  it("is the same person the Bizz Chat prints as Business Owner", () => {
    const owner = (c: Record<string, unknown>) =>
      buildBizzChatScript(
        { ...c, full_name: (c.full_name as string) ?? null, mobile: null, id_no: null, email: null,
          full_address: null, package: null, case_created_at: null },
        3,
      ).lines.find((l) => l.label.includes("Business Owner Name"))?.value;

    expect(owner(CASE)).toBe("TAN WEI MING");
    expect(owner(CASE)).toBe(resolveBizLetterFields(CASE).directorName);
    // No name: the letter prints blank, the chat its usual dash — neither invents.
    expect(owner({ ...CASE, director_name: "" })).toBe("—");
  });
});

describe("letterheadLines", () => {
  it("splits a portal address into street, area, postcode + town, state", async () => {
    // The shape the user supplied (TOMMAC SDN. BHD.): the area keeps its own
    // RAWANG, the town RAWANG is peeled off once.
    expect(
      await letterheadLines("8 JALAN STR 3 - SAUJANA TEKNOLOGI RAWANG RAWANG SELANGOR MALAYSIA 48000"),
    ).toEqual(["8 JALAN STR 3", "SAUJANA TEKNOLOGI RAWANG", "48000 RAWANG", "SELANGOR"]);
    expect(
      await letterheadLines("12 JALAN MIRI BYPASS - - KAMPUNG BARU MIRI SARAWAK MALAYSIA 98000"),
    ).toEqual(["12 JALAN MIRI BYPASS", "KAMPUNG BARU", "98000 MIRI", "SARAWAK"]);
  });

  it("splits a comma-typed address and packs a housing area onto its own line", async () => {
    expect(await letterheadLines("NO 12 JALAN ABC, TAMAN XYZ, 81200 JOHOR BAHRU, JOHOR")).toEqual([
      "NO 12 JALAN ABC",
      "TAMAN XYZ",
      "81200 JOHOR BAHRU",
      "JOHOR",
    ]);
  });

  /**
   * The shared address parser removes the first state name it finds anywhere in
   * the string, which eats the one inside a city. The town comes from the
   * postcode table so it cannot.
   */
  it("keeps a city that contains a state name, and a state with its honorific", async () => {
    expect(await letterheadLines("NO 12 JALAN ABC TAMAN XYZ 81200 JOHOR BAHRU JOHOR")).toEqual([
      "NO 12 JALAN ABC TAMAN XYZ",
      "81200 JOHOR BAHRU",
      "JOHOR",
    ]);
    expect(await letterheadLines("40150 SHAH ALAM, SELANGOR DARUL EHSAN")).toEqual([
      "40150 SHAH ALAM",
      "SELANGOR",
    ]);
  });

  it("prints a federal territory the way the portal names it", async () => {
    expect(
      await letterheadLines(
        "B4-32-09 PERSIARAN BESTARI 32 ALAM DAMAI KUALA LUMPUR WILAYAH PERSEKUTUAN MALAYSIA 56000",
      ),
    ).toEqual(["B4-32-09 PERSIARAN BESTARI 32 ALAM DAMAI", "56000 KUALA LUMPUR", "W.P. KUALA LUMPUR"]);
  });

  it("uses the post office's town when the address names a smaller place", async () => {
    expect(
      await letterheadLines(
        "1974 LORONG ASAS JAYA 1 - KAW IND. RINGAN ASAS JAYA SIMPANG AMPAT PULAU PINANG MALAYSIA 14000",
      ),
    ).toEqual([
      "1974 LORONG ASAS JAYA 1",
      "KAW IND. RINGAN ASAS JAYA SIMPANG AMPAT",
      "14000 BUKIT MERTAJAM",
      "PULAU PINANG",
    ]);
  });

  it("is empty for no address", async () => {
    expect(await letterheadLines("")).toEqual([]);
    expect(await letterheadLines(null)).toEqual([]);
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
    const text = (await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN))).join("\n");
    expect(text).toContain("MONBLEU CAFE SDN BHD (JM0920662-D)");
    // The case's own director, as WifiBizz records them.
    expect(text).toContain("TAN WEI MING");
    expect(text).toContain("940811-03-4224");
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
  it("leaves the agent name, agent IC and chop empty", async () => {
    const f = resolveBizLetterFields(CASE);
    const runs = await letterRuns(await generateBizAuthorizationLetter(CASE, WHEN));
    const text = runs.join("\n");
    expect(f.directorName).toBe("TAN WEI MING"); // so the counts below mean something

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

  /**
   * The director signs with an admin-pool image. The pool is admin-managed, can
   * be empty, and can hold a bad upload — none of which may cost the letter.
   */
  it("stamps a pool signature on the director's line without moving the text", async () => {
    const plain = await generateBizAuthorizationLetter(CASE, WHEN);
    const signed = await generateBizAuthorizationLetter(CASE, WHEN, {
      signature: { bytes: PNG_1PX, mime: "image/png" },
    });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(1);
    expect(hasImage(signed)).toBe(true);
    expect(hasImage(plain)).toBe(false);
    // Drawn into the gap the footer already reserved: every text run matches.
    expect(await letterRuns(signed)).toEqual(await letterRuns(plain));
  });

  // A signature above a blank name block signs for nobody.
  it("does not stamp a signature when the case names no director", async () => {
    const bytes = await generateBizAuthorizationLetter({ ...CASE, director_name: "-" }, WHEN, {
      signature: { bytes: PNG_1PX, mime: "image/png" },
    });
    expect(hasImage(bytes)).toBe(false);
  });

  it("still produces the letter when the signature pool is empty", async () => {
    const bytes = await generateBizAuthorizationLetter(CASE, WHEN, { signature: null });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(hasImage(bytes)).toBe(false);
  });

  it("still produces the letter when the pool image will not embed", async () => {
    const bytes = await generateBizAuthorizationLetter(CASE, WHEN, {
      signature: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const runs = await letterRuns(bytes);
    expect(runs[runs.length - 1].trim()).toBe("COMPANY CHOP :");
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

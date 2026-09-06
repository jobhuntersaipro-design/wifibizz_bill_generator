import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  SAMPLE_LANDLORD_NAME,
  SAMPLE_LANDLORD_NRIC,
  SAMPLE_TENANT_NAME,
  SAMPLE_TENANT_NAME_LINE1,
  SAMPLE_TENANT_NAME_LINE2,
  SAMPLE_TENANT_NRIC,
  SAMPLE_SCHEDULE_DATE,
  SAMPLE_EXPIRE_DATE,
  SAMPLE_RENT_AMOUNT,
  SAMPLE_DEPOSIT_AMOUNT,
  SAMPLE_BANK_ACCOUNT,
  SAMPLE_CAR_PARK,
  looksCompleteAddress,
  orderInstallationAddress,
  pickFullestAddress,
  agreementDateFrom,
  expireDateFrom,
  addCalendarMonths,
  pickAgreementDate,
  isAgreementDateInWindow,
  scheduleDateLabel,
  coverDayLabel,
  coverMonthLabel,
  tenancyStampFrom,
  tenantStampFrom,
  ringgitWords,
  formatRm,
  ringgitAmountLabel,
  pickRentRinggit,
  pickBankAccount,
  RENT_MIN,
  RENT_MAX,
  RENT_STEP,
} from "@/lib/bill-generator/tenancy-fields";
import {
  decodePdfHex,
  extractTextRuns,
  findNeedleHits,
  stampTenancyAgreement,
} from "@/lib/bill-generator/tenancy-stamp";
import {
  generateTenancyAgreement,
  resolveTenancyTemplatePath,
  TEMPLATE_MISSING,
} from "@/lib/bill-generator/tenancy-agreement";
import { formatIcDashed, generateRandomLandlord, makeRng } from "@/lib/bill-generator/owner-identity";
import { pdfContentText } from "@/lib/erf-appointment";

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
  case_no: "202666996",
  full_name: "Nor Azzawani Fizatulazira Binti Zulkepeli",
  id_no: "011023120384",
  full_address: "LOT 978, JALAN KAMPUNG BARU, KAMPUNG SUNGAI BULOH, 47000 SUNGAI BULOH, SELANGOR, MALAYSIA",
};

async function syntheticTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.HelveticaBold);

  const cover = doc.addPage([612, 792]);
  cover.drawText("DATED THIS", { x: 140, y: 720, size: 12, font });
  cover.drawText("15th", { x: 230, y: 720, size: 12, font });
  cover.drawText("DAY OF", { x: 287, y: 720, size: 12, font });
  cover.drawText("JANUARY", { x: 362, y: 720, size: 12, font });
  cover.drawText("2026", { x: 441, y: 720, size: 12, font });
  cover.drawText("TENANCY AGREEMENT", { x: 200, y: 680, size: 16, font });
  cover.drawText("BETWEEN", { x: 270, y: 640, size: 12, font });
  cover.drawText(SAMPLE_LANDLORD_NAME, { x: 180, y: 600, size: 12, font });
  cover.drawText(`NRIC: ${SAMPLE_LANDLORD_NRIC}`, { x: 220, y: 580, size: 12, font });
  cover.drawText("AND", { x: 290, y: 540, size: 12, font });
  cover.drawText(SAMPLE_TENANT_NAME_LINE1, { x: 200, y: 500, size: 12, font });
  cover.drawText(SAMPLE_TENANT_NAME_LINE2, { x: 210, y: 482, size: 12, font });
  cover.drawText(`NRIC: ${SAMPLE_TENANT_NRIC}`, { x: 220, y: 460, size: 12, font });
  cover.drawText("Demised Premises:", { x: 220, y: 140, size: 12, font });
  cover.drawText("F-3A-3A, PELANGI UTAMA BLOCK F, JLN MASJID, BANDAR UTAMA", { x: 80, y: 120, size: 11, font });
  cover.drawText("47800 PETALING JAYA, SELANGOR.", { x: 180, y: 104, size: 11, font });

  const exec = doc.addPage([612, 792]);
  exec.drawText("SIGNED by the LANDLORD", { x: 72, y: 700, size: 11, font: sans });
  exec.drawText(`NAME : ${SAMPLE_LANDLORD_NAME}`, { x: 200, y: 640, size: 11, font: sans });
  exec.drawText(`NRIC : ${SAMPLE_LANDLORD_NRIC}`, { x: 200, y: 620, size: 11, font: sans });
  exec.drawText("SIGNED by the TENANT", { x: 72, y: 400, size: 11, font: sans });
  exec.drawText(`NAME : ${SAMPLE_TENANT_NAME}`, { x: 200, y: 340, size: 11, font: sans });
  exec.drawText(`NRIC : ${SAMPLE_TENANT_NRIC}`, { x: 200, y: 320, size: 11, font: sans });

  const sched = doc.addPage([612, 792]);
  sched.drawText("THE FIRST SCHEDULE ABOVE REFERRED TO", { x: 120, y: 740, size: 12, font: sans });
  sched.drawText(`15TH JANUARY 2026`, { x: 300, y: 700, size: 10, font: sans });
  sched.drawText(`NAME: ${SAMPLE_LANDLORD_NAME}`, { x: 300, y: 660, size: 10, font: sans });
  sched.drawText(`NAME: ${SAMPLE_TENANT_NAME}`, { x: 300, y: 600, size: 10, font: sans });
  sched.drawText(`NRIC: ${SAMPLE_TENANT_NRIC}`, { x: 300, y: 584, size: 10, font: sans });
  sched.drawText("F-3A-3A, PELANGI UTAMA BLOCK F", { x: 300, y: 560, size: 10, font: sans });
  sched.drawText("JLN MASJID, BANDAR UTAMA, 47800 PETALING JAYA,", { x: 300, y: 546, size: 10, font: sans });
  sched.drawText("SELANGOR.", { x: 300, y: 532, size: 10, font: sans });
  sched.drawText("18 MONTHS", { x: 300, y: 520, size: 10, font: sans });
  sched.drawText(`15TH JANUARY 2026`, { x: 300, y: 500, size: 10, font: sans });
  sched.drawText("14TH JULY 2027", { x: 300, y: 484, size: 10, font: sans });
  sched.drawText(`Ringgit Malaysia: ${SAMPLE_RENT_AMOUNT}. EXTRA`, { x: 200, y: 460, size: 9, font: sans });
  sched.drawText(`CAR PARK PER MONTH ${SAMPLE_CAR_PARK}`, { x: 200, y: 448, size: 9, font: sans });
  sched.drawText("MAYBANK BERHAD", { x: 300, y: 430, size: 10, font: sans });
  sched.drawText(`ACCOUNT NAME: ${SAMPLE_LANDLORD_NAME}`, { x: 200, y: 416, size: 10, font: sans });
  sched.drawText(`ACCOUNT NO: ${SAMPLE_BANK_ACCOUNT}`, { x: 200, y: 402, size: 10, font: sans });
  sched.drawText(`Ringgit Malaysia: ${SAMPLE_DEPOSIT_AMOUNT} only`, { x: 200, y: 380, size: 9, font: sans });
  sched.drawText("Ringgit Malaysia: ONE THOUSAND ONLY (RM1000.00)", { x: 200, y: 360, size: 9, font: sans });

  const id = doc.addPage([612, 792]);
  id.drawText("TENANT IDENTIFICATION", { x: 84, y: 740, size: 12, font: sans });
  id.drawText(SAMPLE_TENANT_NRIC, { x: 84, y: 700, size: 11, font: sans });

  return doc.save();
}

const FROZEN = new Date("2026-09-05T12:00:00+08:00");
const STAMP = tenancyStampFrom(CASE, FROZEN, makeRng(42));

describe("agreementDateFrom", () => {
  it("uses the Malaysia calendar date (UTC+8), not UTC", () => {
    expect(agreementDateFrom(new Date("2026-09-04T20:00:00Z"))).toEqual({
      day: 5,
      monthIndex: 8,
      year: 2026,
    });
  });
});

describe("pickAgreementDate", () => {
  it("is inclusive of today+3 months and today+6 months", () => {
    const today = agreementDateFrom(FROZEN);
    expect(addCalendarMonths(today, 3)).toEqual({ day: 5, monthIndex: 11, year: 2026 });
    expect(addCalendarMonths(today, 6)).toEqual({ day: 5, monthIndex: 2, year: 2027 });
    expect(pickAgreementDate(FROZEN, () => 0)).toEqual(addCalendarMonths(today, 3));
    expect(pickAgreementDate(FROZEN, () => 0.999999)).toEqual(addCalendarMonths(today, 6));
  });

  it("stays in the window, matches §5b, and drives §5c", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = tenancyStampFrom(CASE, FROZEN, makeRng(seed));
      expect(isAgreementDateInWindow(s.date, FROZEN)).toBe(true);
      expect(s.expire).toEqual(expireDateFrom(s.date));
      seen.add(scheduleDateLabel(s.date));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("differs across two generations of the same case", () => {
    const a = tenancyStampFrom(CASE, FROZEN, makeRng(1));
    const b = tenancyStampFrom(CASE, FROZEN, makeRng(99));
    expect(a.date).not.toEqual(b.date);
    expect(isAgreementDateInWindow(a.date, FROZEN)).toBe(true);
    expect(isAgreementDateInWindow(b.date, FROZEN)).toBe(true);
  });
});

describe("expireDateFrom", () => {
  it("is commence + 18 months − 1 day (sample 15 Jan 2026 → 14 Jul 2027)", () => {
    expect(expireDateFrom({ day: 15, monthIndex: 0, year: 2026 })).toEqual({
      day: 14,
      monthIndex: 6,
      year: 2027,
    });
    expect(expireDateFrom({ day: 5, monthIndex: 8, year: 2026 })).toEqual({
      day: 4,
      monthIndex: 2,
      year: 2028,
    });
  });
});

describe("ringgit words", () => {
  it("matches the sample TWO / FOUR THOUSAND style", () => {
    expect(ringgitWords(800)).toBe("EIGHT HUNDRED");
    expect(ringgitWords(850)).toBe("EIGHT HUNDRED AND FIFTY");
    expect(ringgitWords(1000)).toBe("ONE THOUSAND");
    expect(ringgitWords(1550)).toBe("ONE THOUSAND FIVE HUNDRED AND FIFTY");
    expect(ringgitWords(2000)).toBe("TWO THOUSAND");
    expect(ringgitWords(4000)).toBe("FOUR THOUSAND");
    expect(formatRm(800)).toBe("RM800.00");
    expect(formatRm(2000)).toBe("RM2,000.00");
    expect(ringgitAmountLabel(2000)).toBe(SAMPLE_RENT_AMOUNT);
    expect(ringgitAmountLabel(4000)).toBe(SAMPLE_DEPOSIT_AMOUNT);
  });

  it("picks rent on the RM50 step inside 800–2000", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 40; i++) {
      const n = pickRentRinggit(rng);
      expect(n).toBeGreaterThanOrEqual(RENT_MIN);
      expect(n).toBeLessThanOrEqual(RENT_MAX);
      expect((n - RENT_MIN) % RENT_STEP).toBe(0);
    }
  });
});

describe("generateRandomLandlord", () => {
  it("prints a Malay BIN/BINTI pair and differs across rngs", () => {
    const a = generateRandomLandlord(FROZEN, makeRng(1), CASE.full_name);
    const b = generateRandomLandlord(FROZEN, makeRng(2), CASE.full_name);
    expect(a.name).toMatch(/\b(BIN|BINTI)\b/);
    expect(a.ic).toHaveLength(12);
    expect(a.name).not.toBe(b.name);
  });
});

describe("premises address", () => {
  it("prefers the full order/detail address over a truncated list fragment", () => {
    const list = "LOT 978, JALAN KAMPUNG BARU";
    const detail = CASE.full_address;
    expect(looksCompleteAddress(list)).toBe(false);
    expect(looksCompleteAddress(detail)).toBe(true);
    expect(pickFullestAddress(list, detail)).toBe(detail);
    expect(orderInstallationAddress({
      addressFull: detail,
      street: list,
      postcode: "47000",
      city: "SUNGAI BULOH",
      state: "SELANGOR",
    })).toBe(detail);
  });
});

describe("tenantStampFrom", () => {
  it("uppercases the case name and dashes a 12-digit IC", () => {
    expect(tenantStampFrom(CASE, FROZEN, makeRng(42))).toEqual(expect.objectContaining({
      name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
      nric: formatIcDashed("011023120384"),
      date: STAMP.date,
      expire: expireDateFrom(STAMP.date),
      premises: CASE.full_address,
      bankAccount: STAMP.bankAccount,
    }));
    expect(isAgreementDateInWindow(STAMP.date, FROZEN)).toBe(true);
    expect(STAMP.bankAccount).toMatch(/^\d{4} \d{4} \d{2}$/);
    expect(STAMP.bankAccount).not.toBe(SAMPLE_BANK_ACCOUNT);
  });

  it("keeps a non-12-digit IC as typed rather than inventing dashes", () => {
    expect(tenantStampFrom({ case_no: "1", full_name: "A", id_no: "A123" }).nric).toBe("A123");
  });
});

describe("extractTextRuns", () => {
  it("reads a Quartz-style Tm + literal Tj", () => {
    const runs = extractTextRuns("1 0 0 1 200 500 Tm\n(NUR SYAFIQAH BINTI) Tj");
    expect(runs).toEqual([
      expect.objectContaining({ text: "NUR SYAFIQAH BINTI", x: 200, y: 500 }),
    ]);
  });

  it("decodes UTF-16BE hex the way Quartz often writes names", () => {
    expect(decodePdfHex("00410042")).toBe("AB");
    const runs = extractTextRuns("1 0 0 1 10 20 Tm <003900360030003500310037> Tj");
    expect(runs[0].text).toBe("960517");
  });

  it("treats the PDF ' operator as a show", () => {
    const runs = extractTextRuns("1 0 0 1 10 40 Tm\n/F1 12 Tf\n(NUR SYAFIQAH BINTI) '");
    expect(runs[0].text).toBe("NUR SYAFIQAH BINTI");
    expect(runs[0].x).toBe(10);
  });
});

describe("findNeedleHits", () => {
  it("joins two cover-page name lines", () => {
    const runs = [
      { text: SAMPLE_TENANT_NAME_LINE1, x: 200, y: 500, size: 12, start: 0, end: 10 },
      { text: SAMPLE_TENANT_NAME_LINE2, x: 210, y: 482, size: 12, start: 20, end: 30 },
    ];
    const hits = findNeedleHits(runs, SAMPLE_TENANT_NAME);
    expect(hits).toHaveLength(1);
    expect(hits[0].lineYs).toEqual([500, 482]);
  });
});

describe("stampTenancyAgreement", () => {
  it("replaces tenant, landlord, premises, dates, rent and drops the ID page", async () => {
    const bytes = await stampTenancyAgreement(await syntheticTemplate(), STAMP);
    const text = pdfVisibleText(bytes);
    expect(text).not.toContain("NUR SYAFIQAH");
    expect(text).not.toContain("ISMAIL NASRUDDIN");
    expect(text).not.toContain(SAMPLE_TENANT_NRIC);
    expect(text).toContain("NOR AZZAWANI");
    expect(text).toContain("ZULKEPELI");
    expect(text).toContain(STAMP.nric);
    expect(text).not.toContain(SAMPLE_LANDLORD_NAME);
    expect(text).not.toContain(SAMPLE_LANDLORD_NRIC);
    expect(text).toContain(STAMP.landlordName);
    expect(text).toContain(STAMP.landlordNric);
    expect(text).toContain("LOT 978");
    expect(text).toContain("KAMPUNG SUNGAI BULOH");
    expect(text).toContain("47000");
    expect(text).toContain("MALAYSIA");
    expect(text).toContain("SUNGAI BULOH");
    expect(text).not.toContain("PELANGI UTAMA");
    expect(text).toContain(scheduleDateLabel(STAMP.date));
    expect(text).toContain(scheduleDateLabel(STAMP.expire));
    expect(text.split(scheduleDateLabel(STAMP.date)).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(SAMPLE_SCHEDULE_DATE);
    expect(text).not.toContain(SAMPLE_EXPIRE_DATE);
    expect(text).toContain(ringgitAmountLabel(STAMP.rentRinggit));
    expect(text).toContain(ringgitAmountLabel(STAMP.rentRinggit * 2));
    expect(text).toContain(SAMPLE_CAR_PARK);
    expect(text).toContain("ONE THOUSAND ONLY (RM1000.00)");
    expect(text).toContain("MAYBANK BERHAD");
    expect(text).toContain(STAMP.bankAccount);
    expect(text).not.toContain(SAMPLE_BANK_ACCOUNT);
    expect(text).toContain("18 MONTHS");
    expect(text).not.toContain("TENANT IDENTIFICATION");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});

describe("generateTenancyAgreement", () => {
  it("stamps a supplied template path and does not fall back to the 7-page recreate", async () => {
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "ta-template-"));
    const fixture = join(dir, "tenancy_agreement.pdf");
    try {
      await writeFile(fixture, await syntheticTemplate());
      const bytes = await generateTenancyAgreement(CASE, fixture, FROZEN, makeRng(42));
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(3);
      const text = pdfVisibleText(bytes);
      expect(text).toContain("NOR AZZAWANI");
      expect(text).not.toContain("NUR SYAFIQAH");
      expect(text).not.toContain(SAMPLE_LANDLORD_NAME);
      expect(text).toContain(STAMP.bankAccount);
      expect(text).not.toContain(SAMPLE_BANK_ACCOUNT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stamps Chris’s Quartz sample with the v3 field set", async () => {
    const found = await resolveTenancyTemplatePath();
    if (!found) {
      await expect(generateTenancyAgreement(CASE)).rejects.toThrow(TEMPLATE_MISSING);
      return;
    }

    const bytes = await generateTenancyAgreement(CASE, undefined, FROZEN, makeRng(42));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(10);

    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const tmp = `/tmp/ta-stamped-${process.pid}.pdf`;
    writeFileSync(tmp, bytes);
    let text = "";
    try {
      text = execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8" });
    } finally {
      unlinkSync(tmp);
    }

    expect(text).toContain("NOR AZZAWANI");
    expect(text).toContain("ZULKEPELI");
    expect(text).toContain("011023-12-0384");
    expect(text).not.toMatch(/NRIC[A-Z]{3,}/);
    expect(text).not.toContain("NUR SYAFIQAH");
    expect(text).not.toContain("ISMAIL NASRUDDIN");
    expect(text).not.toContain("960517-06-5498");
    expect(text).not.toContain(SAMPLE_LANDLORD_NAME);
    expect(text).not.toContain(SAMPLE_LANDLORD_NRIC);
    expect(text).toContain(STAMP.landlordName);
    expect(text).toContain(STAMP.landlordNric);
    expect(text).toContain("LOT 978");
    expect(text).toContain("KAMPUNG SUNGAI BULOH");
    expect(text).toContain("47000");
    expect(text).toContain("MALAYSIA");
    expect(text).toContain("SUNGAI BULOH");
    expect(text).not.toContain("PELANGI");
    expect(text).toContain(coverDayLabel(STAMP.date));
    expect(text).toContain(coverMonthLabel(STAMP.date));
    expect(text).toContain(String(STAMP.date.year));
    expect(text).toContain(scheduleDateLabel(STAMP.date));
    expect(text).toContain(scheduleDateLabel(STAMP.expire));
    expect(text.split(scheduleDateLabel(STAMP.date)).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain("15TH JANUARY 2026");
    expect(text).not.toContain("14TH JULY 2027");
    expect(text).toContain("MAYBANK");
    expect(text).toMatch(new RegExp(STAMP.bankAccount.split(" ").join("\\s*")));
    expect(text).not.toMatch(/7015\s*8357\s*68/);
    expect(text).toContain("18");
    expect(text).toContain("MONTHS");
    expect(text).toContain(ringgitAmountLabel(STAMP.rentRinggit));
    expect(text).toContain(ringgitAmountLabel(STAMP.rentRinggit * 2));
    expect(text).toContain("RM100.00");
    expect(text).toContain("ONE THOUSAND");
    expect(text).not.toContain("TENANT IDENTIFICATION");
  });

  it("draws a different landlord on a second click", async () => {
    const found = await resolveTenancyTemplatePath();
    if (!found) return;
    const a = tenancyStampFrom(CASE, FROZEN, makeRng(1));
    const b = tenancyStampFrom(CASE, FROZEN, makeRng(99));
    expect(a.landlordName).not.toBe(b.landlordName);
    expect(a.landlordNric).not.toBe(b.landlordNric);
    expect(a.date).not.toEqual(b.date);
  });
});

describe("pickBankAccount", () => {
  it("formats ten digits like the template and never returns the sample", () => {
    const rng = makeRng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const n = pickBankAccount(rng);
      expect(n).toMatch(/^\d{4} \d{4} \d{2}$/);
      expect(n).not.toBe(SAMPLE_BANK_ACCOUNT);
      expect(n.length).toBeGreaterThan(0);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("differs across two generations of the same case", () => {
    const a = tenancyStampFrom(CASE, FROZEN, makeRng(1));
    const b = tenancyStampFrom(CASE, FROZEN, makeRng(99));
    expect(a.bankAccount).toMatch(/^\d{4} \d{4} \d{2}$/);
    expect(b.bankAccount).toMatch(/^\d{4} \d{4} \d{2}$/);
    expect(a.bankAccount).not.toBe("");
    expect(b.bankAccount).not.toBe("");
    expect(a.bankAccount).not.toBe(SAMPLE_BANK_ACCOUNT);
    expect(b.bankAccount).not.toBe(SAMPLE_BANK_ACCOUNT);
    expect(a.bankAccount).not.toBe(b.bankAccount);
  });
});

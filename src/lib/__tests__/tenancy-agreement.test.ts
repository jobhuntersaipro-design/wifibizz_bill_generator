import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  SAMPLE_LANDLORD_NAME,
  SAMPLE_LANDLORD_NRIC,
  SAMPLE_TENANT_NAME,
  SAMPLE_TENANT_NAME_LINE1,
  SAMPLE_TENANT_NAME_LINE2,
  SAMPLE_TENANT_NRIC,
  tenantStampFrom,
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
import { formatIcDashed } from "@/lib/bill-generator/owner-identity";
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

async function syntheticTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.HelveticaBold);

  const cover = doc.addPage([612, 792]);
  cover.drawText("DATED THIS 15th DAY OF JANUARY 2026", { x: 140, y: 720, size: 12, font });
  cover.drawText("TENANCY AGREEMENT", { x: 200, y: 680, size: 16, font });
  cover.drawText("BETWEEN", { x: 270, y: 640, size: 12, font });
  cover.drawText(SAMPLE_LANDLORD_NAME, { x: 180, y: 600, size: 12, font });
  cover.drawText(`NRIC: ${SAMPLE_LANDLORD_NRIC}`, { x: 220, y: 580, size: 12, font });
  cover.drawText("AND", { x: 290, y: 540, size: 12, font });
  cover.drawText(SAMPLE_TENANT_NAME_LINE1, { x: 200, y: 500, size: 12, font });
  cover.drawText(SAMPLE_TENANT_NAME_LINE2, { x: 210, y: 482, size: 12, font });
  cover.drawText(`NRIC: ${SAMPLE_TENANT_NRIC}`, { x: 220, y: 460, size: 12, font });

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
  sched.drawText("18 MONTHS", { x: 300, y: 540, size: 10, font: sans });
  sched.drawText("MAYBANK BERHAD", { x: 300, y: 500, size: 10, font: sans });
  sched.drawText(SAMPLE_LANDLORD_NAME, { x: 300, y: 484, size: 10, font: sans });

  return doc.save();
}

describe("tenantStampFrom", () => {
  it("uppercases the case name and dashes a 12-digit IC", () => {
    expect(
      tenantStampFrom({
        case_no: "202666996",
        full_name: "Nor Azzawani Fizatulazira Binti Zulkepeli",
        id_no: "960517065498",
      }),
    ).toEqual({
      name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
      nric: "960517-06-5498",
    });
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
  const stamp = {
    name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
    nric: formatIcDashed("011023120384"),
  };

  it("replaces the sample tenant on every text page and leaves the landlord", async () => {
    const bytes = await stampTenancyAgreement(await syntheticTemplate(), stamp);
    const text = pdfVisibleText(bytes);
    expect(text).not.toContain("NUR SYAFIQAH");
    expect(text).not.toContain("ISMAIL NASRUDDIN");
    expect(text).not.toContain(SAMPLE_TENANT_NRIC);
    expect(text).toContain("NOR AZZAWANI");
    expect(text).toContain("ZULKEPELI");
    expect(text).toContain(stamp.nric);
    expect(text).toContain(SAMPLE_LANDLORD_NAME);
    expect(text).toContain(SAMPLE_LANDLORD_NRIC);
    expect(text).toContain("15TH JANUARY 2026");
    expect(text).toContain("MAYBANK BERHAD");
    expect(text).toContain("18 MONTHS");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it("does not invent a landlord or a generation date", async () => {
    const bytes = await stampTenancyAgreement(await syntheticTemplate(), stamp);
    const text = pdfVisibleText(bytes);
    expect(text).not.toMatch(/HAFIZ|DIYANA|5TH SEPTEMBER 2026/);
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
      const bytes = await generateTenancyAgreement(
        {
          case_no: "202666996",
          full_name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
          id_no: "011023120384",
        },
        fixture,
      );
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(3);
      const text = pdfVisibleText(bytes);
      expect(text).toContain("NOR AZZAWANI");
      expect(text).not.toContain("NUR SYAFIQAH");
      expect(text).toContain(SAMPLE_LANDLORD_NAME);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to ship the old 7-page recreate when the template file is absent", async () => {
    const found = await resolveTenancyTemplatePath();
    if (found) {
      const bytes = await generateTenancyAgreement({
        case_no: "202666996",
        full_name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
        id_no: "011023120384",
      });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(13);
      const text = pdfVisibleText(bytes);
      expect(text).toContain("NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI");
      expect(text).not.toContain("NUR SYAFIQAH");
      return;
    }
    await expect(
      generateTenancyAgreement({
        case_no: "202666996",
        full_name: "NOR AZZAWANI FIZATULAZIRA BINTI ZULKEPELI",
        id_no: "011023120384",
      }),
    ).rejects.toThrow(TEMPLATE_MISSING);
  });
});

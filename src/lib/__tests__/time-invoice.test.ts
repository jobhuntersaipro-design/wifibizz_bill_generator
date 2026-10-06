import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildInvoiceAddress,
  computeInvoiceFields,
  packAddress,
  printedTimeAddress,
  money,
  slashDate,
  longDate,
  addMonths,
  inclusiveDays,
  MONTHLY_SEN,
  SERVICE_TAX_PERCENT,
  TIME_ADDRESS_BASELINES,
  TIME_ADDRESS_BASELINES_WITH_THIRD_STREET,
  TIME_ADDRESS_FONT_SIZE,
  TIME_ADDRESS_MAX_WIDTH,
  TIME_ADDRESS_QR_TOP,
  TIME_ADDRESS_STREET_SLOTS,
  type Measure,
} from "@/lib/bill-generator/time-invoice-fields";
import { auditTimeBillAddress, timeAuditDetail } from "@/lib/bill-generator/address-audit";
import { generateTimeInvoice } from "@/lib/bill-generator/time-invoice";
import {
  randomQrModules,
  barcodeContent,
  qrFormContent,
  qrBitmapRgb,
  BARCODE,
  BARCODE_EXTENTS,
  QR_BITMAP,
  QR_FORM,
} from "@/lib/bill-generator/time-artwork";
import { makeRng, hashSeed } from "@/lib/bill-generator/owner-identity";

/** Every day of a year, so a rule is never proved on one convenient date. */
function everyDayOf(year: number): Date[] {
  const days: Date[] = [];
  for (let m = 0; m < 12; m++) {
    const end = new Date(year, m + 1, 0).getDate();
    for (let d = 1; d <= end; d++) days.push(new Date(year, m, d));
  }
  return days;
}

const YEAR = everyDayOf(2026);

describe("money formatting", () => {
  it("renders sen as the invoice prints them", () => {
    expect(money(10858)).toBe("108.58");
    expect(money(651)).toBe("6.51");
    expect(money(9900)).toBe("99.00");
    expect(money(5)).toBe("0.05");
    expect(money(0)).toBe("0.00");
    expect(money(100)).toBe("1.00");
  });
});

describe("the template's own figures", () => {
  /**
   * The sample invoice is the only place these rules are witnessed end to end, so
   * the chain is reproduced from its own inputs. This is what pins proration to
   * the month the service STARTED in: 30/03–01/04 spans two months and divides by
   * 31, not by April's 30.
   */
  it("reproduces 9.58 / 108.58 / 6.51 / 115.09 / 115.10 from the sample's dates", () => {
    const proratedSen = Math.round((MONTHLY_SEN * 3) / 31);
    const subtotalSen = proratedSen + MONTHLY_SEN;
    const taxSen = Math.round((subtotalSen * SERVICE_TAX_PERCENT) / 100);
    const totalSen = subtotalSen + taxSen;
    const roundedSen = Math.round(totalSen / 5) * 5;

    expect(money(proratedSen)).toBe("9.58");
    expect(money(subtotalSen)).toBe("108.58");
    expect(money(taxSen)).toBe("6.51");
    expect(money(totalSen)).toBe("115.09");
    expect(money(roundedSen)).toBe("115.10");
  });
});

describe("invoice figures", () => {
  it("reconciles on every generation date of a year", () => {
    for (const now of YEAR) {
      const f = computeInvoiceFields("202624115", now);
      expect(f.subtotalSen).toBe(f.proratedSen + f.monthlySen);
      expect(f.taxSen).toBe(Math.round((f.subtotalSen * SERVICE_TAX_PERCENT) / 100));
      expect(f.totalSen).toBe(f.subtotalSen + f.taxSen);
      expect(f.monthlySen).toBe(MONTHLY_SEN);
    }
  });

  it("rounds the payable amount to a whole 5 sen, never away from the total", () => {
    for (const now of YEAR) {
      const f = computeInvoiceFields(`case-${now.getTime()}`, now);
      expect(f.roundedSen % 5).toBe(0);
      // Rounding is to the NEAREST 5 sen, so it can move either way but never far.
      expect(Math.abs(f.roundedSen - f.totalSen)).toBeLessThanOrEqual(2);
    }
  });

  it("prorates against the month the service started in", () => {
    for (const now of YEAR) {
      const f = computeInvoiceFields("202624115", now);
      const days = inclusiveDays(f.proStart, f.proEnd);
      const inMonth = new Date(f.proStart.getFullYear(), f.proStart.getMonth() + 1, 0).getDate();
      expect(f.proratedSen).toBe(Math.round((MONTHLY_SEN * days) / inMonth));
      // A part month is by definition less than a whole one.
      expect(f.proratedSen).toBeLessThan(MONTHLY_SEN);
    }
  });
});

describe("invoice dates", () => {
  it("holds every ordering invariant across a year, including 1 January", () => {
    for (const now of YEAR) {
      const f = computeInvoiceFields("202624115", now);

      // The billed month is the one before the invoice was generated, so the
      // document always reads as one already issued.
      const expected = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -1);
      expect(f.invoiceDate.getMonth()).toBe(expected.getMonth());
      expect(f.invoiceDate.getFullYear()).toBe(expected.getFullYear());

      // The period runs from the invoice date to the day before it falls due.
      expect(f.periodStart.getTime()).toBe(f.invoiceDate.getTime());
      expect(f.dueDate.getTime()).toBeGreaterThan(f.periodEnd.getTime());
      expect(inclusiveDays(f.periodEnd, f.dueDate)).toBe(2);

      // The part-month ends the day before the first full cycle begins.
      expect(inclusiveDays(f.proEnd, f.invoiceDate)).toBe(2);
      expect(f.proStart.getTime()).toBeLessThanOrEqual(f.proEnd.getTime());

      // Nothing is dated after the day the invoice was generated.
      expect(f.invoiceDate.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("rolls the year back when generated in January", () => {
    const f = computeInvoiceFields("202624115", new Date(2026, 0, 1));
    expect(f.invoiceDate.getFullYear()).toBe(2025);
    expect(f.invoiceDate.getMonth()).toBe(11);
  });

  it("formats dates the two ways the invoice prints them", () => {
    expect(slashDate(new Date(2026, 3, 2))).toBe("02/04/2026");
    expect(longDate(new Date(2026, 4, 2))).toBe("2 May 2026");
  });

  it("clamps rather than overflowing when adding a month to a long month", () => {
    expect(slashDate(addMonths(new Date(2026, 0, 31), 1))).toBe("28/02/2026");
  });
});

describe("invoice identity", () => {
  it("has the shapes the template's own values have", () => {
    for (const caseNo of ["202624115", "1", "202662528", "999999999"]) {
      const f = computeInvoiceFields(caseNo, new Date(2026, 7, 23));
      expect(f.account).toMatch(/^6888\d{8}$/);
      expect(f.account).toHaveLength(12);
      expect(f.invoice).toMatch(/^[1-9]\d{8}$/);
      expect(f.serviceNo).toMatch(/^TBBNB\d{6}G_\d{10}$/);
    }
  });

  /**
   * Nothing about this invoice is stored, so an unseeded random would hand out a
   * different account number every time the same case was downloaded.
   */
  it("gives one case the same invoice on every call", () => {
    const a = computeInvoiceFields("202624115", new Date(2026, 7, 23));
    const b = computeInvoiceFields("202624115", new Date(2026, 7, 23));
    expect(b).toEqual(a);
  });

  it("gives different cases different identifiers", () => {
    const a = computeInvoiceFields("202624115", new Date(2026, 7, 23));
    const b = computeInvoiceFields("202624116", new Date(2026, 7, 23));
    expect(b.account).not.toBe(a.account);
    expect(b.invoice).not.toBe(a.invoice);
    expect(b.serviceNo).not.toBe(a.serviceNo);
  });
});

// ── Customer block ─────────────────────────────────────────────────

/** Stands in for a real font: wide enough that overflow is easy to provoke. */
const measure: Measure = (text) => text.length * 5;
const MAX = 300;

describe("customer address block", () => {
  const long = {
    streetSegments: [
      "BLOCK A LEVEL 21 UNIT 6",
      "EDUMETRO THE DUO TOWER A",
      "PERSIARAN SUBANG PERMAI",
      "SEKSYEN 22 BANDAR BARU",
    ],
    postcode: "47500",
    locality: "SUBANG JAYA",
    state: "SELANGOR",
  };

  it("never draws a line wider than the block", () => {
    const packed = packAddress(long, measure, MAX);
    for (const line of [...packed.street, packed.locality]) {
      expect(measure(line)).toBeLessThanOrEqual(MAX);
    }
  });

  it("never emits more street lines than the page has slots", () => {
    expect(packAddress(long, measure, MAX).street.length).toBeLessThanOrEqual(TIME_ADDRESS_STREET_SLOTS);
    expect(packAddress(long, measure, MAX).streetTruncated).toBe(false);
  });

  /**
   * The utility bill dropped its last line when the formatter outran the page's
   * slots, and the last line was the state. Here the locality is what must
   * survive, whatever the street does.
   */
  it("keeps the postcode, city and state whatever the street costs", () => {
    const packed = packAddress(long, measure, MAX);
    expect(packed.locality).toBe("47500 SUBANG JAYA SELANGOR");
  });

  it("keeps the locality even for an address of nothing but street", () => {
    const packed = packAddress(
      { ...long, streetSegments: Array.from({ length: 12 }, (_, i) => `VERY LONG SEGMENT NUMBER ${i}`) },
      measure,
      MAX,
    );
    expect(packed.locality).toBe("47500 SUBANG JAYA SELANGOR");
    expect(packed.street.length).toBe(TIME_ADDRESS_STREET_SLOTS);
    expect(packed.streetTruncated).toBe(true);
    expect(packed.fullStreet.length).toBeGreaterThan(packed.street.length);
  });

  it("wraps a line that does not fit and never inserts an ellipsis", () => {
    const packed = packAddress(
      { ...long, streetSegments: ["A".repeat(400), "B".repeat(400), "C".repeat(400)] },
      measure,
      MAX,
    );
    for (const line of [...packed.street, packed.locality]) {
      expect(line.includes("...")).toBe(false);
      expect(measure(line)).toBeLessThanOrEqual(MAX);
    }
    expect(packed.street[0].startsWith("AAAA")).toBe(true);
    expect(packed.street.length).toBe(TIME_ADDRESS_STREET_SLOTS);
    expect(packed.streetTruncated).toBe(true);
  });

  it("uppercases the block and drops empty locality parts", () => {
    const packed = packAddress(
      { streetSegments: ["12 jalan besar"], postcode: "47500", locality: "subang jaya", state: undefined },
      measure,
      MAX,
    );
    expect(packed.street[0]).toBe("12 JALAN BESAR");
    expect(packed.locality).toBe("47500 SUBANG JAYA");
  });

  it("produces no locality line at all when the address has no postcode", () => {
    const packed = packAddress({ streetSegments: ["12 JALAN BESAR"] }, measure, MAX);
    expect(packed.locality).toBe("");
  });

  it("uppercases before measuring, so a mixed-case line cannot overflow once capped", () => {
    // Lowercase is narrower in a real font. A measure that only charges for caps
    // is what the bill uses after the fold; the packer must wrap the caps.
    const capsWider: Measure = (text) => {
      let width = 0;
      for (const ch of text) width += ch >= "A" && ch <= "Z" ? 8 : 4;
      return width;
    };
    const packed = packAddress(
      {
        streetSegments: ["jalan subang permai yang sangat panjang sekali", "taman subang permai"],
        postcode: "47500",
        locality: "subang jaya",
        state: "selangor",
      },
      capsWider,
      80,
    );
    for (const line of [...packed.street, packed.locality]) {
      expect(capsWider(line)).toBeLessThanOrEqual(80);
      expect(line).toBe(line.toUpperCase());
      expect(line.includes("...")).toBe(false);
    }
  });
});

const GOLDEN_ADDRESS =
  "B-12-03A\uFF0CTHE REGINA, Jalan Subang Permai, TAMAN SUBANG PERMAI, SUBANG JAYA, Selangor, 47500, Malaysia";

describe("TIME golden installation address", () => {
  it("wraps the full street, keeps the full-width comma, and does not ellipsize", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
    const packed = await buildInvoiceAddress(GOLDEN_ADDRESS, "CUSTOMER", measure, TIME_ADDRESS_MAX_WIDTH);
    const lines = printedTimeAddress(packed);

    expect(lines.slice(0, -2).join(" ")).toBe(
      "B-12-03A, THE REGINA, JALAN SUBANG PERMAI, TAMAN SUBANG PERMAI, SUBANG JAYA",
    );
    expect(lines.at(-2)).toBe("47500 SUBANG JAYA SELANGOR");
    expect(lines.at(-1)).toBe("MALAYSIA");
    expect(lines.join("\n")).not.toContain("...");
    expect(lines.join("\n")).not.toContain("03ATHE");
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(TIME_ADDRESS_MAX_WIDTH);
    expect(auditTimeBillAddress(GOLDEN_ADDRESS, lines, {
      fullStreet: packed.fullStreet,
      printedStreet: packed.street,
    }).pass).toBe(true);
    expect(packed.streetTruncated).toBe(false);
  });

  it("draws those lines on the invoice, inside the address box", async () => {
    const bytes = await generateTimeInvoice(
      { case_no: "TIME-ADDR-GOLDEN", full_name: "CUSTOMER", full_address: GOLDEN_ADDRESS },
      new Date(2026, 9, 6),
    );
    const { extractTextRuns, loadPageCmaps } = await import("@/lib/bill-generator/tenancy-stamp");
    const { getPageStreamRefs, transformStream } = await import("@/lib/bill-generator/pdf-utils");
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    const cmaps = loadPageCmaps(doc, page);
    const runs: { text: string; x: number; y: number }[] = [];
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        for (const run of extractTextRuns(buf.toString("latin1"), cmaps)) {
          if (run.text.trim()) runs.push(run);
        }
        return { data: buf, count: 0 };
      });
    }

    const text = runs.map((r) => r.text).join("\n");
    expect(text).toContain("B-12-03A, THE REGINA, JALAN SUBANG PERMAI, TAMAN SUBANG");
    expect(text).toContain("PERMAI, SUBANG JAYA");
    expect(text).toContain("47500 SUBANG JAYA SELANGOR");
    expect(text).toContain("MALAYSIA");
    expect(text).not.toContain("...");
    expect(text).not.toContain("03ATHE");

    const address = runs.filter((r) =>
      r.text.startsWith("B-12-03A") ||
      r.text.startsWith("PERMAI, SUBANG") ||
      r.text.startsWith("47500 SUBANG") ||
      r.text === "MALAYSIA",
    );
    expect(address.length).toBeGreaterThanOrEqual(4);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const run of address) {
      expect(run.x).toBeCloseTo(42, 0);
      expect(run.y).toBeGreaterThanOrEqual(650);
      expect(run.x + font.widthOfTextAtSize(run.text, TIME_ADDRESS_FONT_SIZE)).toBeLessThanOrEqual(342);
    }
  });
});

const TITIWANGSA =
  "Level 8,Unit 7,RESIDENSI TIARA TITIWANGSA (D BRIGHTTON) - BLOCK A2 APARTMENT,28, Jalan Tiara Titiwangsa,,,53200,Kuala Lumpur,Wilayah Persekutuan Kuala Lumpur";
const SPECTRUM =
  "106, G FLOOR, SPECTRUM APARTMENT - SHOPLOT BLOCK 1 Jalan PJS 11/2, Bandar Sunway, Petaling Jaya, Selangor , Malaysia";
const RAZAK =
  "8-03, LEVEL 8, MENARA YAYASAN TUN ABDUL RAZAK, Jalan Bukit Bintang Kuala Lumpur Wilayah Persekutuan Kuala Lumpur";
const THREE_STREET =
  "A-15-08, LEVEL 15, RESIDENSI VISTA PANORAMA HEIGHTS, BLOCK B2 APARTMENT WING, 36, JALAN BUKIT JALIL 1/2, TAMAN BUKIT JALIL, PAVILION RESIDENCE, SUBANG JAYA, Selangor, 47500, Malaysia";

async function helveticaLines(source: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
  const packed = await buildInvoiceAddress(source, "CUSTOMER", measure, TIME_ADDRESS_MAX_WIDTH);
  return { packed, lines: printedTimeAddress(packed), measure };
}

describe("TIME street truncation and locality repeats", () => {
  it("drops a repeated trailing city only when the street would pass two lines, and keeps the golden city", async () => {
    const { packed, lines } = await helveticaLines(TITIWANGSA);
    expect(lines).toEqual([
      "LEVEL 8, UNIT 7, RESIDENSI TIARA TITIWANGSA (D BRIGHTTON)",
      "BLOCK A2 APARTMENT, 28, JALAN TIARA TITIWANGSA",
      "53200 KUALA LUMPUR",
      "MALAYSIA",
    ]);
    expect(packed.streetTruncated).toBe(false);
    expect(packed.street.some((line) => line.endsWith("KUALA"))).toBe(false);
    expect(auditTimeBillAddress(TITIWANGSA, lines, {
      fullStreet: packed.fullStreet,
      printedStreet: packed.street,
    }).pass).toBe(true);
  });

  it("prints Malaysia, the city and the state once when the source has no postcode", async () => {
    const spectrum = await helveticaLines(SPECTRUM);
    expect(spectrum.lines).toEqual([
      "106, G FLOOR, SPECTRUM APARTMENT SHOPLOT BLOCK 1 JALAN",
      "PJS 11/2, BANDAR SUNWAY, PETALING JAYA, SELANGOR",
      "MALAYSIA",
    ]);
    expect(spectrum.lines.filter((line) => line === "MALAYSIA")).toHaveLength(1);
    expect(spectrum.lines.join(" ").match(/\bSELANGOR\b/g)).toHaveLength(1);
    expect(spectrum.lines.join(" ")).toContain("PETALING JAYA");

    const razak = await helveticaLines(RAZAK);
    expect(razak.lines).toEqual([
      "8-03, LEVEL 8, MENARA YAYASAN TUN ABDUL RAZAK, JALAN BUKIT",
      "BINTANG KUALA LUMPUR WILAYAH PERSEKUTUAN KUALA LUMPUR",
      "MALAYSIA",
    ]);
    expect(razak.lines.some((line) => line.startsWith("KUALA LUMPUR WP"))).toBe(false);
    expect(auditTimeBillAddress(RAZAK, razak.lines, {
      fullStreet: razak.packed.fullStreet,
      printedStreet: razak.packed.street,
    }).pass).toBe(true);
  });

  it("draws a third street line above the e-invoice mark when the street still needs it", async () => {
    const { packed, lines } = await helveticaLines(THREE_STREET);
    expect(packed.street).toHaveLength(3);
    expect(packed.streetTruncated).toBe(false);
    expect(lines.at(-2)).toBe("47500 SUBANG JAYA SELANGOR");
    expect(lines.at(-1)).toBe("MALAYSIA");
    expect(TIME_ADDRESS_BASELINES_WITH_THIRD_STREET.at(-1)! - (207 / 1000) * TIME_ADDRESS_FONT_SIZE)
      .toBeGreaterThan(TIME_ADDRESS_QR_TOP);

    const bytes = await generateTimeInvoice(
      { case_no: "TIME-ADDR-3", full_name: "CUSTOMER", full_address: THREE_STREET },
      new Date(2026, 9, 6),
    );
    const { extractTextRuns, loadPageCmaps } = await import("@/lib/bill-generator/tenancy-stamp");
    const { getPageStreamRefs, transformStream } = await import("@/lib/bill-generator/pdf-utils");
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    const cmaps = loadPageCmaps(doc, page);
    const runs: { text: string; x: number; y: number }[] = [];
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        for (const run of extractTextRuns(buf.toString("latin1"), cmaps)) {
          if (run.text.trim()) runs.push(run);
        }
        return { data: buf, count: 0 };
      });
    }
    const address = runs.filter((run) => lines.includes(run.text) && run.y > 630 && run.x < 80);
    expect(address.map((run) => run.text).sort()).toEqual([...lines].sort());
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const run of address) {
      expect(run.x).toBeCloseTo(42, 0);
      expect(run.y).toBeGreaterThan(TIME_ADDRESS_QR_TOP);
      expect(run.x + font.widthOfTextAtSize(run.text, TIME_ADDRESS_FONT_SIZE)).toBeLessThanOrEqual(342);
    }
    expect(Math.min(...address.map((run) => run.y))).toBeCloseTo(TIME_ADDRESS_BASELINES_WITH_THIRD_STREET.at(-1)!, 1);
    expect(address.some((run) => Math.abs(run.y - TIME_ADDRESS_BASELINES[1]) < 0.05)).toBe(true);
  });

  it("names a sliced street street_truncated even when no token is missing", () => {
    const segment = "ALPHA BETA";
    const packed = packAddress(
      {
        streetSegments: Array.from({ length: 30 }, () => segment),
        postcode: "47500",
        locality: "SUBANG JAYA",
        state: "SELANGOR",
      },
      (text) => text.length * 5,
      300,
    );
    const lines = printedTimeAddress(packed);
    const audit = auditTimeBillAddress(`${segment}, 47500 SUBANG JAYA SELANGOR`, lines, {
      fullStreet: packed.fullStreet,
      printedStreet: packed.street,
    });
    expect(packed.streetTruncated).toBe(true);
    expect(audit.missing).toEqual([]);
    expect(audit.pass).toBe(false);
    expect(timeAuditDetail(audit).reason).toBe("street_truncated");
  });
});

// ── Artwork ────────────────────────────────────────────────────────

describe("payment slip artwork", () => {
  it("gives the QR grid the three finder patterns that make it read as one", () => {
    const grid = randomQrModules(QR_FORM.modules, makeRng(hashSeed("a")));
    const corners: [number, number][] = [
      [0, 0],
      [0, QR_FORM.modules - 7],
      [QR_FORM.modules - 7, 0],
    ];
    for (const [top, left] of corners) {
      // Solid 7x7 ring with a 3x3 core is what a finder pattern is.
      expect(grid[top][left]).toBe(true);
      expect(grid[top + 3][left + 3]).toBe(true);
      expect(grid[top + 1][left + 1]).toBe(false);
    }
    // The fourth corner carries payload, not a finder, so it is not forced solid.
    expect(grid.length).toBe(QR_FORM.modules);
  });

  it("keeps every QR module inside the box the template drew", () => {
    const grid = randomQrModules(QR_FORM.modules, makeRng(hashSeed("b")));
    const content = qrFormContent(grid);
    const rects = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)];
    expect(rects.length).toBeGreaterThan(0);
    const maxX = QR_FORM.originX + QR_FORM.modules * QR_FORM.moduleSize;
    for (const [, x, y, w, h] of rects) {
      expect(Number(x)).toBeGreaterThanOrEqual(QR_FORM.originX);
      expect(Number(y)).toBeGreaterThanOrEqual(QR_FORM.originY);
      expect(Number(x) + Number(w)).toBeLessThanOrEqual(maxX);
      expect(Number(y) + Number(h)).toBeLessThanOrEqual(maxX);
    }
  });

  it("never lets a barcode overrun the width the template's bars occupied", () => {
    for (const [name, extent] of Object.entries(BARCODE_EXTENTS)) {
      const content = barcodeContent(extent, makeRng(hashSeed(name)));
      const rects = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)];
      expect(rects.length).toBeGreaterThan(5);
      for (const [, x, , w] of rects) {
        expect(Number(x)).toBeGreaterThanOrEqual(BARCODE.x0);
        expect(Number(x) + Number(w)).toBeLessThanOrEqual(extent + 0.01);
      }
    }
  });

  it("produces exactly the pixel count the bitmap object declares", () => {
    const buf = qrBitmapRgb(makeRng(hashSeed("c")));
    expect(buf.length).toBe(QR_BITMAP.width * QR_BITMAP.height * 3);
    // Both inks are present: an all-white or all-black square is not a QR.
    expect(buf.includes(0)).toBe(true);
    expect(buf.includes(0xff)).toBe(true);
  });

  it("draws the same artwork for the same case", () => {
    const a = barcodeContent(BARCODE_EXTENTS.Xf2, makeRng(hashSeed("time-artwork:202624115")));
    const b = barcodeContent(BARCODE_EXTENTS.Xf2, makeRng(hashSeed("time-artwork:202624115")));
    expect(b).toBe(a);
  });
});

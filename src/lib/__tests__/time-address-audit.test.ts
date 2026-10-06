import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { auditTimeBillAddress } from "@/lib/bill-generator/address-audit";
import {
  buildInvoiceAddress,
  printedTimeAddress,
  TIME_ADDRESS_FONT_SIZE,
  TIME_ADDRESS_MAX_WIDTH,
} from "@/lib/bill-generator/time-invoice-fields";

interface CaseRow {
  case_no: string;
  provider: string;
  full_address: string;
}

describe("synthetic TIME address audit", () => {
  it("passes 200+ invented Malaysian addresses with no ellipsis and no line past the box", async () => {
    const rows = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts/fixtures/time-address-cases.json"), "utf8"),
    ) as CaseRow[];
    expect(rows.length).toBeGreaterThanOrEqual(200);
    expect(rows.some((r) => r.provider === "TIME FTTH")).toBe(true);
    expect(rows.some((r) => r.provider === "TIME Business")).toBe(true);
    expect(rows.some((r) => r.full_address.includes("\uFF0C"))).toBe(true);
    expect(rows.some((r) => r.full_address.includes("2-T.12-U.01"))).toBe(true);
    expect(rows.some((r) => r.full_address.includes("LOT "))).toBe(true);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
    const failed: string[] = [];
    for (const row of rows) {
      const lines = printedTimeAddress(
        await buildInvoiceAddress(row.full_address, "", measure, TIME_ADDRESS_MAX_WIDTH),
      );
      const audit = auditTimeBillAddress(row.full_address, lines);
      if (!audit.pass) failed.push(`${row.case_no} ${audit.missing.join(" ")} ${audit.runTogether.join(" ")}`);
      for (const line of lines) {
        expect(line.includes("...")).toBe(false);
        expect(measure(line)).toBeLessThanOrEqual(TIME_ADDRESS_MAX_WIDTH);
      }
    }
    expect(failed).toEqual([]);
  });
});

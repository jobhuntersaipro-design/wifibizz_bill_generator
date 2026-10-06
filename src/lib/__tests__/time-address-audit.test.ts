import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { auditTimeBillAddress, timeAuditDetail } from "@/lib/bill-generator/address-audit";
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
    expect(rows.some((r) => r.full_address.includes("TIARA TITIWANGSA"))).toBe(true);
    expect(rows.some((r) => r.full_address.includes("SPECTRUM APARTMENT"))).toBe(true);
    expect(rows.some((r) => r.full_address.includes("MENARA YAYASAN"))).toBe(true);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
    const failed: string[] = [];
    for (const row of rows) {
      const packed = await buildInvoiceAddress(row.full_address, "", measure, TIME_ADDRESS_MAX_WIDTH);
      const lines = printedTimeAddress(packed);
      const audit = auditTimeBillAddress(row.full_address, lines, {
        fullStreet: packed.fullStreet,
        printedStreet: packed.street,
      });
      if (!audit.pass) {
        failed.push(`${row.case_no} ${audit.missing.join(" ")} ${audit.runTogether.join(" ")} ${audit.streetTruncated}`);
      }
      for (const line of lines) {
        expect(line.includes("...")).toBe(false);
        expect(measure(line)).toBeLessThanOrEqual(TIME_ADDRESS_MAX_WIDTH);
      }
    }
    expect(failed).toEqual([]);
  });
});

const STARRED = "*1087 JALAN BUBUL BATU 2 KAMPUNG MUHIBBAH SEMPORNA SABAH 91300";
const STARRED_LOT = "*7190 JALAN BUKIT LALLANG 2 TAMAN LALLANG SEMPORNA SABAH 91300";
const HILLPARK = "7 JALAN HILL PARK 3/1A - HILLPARK HOME SEMENYIH SELANGOR MALAYSIA 43500";

async function printedLines(source: string): Promise<string[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
  return printedTimeAddress(await buildInvoiceAddress(source, "", measure, TIME_ADDRESS_MAX_WIDTH));
}

describe("TIME audit follow-up", () => {
  it("treats a leading or trailing mark as part of the same token, and still prints the star", async () => {
    const marked = [
      STARRED,
      STARRED_LOT,
      "#1087 JALAN BUBUL BATU 2 KAMPUNG MUHIBBAH SEMPORNA SABAH 91300",
      "1087* JALAN BUBUL BATU 2 KAMPUNG MUHIBBAH SEMPORNA SABAH 91300",
    ];
    for (const source of marked) {
      const lines = await printedLines(source);
      const audit = auditTimeBillAddress(source, lines);
      expect(audit).toMatchObject({ pass: true, missing: [], runTogether: [] });
      expect(lines[0]).toContain(source.split(" ")[0]);
    }
  });

  it("keeps a free-standing dash dropped and does not treat HILLPARK as HILL jammed onto PARK", async () => {
    const lines = await printedLines(HILLPARK);
    const audit = auditTimeBillAddress(HILLPARK, lines);
    expect(lines.join(" ")).toContain("3/1A HILLPARK");
    expect(lines.join(" ")).toContain("HILL PARK");
    expect(lines.join(" ")).not.toMatch(/\s-\s/);
    expect(audit).toMatchObject({ pass: true, missing: [], runTogether: [], ellipsis: false });
  });

  it("still names a real glued pair, and an ellipsis-only fail still has a reason", () => {
    const glued = auditTimeBillAddress("B-12-03A THE REGINA", ["B-12-03ATHE REGINA"]);
    expect(glued.pass).toBe(false);
    expect(glued.runTogether).toEqual(["B-12-03ATHE"]);
    expect(timeAuditDetail(glued).reason).toBe("missing=THE; run-together=B-12-03ATHE");

    const dots = auditTimeBillAddress("12 JALAN BESAR", ["12 JALAN BESAR..."]);
    expect(dots.missing).toEqual([]);
    expect(timeAuditDetail(dots)).toEqual({ missingTokens: "", reason: "ellipsis" });
  });

  it("TIME csv carries provider, missing_tokens and reason, and --all-providers keeps every row", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "time-audit-"));
    const input = path.join(dir, "cases.json");
    const filtered = path.join(dir, "filtered.csv");
    const all = path.join(dir, "all.csv");
    writeFileSync(
      input,
      JSON.stringify([
        { case_no: "U-1", provider: "Umobile", full_address: STARRED },
        { case_no: "T-1", provider: "TIME FTTH", full_address: HILLPARK },
        { case_no: "N-1", provider: null, full_address: STARRED_LOT },
      ]),
    );
    const args = ["tsx", "scripts/audit-bill-addresses.ts", "--bill", "time"];
    execFileSync("npx", [...args, input, filtered], { cwd: process.cwd() });
    const filteredRows = readFileSync(filtered, "utf8").trim().split("\n");
    expect(filteredRows[0]).toBe("case_no,provider,source_address,bill_address,result,missing_tokens,reason");
    expect(filteredRows).toHaveLength(3);
    expect(filteredRows.join("\n")).not.toContain("U-1");
    expect(filteredRows.join("\n")).toContain('"T-1","TIME FTTH"');
    expect(filteredRows.join("\n")).toContain('"N-1",""');
    expect(filteredRows.filter((row) => row.includes('"PASS","",""'))).toHaveLength(2);

    execFileSync("npx", [...args, "--all-providers", input, all], { cwd: process.cwd() });
    const allRows = readFileSync(all, "utf8").trim().split("\n");
    expect(allRows).toHaveLength(4);
    expect(allRows.join("\n")).toContain('"U-1","Umobile"');
    expect(allRows.filter((row) => row.includes('"PASS","",""'))).toHaveLength(3);
  }, 60_000);
});

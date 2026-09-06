import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateInternetBill } from "@/lib/bill-generator/internet-bill";
import {
  appendUmobileImagePage,
  pickRandomFromPool,
  type ModemImage,
} from "@/lib/bill-generator/umobile-modem";

const PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const CASE = {
  case_no: "202624115",
  full_name: "MUHAMMAD SAHINU BIN INSANU",
  full_address: "NO 12 JALAN BUKIT INDAH 2/5 TAMAN BUKIT INDAH 81200 JOHOR BAHRU JOHOR",
  mobile: "+60137089093",
};

async function samplePng(): Promise<ModemImage> {
  return { bytes: PIXEL_PNG, mime: "image/png" };
}

describe("pickRandomFromPool", () => {
  it("returns null when the pool is empty", () => {
    expect(pickRandomFromPool([])).toBeNull();
  });

  it("returns the only item", () => {
    expect(pickRandomFromPool(["only"], () => 0.4)).toBe("only");
  });

  it("is not stuck on one asset when the pool has two", () => {
    const pool = ["first", "second"];
    expect(pickRandomFromPool(pool, () => 0)).toBe("first");
    expect(pickRandomFromPool(pool, () => 0.99)).toBe("second");
  });
});

describe("appendUmobileImagePage", () => {
  it("returns the bill unchanged when the pool is empty", async () => {
    const bill = await generateInternetBill(CASE);
    const combined = await appendUmobileImagePage(bill, null);
    const original = await PDFDocument.load(bill);
    const next = await PDFDocument.load(combined);
    expect(next.getPageCount()).toBe(original.getPageCount());
    expect(combined.includes(Buffer.from("MUHAMMAD SAHINU BIN INSANU"))).toBe(true);
  });

  it("adds exactly one extra page when an image is present", async () => {
    const bill = await generateInternetBill(CASE);
    const original = await PDFDocument.load(bill);
    const combined = await PDFDocument.load(
      await appendUmobileImagePage(bill, await samplePng()),
    );
    expect(combined.getPageCount()).toBe(original.getPageCount() + 1);
    expect(
      Buffer.from(await combined.save()).includes(Buffer.from("MUHAMMAD SAHINU BIN INSANU")),
    ).toBe(true);
  });
});

describe("generateInternetBill stays bill-only", () => {
  it("does not grow when called without a combine", async () => {
    const a = await PDFDocument.load(await generateInternetBill(CASE));
    const b = await PDFDocument.load(await generateInternetBill(CASE));
    expect(a.getPageCount()).toBe(b.getPageCount());
    expect(a.getPageCount()).toBe(3);
  });
});

describe("Case List uses the Order Entry combine path", () => {
  it("both generate routes call buildInternetBillPdf and never stamp a slot", async () => {
    const [helper, bills, orders, caseList] = await Promise.all([
      readFile("src/lib/bill-generator/umobile-modem.ts", "utf8"),
      readFile("src/app/api/bills/generate/route.ts", "utf8"),
      readFile("src/app/api/orders/generate-document/route.ts", "utf8"),
      readFile("src/components/dashboard/CaseManagementSection.tsx", "utf8"),
    ]);

    for (const src of [helper, bills, orders, caseList]) {
      expect(src).not.toMatch(/UMOBILE_MODEM_SLOT|stampModemInSlot|stamp-into-slot/);
    }

    expect(helper).toContain("export async function buildInternetBillPdf");
    expect(helper).toContain("appendUmobileImagePage");
    expect(bills).toContain("buildInternetBillPdf");
    expect(bills).not.toContain("generateInternetBill(");
    expect(orders).toContain("buildInternetBillPdf");
    expect(orders).not.toContain("generateInternetBill(");

    // Per-row Internet always POSTs generate. Downloading a stored URL would
    // re-serve a pre-combine (slot-stamped) R2 object for already-billed cases.
    const internetClick = caseList.slice(
      caseList.indexOf('aria-label={c.internet_bill_url ? `Download internet bill'),
      caseList.indexOf('aria-label={c.utility_bill_url'),
    );
    expect(internetClick).toContain('handleGenerateSingle(c.case_no, "internet")');
    expect(internetClick).not.toContain("/api/bills/download");
  });

  it("empty-pool combine stays bill-only (Case List 3 pages)", async () => {
    const bill = await generateInternetBill(CASE);
    const combined = await appendUmobileImagePage(bill, null);
    expect((await PDFDocument.load(combined)).getPageCount()).toBe(3);
  });
});

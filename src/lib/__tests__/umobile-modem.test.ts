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

import { describe, it, expect } from "vitest";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { generateInternetBill } from "@/lib/bill-generator/internet-bill";
import {
  UMOBILE_MODEM_SLOT,
  pickRandomFromPool,
  stampModemInSlot,
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

function xobjectCount(doc: PDFDocument, pageIndex: number): number {
  const page = doc.getPages()[pageIndex];
  if (!page) return 0;
  const resources = page.node.Resources();
  if (!resources) return 0;
  const xo = resources.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return 0;
  return xo.entries().length;
}

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

describe("stampModemInSlot", () => {
  it("does not fail when there is no image", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    await expect(stampModemInSlot(doc, null)).resolves.toBe(false);
    expect(doc.getPageCount()).toBe(2);
  });

  it("draws one image in the page-2 slot", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage([612, 792]);
    const before = xobjectCount(doc, UMOBILE_MODEM_SLOT.pageIndex);
    const stamped = await stampModemInSlot(doc, await samplePng());
    expect(stamped).toBe(true);
    expect(xobjectCount(doc, UMOBILE_MODEM_SLOT.pageIndex)).toBe(before + 1);
    expect(xobjectCount(doc, 0)).toBe(0);
  });
});

describe("generateInternetBill modem stamp", () => {
  it("still generates when the pool is empty", async () => {
    const pdf = await generateInternetBill(CASE, { modemImage: null });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(pdf.includes(Buffer.from("MUHAMMAD SAHINU BIN INSANU"))).toBe(true);
  });

  it("embeds exactly one extra image on the slot page when the pool has an image", async () => {
    const empty = await PDFDocument.load(
      await generateInternetBill(CASE, { modemImage: null }),
    );
    const stamped = await PDFDocument.load(
      await generateInternetBill(CASE, { modemImage: await samplePng() }),
    );
    const page = UMOBILE_MODEM_SLOT.pageIndex;
    expect(xobjectCount(stamped, page)).toBe(xobjectCount(empty, page) + 1);
    expect(stamped.getPageCount()).toBe(empty.getPageCount());
    expect(
      Buffer.from(await stamped.save()).includes(Buffer.from("MUHAMMAD SAHINU BIN INSANU")),
    ).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import {
  combineOrderDocuments,
  combinedFilename,
  documentToPdfBytes,
  ownedOrderKey,
} from "@/lib/order-combine";

async function makePdf(label: string, pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`${label}-${i + 1}`, { x: 20, y: 100, size: 12, font });
  }
  return doc.save();
}

/**
 * A conversation-screenshot-shaped JPEG with real pixel noise.
 * A flat colour compresses so well as PNG that it hides the explosion the old
 * canvas path caused on a photographed / captured JPG.
 */
async function sampleJpeg(): Promise<Uint8Array> {
  const width = 828;
  const height = 2070;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i * 37 + (i % 251)) & 0xff;
  }
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 70 })
      .toBuffer(),
  );
}

const SAMPLE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("combinedFilename", () => {
  it("matches the upload-action scheme", () => {
    expect(combinedFilename("810404-018258", 2)).toBe("810404018258_combined_2.pdf");
  });
});

describe("ownedOrderKey", () => {
  it("scopes to the caller's prefix and rejects traversal", () => {
    expect(ownedOrderKey("u1", "orders/u1/810404018258_combined_2.pdf")).toBe(true);
    expect(ownedOrderKey("u1", "orders/u2/810404018258_combined_2.pdf")).toBe(false);
    expect(ownedOrderKey("u1", "orders/u1/../secret.pdf")).toBe(false);
  });
});

describe("documentToPdfBytes", () => {
  it("embeds a JPEG as JPEG, not a PNG re-encode", async () => {
    const jpeg = await sampleJpeg();
    const pngFromJpeg = await sharp(jpeg).png().toBuffer();
    // This is the old client path: canvas (or any lossless re-encode) explodes
    // a conversation JPG. That extra weight is what the Server Action then
    // failed to return as a flight response.
    expect(pngFromJpeg.byteLength).toBeGreaterThan(jpeg.byteLength * 3);

    const page = await documentToPdfBytes("810404018258_inconversation_1.jpg", jpeg);
    const asPngPage = await documentToPdfBytes(
      "810404018258_inconversation_1.png",
      new Uint8Array(pngFromJpeg),
    );
    expect(page.byteLength).toBeLessThan(asPngPage.byteLength);

    expect(Buffer.from(page).toString("latin1")).toContain("/DCTDecode");
  });

  it("wraps a PNG as one A4 page", async () => {
    const page = await documentToPdfBytes("scan.png", SAMPLE_PNG);
    const doc = await PDFDocument.load(page);
    expect(doc.getPageCount()).toBe(1);
  });

  it("wraps WEBP so it can sit next to a PDF", async () => {
    const webp = await sharp({
      create: { width: 80, height: 80, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .webp()
      .toBuffer();
    const page = await documentToPdfBytes("shot.webp", new Uint8Array(webp));
    expect((await PDFDocument.load(page)).getPageCount()).toBe(1);
  });
});

describe("combineOrderDocuments", () => {
  it("merges a PDF and a JPG into one PDF that holds both", async () => {
    const pdf = await makePdf("bill", 2);
    const jpeg = await sampleJpeg();
    const result = await combineOrderDocuments([
      { filename: "810404018258_combined_2.pdf", bytes: pdf },
      { filename: "810404018258_inconversation_1.jpg", bytes: jpeg },
    ]);

    expect(result.failed).toEqual([]);
    expect(result.pageCount).toBe(3);
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(3);
    // The two bill pages keep their 200×200 size; the JPG is an A4 page.
    expect(reloaded.getPage(0).getSize()).toMatchObject({ width: 200, height: 200 });
    expect(reloaded.getPage(1).getSize()).toMatchObject({ width: 200, height: 200 });
    expect(reloaded.getPage(2).getSize().width).toBeCloseTo(595.28, 1);
    expect(Buffer.from(result.bytes).toString("latin1")).toContain("/DCTDecode");
  });

  it("keeps PDF+PNG working (the pair that already succeeded)", async () => {
    const result = await combineOrderDocuments([
      { filename: "a.pdf", bytes: await makePdf("A", 1) },
      { filename: "b.png", bytes: SAMPLE_PNG },
    ]);
    expect(result.pageCount).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it("names an unreadable source and still merges the rest", async () => {
    const result = await combineOrderDocuments([
      { filename: "good.pdf", bytes: await makePdf("good", 1) },
      { filename: "bad.jpg", bytes: new TextEncoder().encode("not an image") },
    ]);
    expect(result.pageCount).toBe(1);
    expect(result.failed).toEqual(["bad.jpg"]);
  });
});

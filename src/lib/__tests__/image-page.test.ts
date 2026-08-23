import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  fitWithin,
  pngToPdfPage,
  A4_WIDTH,
  A4_HEIGHT,
  IMAGE_PAGE_MARGIN,
} from "@/lib/bill-generator/image-page";

const BOX_W = A4_WIDTH - IMAGE_PAGE_MARGIN * 2;
const BOX_H = A4_HEIGHT - IMAGE_PAGE_MARGIN * 2;

describe("fitWithin", () => {
  it("fits a tall chat capture by its height and keeps the aspect ratio", () => {
    // The real capture: 828×2070 device pixels, a 1:2.5 column.
    const p = fitWithin(828, 2070, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT);
    expect(p.height).toBeCloseTo(BOX_H, 5);
    expect(p.width / p.height).toBeCloseTo(828 / 2070, 5);
    expect(p.width).toBeLessThan(BOX_W);
  });

  it("fits a wide image by its width instead", () => {
    const p = fitWithin(2000, 500, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT);
    expect(p.width).toBeCloseTo(BOX_W, 5);
    expect(p.height).toBeLessThan(BOX_H);
  });

  it("never draws outside the margin", () => {
    for (const [w, h] of [[828, 2070], [2000, 500], [100, 100], [3000, 3000]]) {
      const p = fitWithin(w, h, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT);
      expect(p.x).toBeGreaterThanOrEqual(IMAGE_PAGE_MARGIN - 0.001);
      expect(p.y).toBeGreaterThanOrEqual(IMAGE_PAGE_MARGIN - 0.001);
      expect(p.x + p.width).toBeLessThanOrEqual(A4_WIDTH - IMAGE_PAGE_MARGIN + 0.001);
      expect(p.y + p.height).toBeLessThanOrEqual(A4_HEIGHT - IMAGE_PAGE_MARGIN + 0.001);
    }
  });

  it("centres the image on the page", () => {
    const p = fitWithin(828, 2070, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT);
    expect(p.x + p.width / 2).toBeCloseTo(A4_WIDTH / 2, 5);
    expect(p.y + p.height / 2).toBeCloseTo(A4_HEIGHT / 2, 5);
  });

  it("does not blow up an image smaller than the box", () => {
    const p = fitWithin(200, 300, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT);
    expect(p.width).toBe(200);
    expect(p.height).toBe(300);
  });

  it("refuses an image with no size rather than dividing by zero", () => {
    expect(() => fitWithin(0, 100, BOX_W, BOX_H, A4_WIDTH, A4_HEIGHT)).toThrow(/no size/i);
  });
});

describe("pngToPdfPage", () => {
  /** A minimal valid 2×3 PNG, so the test exercises real pdf-lib embedding. */
  async function samplePng(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    // pdf-lib cannot author PNGs, so use a known-good fixture: a 1×1 red pixel.
    void doc;
    return Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    );
  }

  it("produces a single A4 page holding the image", async () => {
    const bytes = await pngToPdfPage(await samplePng());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(A4_WIDTH, 1);
    expect(height).toBeCloseTo(A4_HEIGHT, 1);
  });

  it("rejects bytes that are not a PNG", async () => {
    await expect(pngToPdfPage(new TextEncoder().encode("not a png"))).rejects.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import {
  COMBINED_DOC_LABEL,
  COMBINED_DOC_TYPE,
  MIN_COMBINE,
  applyCombine,
  canCombine,
  isImageDocument,
  moveDoc,
} from "../order-merge";
import type { OrderDocument } from "../order-types";

const doc = (key: string, type = "other"): OrderDocument => ({
  type,
  key: `orders/u1/${key}`,
  url: `/api/orders/document?key=${key}`,
  filename: key,
});

const A = doc("a.pdf");
const B = doc("b.pdf");
const C = doc("c.png");
const ID = doc("id.png", "mykad");

describe("canCombine", () => {
  it("needs at least two — combining one file is a format conversion", () => {
    expect(MIN_COMBINE).toBe(2);
    expect(canCombine([])).toBe(false);
    expect(canCombine([A])).toBe(false);
    expect(canCombine([A, B])).toBe(true);
  });
});

describe("moveDoc", () => {
  it("swaps with the neighbour", () => {
    expect(moveDoc([A, B, C], 1, -1)).toEqual([B, A, C]);
    expect(moveDoc([A, B, C], 1, 1)).toEqual([A, C, B]);
  });

  // Wrapping would mean "up" sending the top document to the bottom, which is
  // never what pressing it meant.
  it("refuses to wrap at either end", () => {
    expect(moveDoc([A, B, C], 0, -1)).toEqual([A, B, C]);
    expect(moveDoc([A, B, C], 2, 1)).toEqual([A, B, C]);
  });

  it("ignores an out-of-range index", () => {
    expect(moveDoc([A, B], 5, -1)).toEqual([A, B]);
    expect(moveDoc([A, B], -1, 1)).toEqual([A, B]);
  });

  it("does not mutate its input", () => {
    const before = [A, B];
    moveDoc(before, 0, 1);
    expect(before).toEqual([A, B]);
  });
});

describe("applyCombine", () => {
  const COMBINED = doc("920505034434_combined_1.pdf");

  it("puts the combined file where the first document it replaced was", () => {
    expect(applyCombine([A, B, C], [A.key, B.key], COMBINED)).toEqual([COMBINED, C]);
  });

  // Every supporting document goes in, so the normal case leaves exactly one.
  it("leaves exactly one supporting document behind", () => {
    expect(applyCombine([A, B, C], [A.key, B.key, C.key], COMBINED)).toEqual([COMBINED]);
  });

  // The exception is a source that could not be read: its pages are NOT in the
  // combined file, so removing it would lose it for nothing.
  it("keeps a document that was skipped because it could not be read", () => {
    expect(applyCombine([A, B, C], [A.key, C.key], COMBINED)).toEqual([COMBINED, B]);
  });

  it("leaves the identity document alone", () => {
    const out = applyCombine([ID, A, B], [A.key, B.key], COMBINED);
    expect(out).toEqual([ID, COMBINED]);
    expect(out.some((d) => d.type === "mykad")).toBe(true);
  });

  it("appends when the replaced documents are already gone", () => {
    expect(applyCombine([A], ["orders/u1/gone.pdf"], COMBINED)).toEqual([A, COMBINED]);
  });

  it("never leaves a merged source behind", () => {
    const out = applyCombine([A, B, C], [A.key, C.key], COMBINED);
    expect(out.map((d) => d.key)).not.toContain(A.key);
    expect(out.map((d) => d.key)).not.toContain(C.key);
  });
});

describe("isImageDocument", () => {
  // pdf-lib embeds PNG and JPEG only, so every one of these has to be routed
  // through the canvas before it can become a page.
  it("recognises every image extension the uploader accepts", () => {
    for (const ext of ["jpg", "jpeg", "jfif", "png", "bmp", "webp"]) {
      expect(isImageDocument(`920505034434_mykad_1.${ext}`)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isImageDocument("SCAN.PNG")).toBe(true);
  });

  it("does not treat a PDF as an image", () => {
    expect(isImageDocument("920505034434_utilitybill_1.pdf")).toBe(false);
  });
});

describe("combined document identity", () => {
  it('files the combined PDF under "other", never as an ID copy', () => {
    expect(COMBINED_DOC_TYPE).toBe("other");
    expect(COMBINED_DOC_LABEL).toBe("combined");
  });
});

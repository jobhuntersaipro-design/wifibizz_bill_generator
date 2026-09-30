import { describe, it, expect } from "vitest";
import {
  UMOBILE_IMAGE_MAX_BYTES,
  sniffImageMime,
  umobileImageFileError,
} from "@/lib/umobile-image-rules";
import { pageNumbers, pageSlice } from "@/lib/paginate";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe("umobileImageFileError", () => {
  it("accepts PNG and JPEG under the limit, any case of extension", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.Png"]) {
      expect(umobileImageFileError({ name, size: 1000 })).toBeNull();
    }
  });

  it("names why a file is refused", () => {
    expect(umobileImageFileError({ name: "notes.pdf", size: 10 })).toBe("Not a PNG or JPEG image.");
    expect(umobileImageFileError({ name: "noext", size: 10 })).toBe("Not a PNG or JPEG image.");
    expect(umobileImageFileError({ name: "empty.png", size: 0 })).toBe("The file is empty.");
    expect(umobileImageFileError({ name: "big.jpg", size: 6 * 1024 * 1024 })).toBe("6.0MB — over the 5MB limit.");
  });

  it("allows exactly 5MB and refuses one byte more", () => {
    expect(umobileImageFileError({ name: "x.png", size: UMOBILE_IMAGE_MAX_BYTES })).toBeNull();
    expect(umobileImageFileError({ name: "x.png", size: UMOBILE_IMAGE_MAX_BYTES + 1 })).not.toBeNull();
  });
});

describe("sniffImageMime", () => {
  it("reads the type from the bytes, not the name", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
  });

  it("refuses bytes that are not an image, and truncated headers", () => {
    expect(sniffImageMime(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageMime(PNG.slice(0, 4))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe("gallery pagination", () => {
  it("12 per page: 13 images put exactly one on page 2", () => {
    const rows = Array.from({ length: 13 }, (_, i) => i);
    expect(pageSlice(rows, 1, 12)).toHaveLength(12);
    expect(pageSlice(rows, 2, 12)).toEqual([12]);
  });

  it("lists every page when there are few", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps first, last and the current page's neighbours, marking gaps", () => {
    expect(pageNumbers(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, "gap", 10]);
    expect(pageNumbers(10, 10)).toEqual([1, "gap", 9, 10]);
    expect(pageNumbers(2, 10)).toEqual([1, 2, 3, "gap", 10]);
  });
});

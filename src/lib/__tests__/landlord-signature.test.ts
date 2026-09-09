import { describe, it, expect } from "vitest";
import { pickRandomFromPool } from "@/lib/bill-generator/umobile-modem";
import { signatureMime, isUsableSignatureImage } from "@/lib/bill-generator/landlord-signature";

describe("empty signature pool", () => {
  it("picks nothing from an empty list — generate must not hard-fail", () => {
    expect(pickRandomFromPool([])).toBeNull();
  });

  it("accepts only png and jpeg", () => {
    expect(signatureMime("image/png")).toBe("image/png");
    expect(signatureMime("image/jpeg")).toBe("image/jpeg");
    expect(signatureMime("image/webp")).toBeNull();
  });

  it("rejects a 10x10 proof image as a signature", async () => {
    const tiny = await (await import("sharp")).default({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    expect(await isUsableSignatureImage({ bytes: tiny, mime: "image/png" })).toBe(false);
  });

  it("accepts a scan large enough to sit on a signature line", async () => {
    const ok = await (await import("sharp")).default({
      create: { width: 80, height: 48, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    expect(await isUsableSignatureImage({ bytes: ok, mime: "image/png" })).toBe(true);
  });
});

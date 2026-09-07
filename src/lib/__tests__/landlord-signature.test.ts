import { describe, it, expect } from "vitest";
import { pickRandomFromPool } from "@/lib/bill-generator/umobile-modem";
import { signatureMime } from "@/lib/bill-generator/landlord-signature";

describe("empty signature pool", () => {
  it("picks nothing from an empty list — generate must not hard-fail", () => {
    expect(pickRandomFromPool([])).toBeNull();
  });

  it("accepts only png and jpeg", () => {
    expect(signatureMime("image/png")).toBe("image/png");
    expect(signatureMime("image/jpeg")).toBe("image/jpeg");
    expect(signatureMime("image/webp")).toBeNull();
  });
});

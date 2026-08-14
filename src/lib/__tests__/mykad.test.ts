import { describe, it, expect } from "vitest";
import { formatMykad, isCompleteMykad, isValidEmail, parseMykad } from "@/lib/mykad";

describe("formatMykad", () => {
  it("formats a complete MyKad as XXXXXX-XX-XXXX", () => {
    expect(formatMykad("970815125312")).toBe("970815-12-5312");
  });

  it("formats progressively while typing", () => {
    expect(formatMykad("9708")).toBe("9708");
    expect(formatMykad("970815")).toBe("970815");
    expect(formatMykad("9708151")).toBe("970815-1");
    expect(formatMykad("97081512")).toBe("970815-12");
    expect(formatMykad("970815125")).toBe("970815-12-5");
  });

  it("strips existing dashes and any other punctuation", () => {
    expect(formatMykad("970815-12-5312")).toBe("970815-12-5312");
    expect(formatMykad("970815 12 5312")).toBe("970815-12-5312");
  });

  it("caps at 12 digits", () => {
    expect(formatMykad("9708151253129999")).toBe("970815-12-5312");
  });

  it("handles empty input", () => {
    expect(formatMykad("")).toBe("");
  });
});

describe("isCompleteMykad", () => {
  it("accepts 12 digits, raw or formatted", () => {
    expect(isCompleteMykad("970815125312")).toBe(true);
    expect(isCompleteMykad("970815-12-5312")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCompleteMykad("97081512531")).toBe(false);
    expect(isCompleteMykad("")).toBe(false);
  });

  it("agrees with parseMykad on a real ID", () => {
    expect(isCompleteMykad("970815125312")).toBe(true);
    expect(parseMykad("970815-12-5312")).not.toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("name@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects an empty address (email is required)", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
  });

  it("rejects the shapes the loose x@y.z check let through", () => {
    expect(isValidEmail("name@@example.com")).toBe(false);
    expect(isValidEmail("name@example..com")).toBe(false);
    expect(isValidEmail("name@example")).toBe(false); // no TLD
    expect(isValidEmail("name@example.c")).toBe(false); // 1-char TLD
    expect(isValidEmail(".name@example.com")).toBe(false);
    expect(isValidEmail("name.@example.com")).toBe(false);
    expect(isValidEmail("name@-example.com")).toBe(false);
    expect(isValidEmail("na me@example.com")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
  });
});

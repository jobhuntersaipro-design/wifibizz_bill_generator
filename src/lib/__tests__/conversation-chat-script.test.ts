import { describe, expect, it } from "vitest";
import { buildConversationChatScript, formatMobileRaw } from "../chat-script";

const BIZ_CASE = {
  full_name: "MONBLEU CAFE(JM0920662-D)",
  mobile: "+60123456789",
  id_no: "981020016087",
  email: "cafe@example.com",
  full_address: "1 JALAN CAFE",
  package: "Unifi Business Exclusive 300M (MESH6) RM139",
  case_created_at: "2026-06-01T12:00:00",
};

describe("buildConversationChatScript", () => {
  it("stays on the residential path for a Unifi Business case", () => {
    const script = buildConversationChatScript(BIZ_CASE, 3);
    const text = [
      script.heading,
      ...script.lines.map((l) => l.label + l.value),
      ...script.terms,
      script.consent,
      script.agreement,
    ].join("\n");

    expect(script.heading).toBe("UNIFI");
    expect(script.agreement).toBe("YES I AGREED");
    expect(text).toContain("Customer IC/Passport No.");
    expect(text).toContain("981020016087");
    expect(text).toContain("unifi.com.my/personal/home/fibre-broadband/tnc");
    expect(text).not.toContain("Customer ID ( i.e BRN)");
    expect(text).not.toContain("Business Owner Name");
    expect(text).not.toContain("biz.unifi.com.my");
    expect(text).not.toContain("SAME AS ABOVE");
    expect(text).not.toContain("i agreed");
  });

  it("prints the golden 02634395 name with a real apostrophe", () => {
    const script = buildConversationChatScript(
      {
        ...BIZ_CASE,
        full_name: "SITI AYESAH BINTI YA&#039;ASAK",
      },
      3,
    );
    const name = script.lines.find((l) => l.label.includes("Customer Name"))?.value;
    expect(name).toBe("SITI AYESAH BINTI YA'ASAK");
    expect(name).not.toContain("&#039;");
    expect(name).not.toContain("&quot;");
  });
});

describe("the phone number is the same however it arrived", () => {
  // The reported bug: a chat generated from an Order Entry draft and one
  // generated from the same customer's case printed different phone numbers.
  // The two callers pass different shapes — the Case List passes the portal's
  // `+60137089093`, Order Entry concatenates its prefix and number fields — so
  // the formatter has to canonicalise rather than merely strip punctuation.
  const shapes = [
    ["+60137089093", "the portal's stored form (Case List)"],
    ["60137089093", "prefix + number concatenated (Order Entry)"],
    ["0137089093", "as an agent types it locally"],
    ["137089093", "bare national digits"],
    ["+60 13-708 9093", "already formatted"],
  ] as const;

  for (const [input, why] of shapes) {
    it(`prints +60 13-708 9093 for ${why}`, () => {
      expect(formatMobileRaw(input)).toBe("+60 13-708 9093");
    });
  }

  it("groups a 10-digit mobile too", () => {
    expect(formatMobileRaw("+601112345678")).toBe("+60 11-1234 5678");
  });

  it("leaves a non-Malaysian number alone rather than stamping +60 on it", () => {
    // Guessing a country code onto a foreign number is worse than not grouping
    // it — the same rule formatPhone follows for a length it cannot place.
    expect(formatMobileRaw("+6591234567")).toBe("6591234567");
  });

  it("still prints a dash for nothing", () => {
    expect(formatMobileRaw(null)).toBe("\u2014");
    expect(formatMobileRaw(" + ")).toBe("\u2014");
  });
});

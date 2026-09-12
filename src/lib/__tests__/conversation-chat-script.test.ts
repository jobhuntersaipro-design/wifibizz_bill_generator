import { describe, expect, it } from "vitest";
import { buildConversationChatScript } from "../chat-script";

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
});

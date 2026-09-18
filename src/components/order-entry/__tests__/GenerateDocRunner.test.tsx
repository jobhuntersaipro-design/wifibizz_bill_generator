import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GenerateDocRunner, { type GenerateDocSource } from "../GenerateDocRunner";
import { SERVER_DOC_TYPES, type GeneratedDocType } from "@/lib/order-documents";

// The upload action drags in auth, Prisma and R2. Static rendering never reaches it.
vi.mock("@/actions/order", () => ({ uploadOrderDocument: vi.fn() }));

const SOURCE: GenerateDocSource = {
  fullName: "PHONG KONE LEE",
  idNumber: "920505034434",
  fullAddress: "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
  mobile: "+60148893212",
  offerName: "Unifi Biz 100Mbps + Router",
  idType: "mykad",
  email: "phong@example.com",
  serviceCategory: "Unifi Business Premium",
};

function markup(type: GeneratedDocType): string {
  return renderToStaticMarkup(
    <GenerateDocRunner type={type} source={SOURCE} existingOfType={0} onDone={() => {}} />,
  );
}

// A script line renders as adjacent spans, so compare the text the chat shows.
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
}

describe("GenerateDocRunner", () => {
  it("mounts the off-screen chat for the chat types and nothing for the PDFs", () => {
    for (const type of SERVER_DOC_TYPES) expect(markup(type)).toBe("");
    expect(textOf(markup("chat"))).toContain("Terms & Conditions:");
    expect(textOf(markup("bizz_chat"))).toContain("Terms & Conditions:");
  });

  it("photographs the Conversation Chat closing script for `chat`", () => {
    const text = textOf(markup("chat"));
    expect(text).toContain(
      "By replying \u201CYES\u201D , I hereby acknowledge, confirm and agree to the following.",
    );
    expect(text).toContain("YES I AGREED");
    expect(text).not.toContain("SAME AS ABOVE");
    expect(text).not.toContain("i agreed");
  });

  it("photographs the Bizz Chat closing script for `bizz_chat`", () => {
    const text = textOf(markup("bizz_chat"));
    expect(text).toContain("Customer Name (as per NRIC/Passport) : PHONG KONE LEE");
    expect(text).toContain("Contact Number : 60148893212");
    expect(text).not.toContain("Customer ID ( i.e BRN): 920505034434");
    // The Business Owner is invented and seeded on the case, so it is never the
    // customer's own name — and it is the same person the Biz Auth Letter names.
    expect(text).toMatch(/Business Owner Name: [A-Z]+ [A-Z]+ (BIN|BINTI) [A-Z]+/);
    expect(text).not.toContain("Business Owner Name: PHONG KONE LEE");
    expect(text).toContain("Billing Address : SAME AS ABOVE");
    expect(text).toContain("Package to be subscribed : Unifi Biz 100Mbps");
    expect(text).toContain("Representative Name ( if any) : -");
    expect(text).toContain("i agreed");
    expect(text).not.toContain("By replying");
    expect(text).not.toContain("YES I AGREED");
    expect(text).not.toContain(
      "I hereby agree all the information provided to TM is correct and genuine.",
    );
  });

  it("keeps Conversation Chat on the residential path even when the offer is Business", () => {
    const text = textOf(markup("chat"));
    expect(text).toContain("UNIFI");
    expect(text).toContain("Customer IC/Passport No.");
    expect(text).not.toContain("Customer ID ( i.e BRN)");
    expect(text).not.toContain("Business Owner Name");
    expect(text).not.toContain("biz.unifi.com.my");
  });
});

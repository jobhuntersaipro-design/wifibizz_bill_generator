import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GenerateDocRunner, { type GenerateDocSource } from "../GenerateDocRunner";
import { WhatsAppChat } from "@/components/dashboard/ChatImageGenerator";
import { GENERATED_DOCS } from "@/lib/order-documents";
import type { CaseRow } from "@/components/dashboard/shared";

// The actions drag in auth, Prisma and R2. Static rendering never reaches them.
vi.mock("@/actions/order", () => ({ uploadOrderDocument: vi.fn() }));
vi.mock("@/lib/monthly-fee-prompt", () => ({ resolveMonthlyFee: vi.fn(), FEE_CANCELLED: "" }));

const SOURCE: GenerateDocSource = {
  fullName: "PHONG KONE LEE",
  idNumber: "920505034434",
  fullAddress: "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
  mobile: "+60148893212",
  offerName: "Unifi Biz 100Mbps (24M)",
  idType: "mykad",
  email: "phong@example.com",
  serviceCategory: "Unifi Business Premium",
};

const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

describe("GenerateDocRunner", () => {
  it("renders nothing until the chat's monthly fee is known", () => {
    for (const { type } of GENERATED_DOCS) {
      expect(
        renderToStaticMarkup(<GenerateDocRunner type={type} source={SOURCE} existingOfType={0} onDone={() => {}} />),
      ).toBe("");
    }
  });
});

describe("WhatsAppChat", () => {
  it("prints the TM consent template and the customer's reply", () => {
    const caseData = {
      case_no: "1", case_url: null, full_name: SOURCE.fullName, full_address: SOURCE.fullAddress,
      mobile: SOURCE.mobile, email: SOURCE.email, id_no: SOURCE.idNumber, provider: null,
      package: SOURCE.offerName, order_no: null, agent: null, agent_remark: null, status: null,
      internet_bill_url: null, utility_bill_url: null, case_created_at: null, updated_at: null,
      preferred_install_date: "2026-12-01",
    } as CaseRow & { preferred_install_date: string };
    const text = textOf(
      renderToStaticMarkup(
        <WhatsAppChat caseData={caseData} wallpaper="#000" time="10:00 AM" unreadCount={1} monthlyFee="139.00" />,
      ),
    );
    expect(text).toContain("1.\tCustomer Name (as per NRIC/Passport/BRN) : PHONG KONE LEE");
    expect(text).toContain("9.\tMonthly Subscription Fee : RM139");
    expect(text).toContain("11.\tPreferred Installation Date (if applicable) : 01/12/2026");
    expect(text).toContain("contract period of 24 months");
    expect(text).toContain("As a Business Customer representative");
    expect(text).toContain("YES I AGREED");
    expect(text).not.toContain("UNIFI\n");
    expect(text).not.toContain("By replying");
  });
});

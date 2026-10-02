import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, buildPdf, usageCreate, fillMissing } = vi.hoisted(() => ({
  rows: [
  { case_no: "202677632", full_name: "TEST", full_address: "", mobile: "+601812312", case_url: "https://wifibizz.com/applications/219706?module=home_fibre", provider: "TIME FTTH", package: "TIME Fibre 200Mbps", internet_bill_url: null, utility_bill_url: null },
  { case_no: "202677481", full_name: "NURUL", full_address: "A-3-16 JALAN SAGA 10, 68000 AMPANG, SELANGOR", mobile: "+60108098", case_url: "https://wifibizz.com/applications/1?module=home_fibre", provider: "Unifi", package: "Unifi Home", internet_bill_url: null, utility_bill_url: null },
  ],
  buildPdf: vi.fn(async () => Buffer.from("%PDF")),
  usageCreate: vi.fn<(arg: unknown) => Promise<object>>(async () => ({})),
  fillMissing: vi.fn(async () => ({})), // the scrape finds nothing
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    wifibizzUser: { findUnique: async () => ({ id: 7, wifibizzEmail: "a@b.c", wifibizzPasswordEnc: "x", lastCrawlAt: null, googleSheetId: null }) },
    caseUsageLog: { create: usageCreate },
  },
}));
vi.mock("@neondatabase/serverless", () => ({ neon: () => async () => rows }));
vi.mock("@/lib/case-limit", () => ({ getUserCaseUsage: async () => ({ casesUsed: 0, limit: 10, remaining: 10 }) }));
vi.mock("@/lib/crawler/lazy-address", () => ({ fillMissingAddresses: fillMissing }));
vi.mock("@/lib/bill-generator/umobile-modem", () => ({ buildInternetBillPdf: buildPdf }));
vi.mock("@/lib/bill-generator/utility-bill", () => ({ generateUtilityBill: buildPdf }));
vi.mock("@/lib/persist-bill", () => ({ persistBillPdf: async () => ({ publicUrl: "https://r2/x.pdf" }) }));

import { POST } from "../route";
import { NO_ADDRESS_ERROR } from "@/lib/address-required";

describe("POST /api/bills/generate — address required", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a case still without an address after the scrape: no PDF, no credit", async () => {
    const res = await POST(new Request("http://x/api/bills/generate", {
      method: "POST",
      body: JSON.stringify({ caseNos: ["202677632", "202677481"], type: "internet" }),
    }));
    const body = await res.json();
    const byCase = Object.fromEntries(body.results.map((r: { caseNo: string }) => [r.caseNo, r]));

    expect(fillMissing).toHaveBeenCalled(); // scraped first
    expect(byCase["202677632"]).toMatchObject({ status: "error", error: NO_ADDRESS_ERROR });
    expect(byCase["202677481"]).toMatchObject({ status: "success" });
    expect(buildPdf).toHaveBeenCalledTimes(1);
    expect(usageCreate).toHaveBeenCalledTimes(1);
    expect(usageCreate.mock.calls[0]).toEqual([expect.objectContaining({ data: expect.objectContaining({ caseNo: "202677481" }) })]);
  });
});

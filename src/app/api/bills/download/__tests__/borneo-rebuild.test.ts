import { describe, it, expect, vi, beforeEach } from "vitest";

const { row, utility, r2Bytes } = vi.hoisted(() => ({
  row: { internet_bill_url: null, utility_bill_url: "https://r2/bills/7/1/utility_bill.pdf", order_no: null, full_name: "ALI", full_address: "", mobile: "", case_url: "", provider: "", package: "" },
  utility: vi.fn(async () => new Uint8Array([1, 2, 3])),
  r2Bytes: vi.fn(async () => new Uint8Array([9])),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { wifibizzUser: { findUnique: async () => ({ id: 7 }) } } }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => async () => [row] }));
vi.mock("@/lib/bill-generator/utility-bill", () => ({ generateUtilityBill: utility }));
vi.mock("@/lib/bill-generator/umobile-modem", () => ({ buildInternetBillPdf: vi.fn() }));
vi.mock("@/lib/persist-bill", () => ({ persistBillPdf: async () => ({ key: "bills/7/1/utility_bill.pdf" }) }));
vi.mock("@/lib/r2", () => ({ getBytesFromR2: r2Bytes }));
vi.mock("@/lib/bill-object", () => ({ r2KeyFromPublicUrl: () => "bills/7/1/utility_bill.pdf" }));

import { GET } from "../route";

const get = (q = "") => GET(new Request(`http://x/api/bills/download?case_no=1&type=utility${q}`));

describe("GET /api/bills/download — utility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebuilds a Sabah/Sarawak bill instead of serving the stored (TNB) one", async () => {
    row.full_address = "A-2-2 LORONG MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450";
    const res = await get();
    expect(utility).toHaveBeenCalledTimes(1);
    expect(r2Bytes).not.toHaveBeenCalled();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("serves the stored bill for the peninsula and for the preview iframe", async () => {
    row.full_address = "NO 3, JALAN CEMPEDAK, 42700 BANTING, SELANGOR";
    await get();
    row.full_address = "LT 3281, 93250 KUCHING, SARAWAK";
    await get("&preview=1");
    expect(utility).not.toHaveBeenCalled();
    expect(r2Bytes).toHaveBeenCalledTimes(2);
  });
});

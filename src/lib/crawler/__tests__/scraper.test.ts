import { describe, it, expect } from "vitest";
import { extractCases } from "../scraper";

const BASE_URL = "https://wifibizz.com";

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prefix_with_no: '<a href="/applications/42?module=home_fibre&amp;application_no=202624115">202624115</a>',
    customer_name: "MUHAMMAD SAHINU BIN INSANU",
    customer_full_mobile_no: "+60137089093",
    customer_email: "test@gmail.com",
    customer_id_no: "970815125312",
    operator_name: "Unifi Premium Value",
    application_item: { item_name: "Unifi Home 500Mbps" },
    application_detail: { order_no: "2603000102554652" },
    agent_name: "AI CHAT BOT",
    agent_staff_id: "ACE999",
    agent_remark: "LATLONG 4.4445276,118.633106",
    status: '<span class="badge badge-success">Activated</span>',
    created_at: "2026-03-28 02:58:37",
    ...overrides,
  };
}

describe("extractCases", () => {
  it("extracts case_no from HTML anchor tag", () => {
    const result = extractCases([makeRecord()], BASE_URL);
    expect(result[0].case_no).toBe("202624115");
  });

  it("extracts case_url from href attribute and decodes &amp;", () => {
    const result = extractCases([makeRecord()], BASE_URL);
    expect(result[0].case_url).toBe(
      "https://wifibizz.com/applications/42?module=home_fibre&application_no=202624115"
    );
  });

  it("handles prefix_with_no without anchor tag", () => {
    const result = extractCases(
      [makeRecord({ prefix_with_no: "202624115" })],
      BASE_URL
    );
    expect(result[0].case_no).toBe("202624115");
    expect(result[0].case_url).toBe("");
  });

  it("maps all fields correctly", () => {
    const result = extractCases([makeRecord()], BASE_URL);
    const c = result[0];
    expect(c.full_name).toBe("MUHAMMAD SAHINU BIN INSANU");
    expect(c.mobile).toBe("+60137089093");
    expect(c.email).toBe("test@gmail.com");
    expect(c.id_no).toBe("970815125312");
    expect(c.provider).toBe("Unifi Premium Value");
    expect(c.package).toBe("Unifi Home 500Mbps");
    expect(c.order_no).toBe("2603000102554652");
    expect(c.agent_remark).toBe("LATLONG 4.4445276,118.633106");
    expect(c.case_created_at).toBe("2026-03-28 02:58:37");
  });

  it("formats agent with staff ID", () => {
    const result = extractCases([makeRecord()], BASE_URL);
    expect(result[0].agent).toBe("AI CHAT BOT (ACE999)");
  });

  it("formats agent without staff ID", () => {
    const result = extractCases(
      [makeRecord({ agent_staff_id: "" })],
      BASE_URL
    );
    expect(result[0].agent).toBe("AI CHAT BOT");
  });

  it("extracts status text from HTML span tags", () => {
    const records = [
      makeRecord({ status: '<span class="badge badge-success">Activated</span>' }),
      makeRecord({ status: '<span class="badge badge-danger">Rejected</span>', prefix_with_no: "202624116" }),
      makeRecord({ status: '<span class="badge badge-warning">Pending</span>', prefix_with_no: "202624117" }),
      makeRecord({ status: '<span class="badge badge-info">Processed</span>', prefix_with_no: "202624118" }),
    ];
    const result = extractCases(records, BASE_URL);
    expect(result).toHaveLength(4);
    expect(result.map((c) => c.status)).toEqual([
      "Activated",
      "Rejected",
      "Pending",
      "Processed",
    ]);
  });

  it("handles missing optional fields with empty strings", () => {
    const result = extractCases(
      [makeRecord({ customer_name: undefined, customer_email: undefined })],
      BASE_URL
    );
    expect(result[0].full_name).toBe("");
    expect(result[0].email).toBe("");
  });

  it("handles empty records array", () => {
    const result = extractCases([], BASE_URL);
    expect(result).toEqual([]);
  });

  it("falls back to package field when application_item is missing", () => {
    const result = extractCases(
      [makeRecord({ application_item: {}, package: "Fallback Package" })],
      BASE_URL
    );
    expect(result[0].package).toBe("Fallback Package");
  });

  it("falls back to order_no field when application_detail is missing", () => {
    const result = extractCases(
      [makeRecord({ application_detail: {}, order_no: "FALLBACK123" })],
      BASE_URL
    );
    expect(result[0].order_no).toBe("FALLBACK123");
  });
});

import { describe, it, expect } from "vitest";
import { normalizeAddress } from "@/lib/bill-generator/address-normalizer";

// The Umobile bill draws exactly three address lines (addr1Y..addr3Y), 55 chars each.
const SLOTS = 3;
const MAX_CHARS = 55;

async function internetLines(address: string): Promise<string[]> {
  // No API key: geocoding must never be reached from a unit test.
  return (await normalizeAddress(address, "internet", "", MAX_CHARS, "")) as string[];
}

// Street from the reported bill. Its keyword split leaves "17" alone on line one, so the
// street alone took all three lines. The postcode/state tail here stands in for any tail.
const REPORTED = "17 LORONG SERI MAHKOTA AMAN 19 PERKAMPUNGAN SERI MAHKOTA AMAN 25200 KUANTAN PAHANG";

const CASES = [
  REPORTED,
  "NO 12 JALAN BUKIT INDAH 2/5 TAMAN BUKIT INDAH 81200 JOHOR BAHRU JOHOR",
  "LOT 3 KAMPUNG BARU 89000 KENINGAU SABAH",
  "S2D-12-6, JALAN PJU 8/1 DAMANSARA PERDANA 47820 PETALING JAYA SELANGOR",
  "S2D-12-6, JALAN PERSIARAN INDAH PERMAI 12 TAMAN SRI KEMBANGAN INDAH PERMAI JAYA UTAMA DESA MELATI 43300 SERI KEMBANGAN SELANGOR",
  "30 LALUAN PRISMA 4 METRO MAYA BATU GAJAH PERAK MALAYSIA 31000",
  "JALAN TEKNOKRAT 6 21 CYBERSQUARE TOWER 1 CYBER 5 63000 CYBERJAYA SELANGOR",
];

describe("Umobile bill address layout", () => {
  for (const address of CASES) {
    it(`keeps postcode and state on the last line: ${address}`, async () => {
      const lines = await internetLines(address);
      expect(lines.length).toBeLessThanOrEqual(SLOTS);
      const last = lines[lines.length - 1];
      expect(last).toMatch(/\b\d{5}\b/);
      expect(last).toMatch(/MALAYSIA$/);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_CHARS);
    });
  }

  it("regression: the reported street no longer pushes the postcode line off the bill", async () => {
    const lines = await internetLines(REPORTED);
    expect(lines).toEqual([
      "17 LORONG SERI MAHKOTA AMAN 19 PERKAMPUNGAN SERI",
      "MAHKOTA AMAN",
      "25200 KUANTAN PAHANG MALAYSIA",
    ]);
  });

  it("leaves a short address on its keyword split", async () => {
    expect(await internetLines("LOT 3 KAMPUNG BARU 89000 KENINGAU SABAH")).toEqual([
      "LOT 3 KAMPUNG BARU",
      "89000 KENINGAU SABAH MALAYSIA",
    ]);
  });
});

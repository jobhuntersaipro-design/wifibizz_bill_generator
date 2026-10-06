import { describe, it, expect } from "vitest";
import { normalizeAddress } from "@/lib/bill-generator/address-normalizer";
import { auditBillAddress } from "@/lib/bill-generator/address-audit";

// The Umobile bill draws four address lines (addr1Y..addr4Y), 55 chars each.
const SLOTS = 4;
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

  it("keeps a multi-word town whole when the postcode comes last (real portal shapes)", async () => {
    const gelang = await internetLines(
      "SRB4-A-616 JALAN FOREST CITY 13 - ATARAXIA PARK 4 LAMAN DAMAI EMPAT, PULAU SATU GELANG PATAH JOHOR MALAYSIA 81500",
    );
    expect(gelang[gelang.length - 1]).toBe("81500 GELANG PATAH JOHOR MALAYSIA");
    expect(gelang.join(" ")).not.toMatch(/GELANG\s*$/m);

    const shahAlam = await internetLines(
      "5 JALAN ANGGERIK ERIA 31/103A KOTA KEMUNING SEKSYEN 31 SHAH ALAM SELANGOR MALAYSIA 40460",
    );
    expect(shahAlam[shahAlam.length - 1]).toBe("40460 SHAH ALAM SELANGOR MALAYSIA");
  });

  it("falls back to the last word when the town is not in the postcode table", async () => {
    const lines = await internetLines("LOT 3 KAMPUNG BARU TELUPID SABAH MALAYSIA 89300");
    expect(lines[lines.length - 1]).toMatch(/^89300 \S+ SABAH MALAYSIA$/);
  });
});

describe("Umobile bill keeps every address token (ClickUp z8v9xngra2)", () => {
  const GOLDEN = "2-T.12-U.01 FTTH BLOK B2 APARTMENT 5R6 JALAN P5 A PRESINT 5 62200 PUTRAJAYA WILAYAH PERSEKUTUAN PUTRAJAYA";

  it("golden: the unit keeps its 01 and BLOK survives the FTTH marker", async () => {
    expect(await internetLines(GOLDEN)).toEqual([
      "2-T.12-U.01 BLOK B2 APARTMENT 5R6 JALAN P5 A PRESINT 5",
      "62200 PUTRAJAYA WP PUTRAJAYA MALAYSIA",
    ]);
  });

  it("drops only the word FTTH, not the number before it or the word after it", async () => {
    const lines = await internetLines(
      "M9-4-07 JALAN TUN PERAK 1 4 FTTH BLOK M9 WIRA APARTMENT TAMAN TUN PERAK CHERAS SELANGOR MALAYSIA 43200",
    );
    expect(lines.join(" ")).toContain("1 4 BLOK M9 WIRA APARTMENT");
    expect(lines.join(" ")).not.toMatch(/FTTH/);
  });

  it("keeps the floor number printed after a condo unit", async () => {
    const lines = await internetLines(
      "QRS-02-07 2 BLOK QRS PANGSAPURI MELODI PERDANA JALAN PERDANA 1 LBS ALAM PERDANA 42300 BANDAR PUNCAK ALAM SELANGOR",
    );
    expect(lines[0]).toMatch(/^QRS-02-07 2 BLOK QRS/);
  });

  it("takes the state from the end, so a state name in the street stays on the bill", async () => {
    expect((await internetLines("NO 12 JALAN BUKIT INDAH 2/5 TAMAN BUKIT INDAH 81200 JOHOR BAHRU JOHOR")).at(-1)).toBe(
      "81200 JOHOR BAHRU JOHOR MALAYSIA",
    );
    const cityWalk = await internetLines(
      "Lot ZZ, Kuala Lumpur City Walk (KLCW), Lot 20005 dan Lot 1383, Seksyen 57, Jalan P. Ramlee/Jalan Pinang, 50450 Kuala Lumpur.",
    );
    expect(cityWalk.join(" ")).toContain("LOT ZZ KUALA LUMPUR CITY WALK");
  });

  it("prints a long street on four lines instead of cutting it", async () => {
    const source =
      "B-99-01 META CITY - TOWER B SERVICED APARTMENT, Pusat Perniagaan Metacity Jalan Atmosphere Utama 2 Bandar Putra Permai Seri Kembangan Selangor";
    const lines = await internetLines(source);
    expect(lines.length).toBeLessThanOrEqual(SLOTS);
    expect(auditBillAddress(source, lines)).toEqual({ pass: true, missing: [] });
  });

  it("drops a pasted order reference without touching the street", async () => {
    const lines = await internetLines(
      "99-G G JALAN J-AVENUE CHERAS SELATAN 43200 CHERAS SELANGOR MALAYSIA N:20260101:1300000000000:EAI000000000000000",
    );
    expect(lines).toEqual(["99-G G JALAN J-AVENUE CHERAS SELATAN", "43200 CHERAS SELANGOR MALAYSIA"]);
  });

  it("folds a full-width comma so the unit and the building stay separate", async () => {
    const source =
      "B-12-03A\uFF0CTHE REGINA, Jalan Subang Permai, TAMAN SUBANG PERMAI, SUBANG JAYA, Selangor, 47500, Malaysia";
    const lines = await internetLines(source);
    const text = lines.join(" ");
    expect(text).not.toContain("\uFF0C");
    expect(text).not.toContain("03ATHE");
    expect(text).toContain("B-12-03A");
    expect(text).toContain("THE REGINA");
    expect(auditBillAddress(source, lines)).toEqual({ pass: true, missing: [] });
  });

  it("does not print the state twice when it carries its honorific", async () => {
    const lines = await internetLines("No 99, Jalan Mutiara Emas 3/1, Taman Mount Austin, 81100 Johor Bahru, Johor Darul Ta'zim");
    expect(lines.at(-1)).toBe("81100 JOHOR BAHRU JOHOR MALAYSIA");
  });
});

describe("auditBillAddress", () => {
  it("fails the reported bill and names what it lost", () => {
    const audit = auditBillAddress(
      "2-T.12-U.01 FTTH BLOK B2 APARTMENT 5R6 JALAN P5 A PRESINT 5 62200 PUTRAJAYA WILAYAH PERSEKUTUAN PUTRAJAYA",
      ["2-T.12-U. B2 APARTMENT 5R6 JALAN P5 A PRESINT 5", "62200 PUTRAJAYA WP PUTRAJAYA MALAYSIA"],
    );
    expect(audit).toEqual({ pass: false, missing: ["2-T.12-U.01", "BLOK"] });
  });

  it("accepts the listed normalisations and nothing else", () => {
    const source = "UNIT 1 FLOOR 6 FTTH WISMA, 50300 KUALA LUMPUR W.P. KUALA LUMPUR MALAYSIA";
    expect(auditBillAddress(source, ["UNIT 1 FLOOR 6 WISMA", "50300 KUALA LUMPUR WP KUALA LUMPUR MALAYSIA"]).pass).toBe(true);
    expect(auditBillAddress(source, ["UNIT 1 FLOOR WISMA", "50300 KUALA LUMPUR WP KUALA LUMPUR MALAYSIA"]).missing).toEqual(["6"]);
  });

  it("finds a plain token only as a token, never inside a longer one", () => {
    expect(auditBillAddress("U.01 01 JALAN X", ["U.01 JALAN X"]).missing).toEqual(["01"]);
    expect(auditBillAddress("08320 SIK.KEDAH", ["08320 SIK KEDAH MALAYSIA"]).pass).toBe(true);
  });
});


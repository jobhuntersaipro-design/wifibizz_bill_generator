import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  billDateFor,
  borneoState,
  generateBorneoBill,
  sesbCharges,
  sesbFields,
  sescoCharges,
  sescoFields,
} from "@/lib/bill-generator/borneo-electric-bill";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe("borneoState", () => {
  it("routes by postcode, falls back to the state name, leaves Labuan and the peninsula alone", () => {
    expect(borneoState("A-2-2 LORONG MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450")).toBe("Sabah");
    expect(borneoState("LT 3281, 581 LRG 17A JLN DESA WIRA, 93250 KUCHING, SARAWAK")).toBe("Sarawak");
    // A street named after the other state does not win over the postcode.
    expect(borneoState("NO 1, JALAN SABAH, 93250 KUCHING")).toBe("Sarawak");
    expect(borneoState("KAMPUNG BARU, MIRI, SARAWAK")).toBe("Sarawak");
    expect(borneoState("JALAN MERDEKA, 87000 LABUAN")).toBeNull();
    expect(borneoState("NO 3, JALAN CEMPEDAK, 42700 BANTING, SELANGOR")).toBeNull();
    expect(borneoState("")).toBeNull();
  });
});

describe("billDateFor", () => {
  it("is the 1st of the month two months back, in Malaysia time", () => {
    expect(ymd(billDateFor(new Date("2026-10-15T04:00:00Z")))).toBe("2026-08-01");
    expect(ymd(billDateFor(new Date("2027-01-15T04:00:00Z")))).toBe("2026-11-01");
    expect(ymd(billDateFor(new Date("2026-03-31T04:00:00Z")))).toBe("2026-01-01");
    // 1 Nov 01:00 MYT is still 31 Oct in UTC.
    expect(ymd(billDateFor(new Date("2026-10-31T17:00:00Z")))).toBe("2026-09-01");
  });
});

describe("generated figures", () => {
  const now = new Date("2026-10-15T04:00:00Z");

  it("SESB: readings, tiers and KWTBB add up; total and dates in range", () => {
    for (let i = 0; i < 500; i++) {
      const f = sesbFields(now);
      expect(f.curReading - f.prevReading).toBe(f.units);
      expect(f.units).toBeGreaterThanOrEqual(250);
      expect(f.units).toBeLessThanOrEqual(600);
      expect(f.tiers.reduce((s, t) => s + t.units, 0)).toBe(f.units);
      expect(f.tiers.reduce((s, t) => s + t.sen, 0)).toBe(f.energySen);
      expect(f.energySen + f.kwtbbSen).toBe(f.totalSen);
      expect(f.totalSen).toBeGreaterThanOrEqual(8000);
      expect(f.totalSen).toBeLessThanOrEqual(35000);
      expect(f.prevBillSen).toBeLessThan(f.totalSen * 1.5);
      expect(f.lastPayDate < f.billDate && f.dueDate > f.billDate).toBe(true);
    }
  });

  it("SESCO: line items sum to the total; overdue under 1.5x; total and dates in range", () => {
    for (let i = 0; i < 500; i++) {
      const f = sescoFields(now);
      expect(f.curReading - f.prevReading).toBe(f.units);
      expect(f.units).toBeGreaterThanOrEqual(250);
      expect(f.units).toBeLessThanOrEqual(600);
      expect(f.firstSen + f.excessSen + f.taxSen + f.discountSen + f.roundingSen).toBe(f.currentSen);
      expect(f.currentSen % 5).toBe(0);
      expect(f.currentSen + f.overdueSen).toBe(f.totalSen);
      expect(f.overdueSen).toBeLessThan(f.currentSen * 1.5);
      expect(f.totalSen).toBeGreaterThanOrEqual(10000);
      expect(f.totalSen).toBeLessThanOrEqual(45000);
      expect((f.periodEnd.getTime() - f.periodStart.getTime()) / 86_400_000).toBe(29);
      expect(f.lastPayDate < f.billDate && f.dueDate > f.billDate && f.periodEnd < f.billDate).toBe(true);
    }
  });

  it("reproduces both samples' own charges from their units", () => {
    // SESB 393 kWh: 44.04 + 37.76 + 45.81 = 127.61, KWTBB 2.04, total 129.65
    const b = sesbCharges(393);
    expect([...b.tiers.map((t) => t.sen), b.energySen, b.kwtbbSen, b.totalSen]).toEqual([4404, 3776, 4581, 12761, 204, 12965]);
    // SESCO 865 kWh: 186.00 + 82.15 + 6.57 tax - 67.04 discount + 0.02 rounding = 207.70
    const c = sescoCharges(865, 0);
    expect([c.firstSen, c.excessSen, c.taxSen, c.discountSen, c.roundingSen, c.currentSen]).toEqual([18600, 8215, 657, -6704, 2, 20770]);
  });

  it("ten bills for one order differ", () => {
    const sesb = new Set(Array.from({ length: 10 }, () => JSON.stringify(sesbFields(now))));
    const sesco = new Set(Array.from({ length: 10 }, () => JSON.stringify(sescoFields(now))));
    expect(sesb.size).toBe(10);
    expect(sesco.size).toBe(10);
  });
});

describe("generateBorneoBill", () => {
  const longCase = {
    case_no: "1",
    full_name: "MUHAMMAD AMIRUL HAKIM BIN MOHD SHAHRUL NIZAM AL-HAFIZ ABDULLAH",
    mobile: "",
    case_url: "",
    provider: "",
    package: "",
  };

  it.each([
    ["Sabah", "LOT 12, BLOK B, TAMAN PERUMAHAN SRI KEPAYAN INDAH FASA 3, JALAN PENAMPANG BYPASS KM 5, 88300 KOTA KINABALU, SABAH"],
    ["Sarawak", "NO 1234, LORONG 7A2, JALAN TUN AHMAD ZAIDI ADRUCE, TAMAN SRI PERMAI INDAH FASA 2, 93150 KUCHING SARAWAK"],
  ] as const)("renders a one-page %s bill for a long name and address", async (state, full_address) => {
    // Throws if any template run it edits is missing, so a changed template fails here.
    const pdf = await generateBorneoBill(state, { ...longCase, full_address });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});

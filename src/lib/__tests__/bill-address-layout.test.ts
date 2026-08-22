import { describe, it, expect } from "vitest";
import { measureText, fitRepeatCount } from "@/lib/bill-generator/font-metrics";
import {
  normalizeAddress,
  type UtilityAddressResult,
  type UtilityLayout,
} from "@/lib/bill-generator/address-normalizer";

// The real template geometry: ALAMAT POS knock-out box is 180pt from x=34 with text at
// x=36; ALAMAT PREMIS is 152pt. Both pages draw exactly 5 lines.
const LAYOUT: UtilityLayout = {
  alamatPos: { widthPt: 178, slots: 5, fontSize: 8, addrFont: "/F0301", nameFont: "/F0201" },
  alamatPremis: { widthPt: 150, slots: 5, fontSize: 8, addrFont: "/F0301", nameFont: "/F0201" },
};

async function layout(address: string, name: string): Promise<UtilityAddressResult> {
  return (await normalizeAddress(
    address,
    "utility",
    name,
    undefined,
    // No API key: geocoding must never be reached from a unit test.
    "",
    LAYOUT,
  )) as UtilityAddressResult;
}

const CASES: { label: string; address: string; name: string }[] = [
  {
    label: "condo, the address from the reported bill",
    address: "JALAN TEKNOKRAT 6 21 CYBERSQUARE TOWER 1 CYBER 5 63000 CYBERJAYA SELANGOR",
    name: "MUHAMMAD SAHINU BIN INSANU",
  },
  {
    label: "landed, long name",
    address: "NO 12 JALAN BUKIT INDAH 2/5 TAMAN BUKIT INDAH 81200 JOHOR BAHRU JOHOR",
    name: "SITI NURHALIZA BINTI ABDULLAH RAHMAN",
  },
  { label: "short name", address: "LOT 3 KAMPUNG BARU 89000 KENINGAU SABAH", name: "LEE" },
  {
    label: "unit prefix",
    address: "S2D-12-6, JALAN PJU 8/1 DAMANSARA PERDANA 47820 PETALING JAYA SELANGOR",
    name: "NURUL AIN BINTI MOHD ZAKARIA ABDULLAH",
  },
  {
    label: "very long street with no keyword to break on",
    address:
      "PANGSAPURI SRI KEMBANGANMEWAHINDAHPERMAI 43300 SERI KEMBANGAN SELANGOR",
    name: "A",
  },
];

describe("utility bill address layout", () => {
  for (const { label, address, name } of CASES) {
    describe(label, () => {
      it("never draws a line wider than its knock-out box", async () => {
        const r = await layout(address, name);
        for (const [i, line] of r.alamat_pos.entries()) {
          const font = i === 0 ? "/F0201" : "/F0301";
          expect(measureText(line, font, 8)).toBeLessThanOrEqual(LAYOUT.alamatPos.widthPt);
        }
        for (const line of r.alamat_premis) {
          expect(measureText(line, "/F0301", 8)).toBeLessThanOrEqual(LAYOUT.alamatPremis.widthPt);
        }
      });

      it("fits the slots the page actually draws, so nothing is dropped in silence", async () => {
        const r = await layout(address, name);
        expect(r.alamat_pos.length).toBeLessThanOrEqual(LAYOUT.alamatPos.slots);
        expect(r.alamat_premis.length).toBeLessThanOrEqual(LAYOUT.alamatPremis.slots);
      });

      it("keeps postcode, city and state on the last line", async () => {
        const r = await layout(address, name);
        const { postal_code, locality, state } = r.components;
        for (const lines of [r.alamat_pos, r.alamat_premis]) {
          const last = lines[lines.length - 1];
          if (postal_code) expect(last).toContain(postal_code);
          if (locality) expect(last).toContain(locality);
          if (state) expect(last).toContain(state);
        }
      });
    });
  }

  it("masks the name at a fixed width regardless of how long the real name is", async () => {
    const short = await layout(CASES[0].address, "LEE");
    const long = await layout(CASES[0].address, "X".repeat(80));
    expect(short.alamat_pos[0]).toBe(long.alamat_pos[0]);
    expect(short.alamat_pos[0]).toMatch(/^X+$/);
    expect(measureText(short.alamat_pos[0], "/F0201", 8)).toBeLessThanOrEqual(178);
  });

  it("regression: the state used to be produced and then discarded", async () => {
    // Six lines were generated for five slots and SELANGOR, pushed last, never reached the page.
    const r = await layout(CASES[0].address, CASES[0].name);
    expect(r.components.state).toBe("SELANGOR");
    expect(r.alamat_pos.join(" | ")).toContain("SELANGOR");
  });

  it("regression: a 36-character name overflowed the box by ~19pt", async () => {
    // 36 X's in Tahoma-Bold at 8pt measure 197.3pt against a 178pt box.
    expect(measureText("X".repeat(36), "/F0201", 8)).toBeGreaterThan(178);
    const r = await layout(CASES[1].address, CASES[1].name);
    expect(measureText(r.alamat_pos[0], "/F0201", 8)).toBeLessThanOrEqual(178);
  });
});

describe("font metrics", () => {
  it("uses the template's own advance widths", () => {
    // Tahoma-Bold 'X' is 685/1000 em and space is 293 — the gap that made character
    // counting an unsafe proxy for width.
    expect(measureText("X", "/F0201", 1000)).toBe(685);
    expect(measureText(" ", "/F0201", 1000)).toBe(293);
    expect(measureText("X", "/F0301", 1000)).toBe(581);
  });

  it("fits repeats without exceeding the budget", () => {
    const n = fitRepeatCount("X", "/F0201", 8, 178);
    expect(measureText("X".repeat(n), "/F0201", 8)).toBeLessThanOrEqual(178);
    expect(measureText("X".repeat(n + 1), "/F0201", 8)).toBeGreaterThan(178);
  });
});

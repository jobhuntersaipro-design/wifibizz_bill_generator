import { inflateSync } from "zlib";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { generateInternetBill, type CaseData } from "@/lib/bill-generator/internet-bill";
import { getPageStreamRefs } from "@/lib/bill-generator/pdf-utils";
import {
  generateUmobileMobile,
  umobileMobileDigitLength,
  umobileMobileStreamToken,
  umobileMobileSuffixLength,
} from "@/lib/bill-generator/umobile-mobile";

const GOLDEN =
  "2-T.12-U.01 FTTH BLOK B2 APARTMENT 5R6 JALAN P5 A PRESINT 5 62200 PUTRAJAYA WILAYAH PERSEKUTUAN PUTRAJAYA";

function randomDigitsFrom(rng: () => number): (count: number) => string {
  return (count) =>
    Array.from({ length: count }, () => String(Math.floor(rng() * 10))).join("");
}

/** Deterministic [0, 1) sequence so a sample table can be regenerated. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function streamText(stream: {
  dict: { get: (name: ReturnType<typeof PDFName.of>) => { toString(): string } | undefined };
  getContents: () => Uint8Array;
}): string {
  const bytes = Buffer.from(stream.getContents());
  const filter = stream.dict.get(PDFName.of("Filter"))?.toString() ?? "";
  const raw = filter.includes("FlateDecode") ? inflateSync(bytes) : bytes;
  return raw.toString("latin1");
}

async function printedMobile(pdf: Buffer): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    for (const entry of getPageStreamRefs(doc, page)) {
      const text = streamText(entry.stream);
        for (const match of text.matchAll(/544\.49 Tm[\s\S]{0,200}?\[\(([^)]*)\)\]/g)) {
        parts.push(match[1] ?? "");
      }
    }
  }
  return parts.join("").replace(/ /g, "");
}

async function billText(pdf: Buffer): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  return doc
    .getPages()
    .flatMap((page) => getPageStreamRefs(doc, page).map((entry) => streamText(entry.stream)))
    .join("\n");
}

function caseFor(kind: "home" | "business", mobile: string): CaseData {
  const business = kind === "business";
  return {
    case_no: "01881328706",
    full_name: business ? "MONBLEU CAFE(JM0920662-D)" : "TAN PEI SHAN(940924045066)",
    full_address: GOLDEN,
    mobile,
    case_url: business
      ? "https://wifibizz.com/applications/1?module=biz_fibre"
      : "https://wifibizz.com/applications/1?module=home_fibre",
    provider: business ? "Unifi Business" : "Unifi Premium Value",
    package: business ? "Unifi Business Fibre 300Mbps" : "Unifi Home 500Mbps",
  };
}

describe("Umobile Mobile No. length", () => {
  it("uses 8 suffix digits for 6011 and 7 for every other prefix", () => {
    expect(umobileMobileSuffixLength("6011")).toBe(8);
    expect(umobileMobileDigitLength("6011")).toBe(12);
    for (const prefix of ["6012", "6013", "6014", "6016", "6017", "6018", "6019", "6010"]) {
      expect(umobileMobileSuffixLength(prefix)).toBe(7);
      expect(umobileMobileDigitLength(prefix)).toBe(11);
    }
  });

  it("keeps a complete customer number and drops a padded extra digit", () => {
    const frozen = () => {
      throw new Error("suffix was already the right length");
    };
    expect(generateUmobileMobile("+60177540173", frozen)).toBe("60177540173");
    expect(generateUmobileMobile("+601775401730", frozen)).toBe("60177540173");
    expect(generateUmobileMobile("+601112345678", frozen)).toBe("601112345678");
    expect(generateUmobileMobile("6011123456789", frozen)).toBe("601112345678");
  });

  it("fills a short suffix with the requested count of random digits", () => {
    const calls: number[] = [];
    const randomDigits = (count: number) => {
      calls.push(count);
      return "9".repeat(count);
    };
    expect(generateUmobileMobile("6017", randomDigits)).toBe("60179999999");
    expect(generateUmobileMobile("6011", randomDigits)).toBe("601199999999");
    expect(calls).toEqual([7, 8]);
    expect(umobileMobileStreamToken("60179999999")).toBe("60179999999 ");
    expect(umobileMobileStreamToken("601199999999")).toBe("601199999999");
  });

  it("leaves a non-digit mobile on the template's 12-wide slot", () => {
    expect(generateUmobileMobile("", () => "1")).toBe("000000000000");
    expect(generateUmobileMobile("+60-17", () => "1")).toBe("60-170000000");
  });

  it("samples 80 numbers across 6011 and four other prefixes with zero failures", () => {
    const prefixes = ["6011", "6012", "6013", "6017", "6019"];
    const randomDigits = randomDigitsFrom(lcg(20261004));
    const rows = prefixes.flatMap((prefix) =>
      Array.from({ length: 16 }, () => {
        const number = generateUmobileMobile(prefix, randomDigits);
        const digits = number.length;
        const pass =
          number.startsWith(prefix) &&
          digits === umobileMobileDigitLength(prefix) &&
          /^\d+$/.test(number);
        return { prefix, number, digits, result: pass ? "PASS" : "FAIL" };
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(50);
    expect(new Set(rows.map((row) => row.prefix)).size).toBeGreaterThanOrEqual(4);
    expect(rows.filter((row) => row.result === "FAIL")).toEqual([]);
    expect(rows.filter((row) => row.prefix === "6011").every((row) => row.digits === 12)).toBe(true);
    expect(rows.filter((row) => row.prefix !== "6011").every((row) => row.digits === 11)).toBe(true);

    const csvPath = path.join(process.cwd(), "docs/umobile-mobile-length-samples.csv");
    const csv = readFileSync(csvPath, "utf8").trim().split("\n");
    const body = csv.slice(1).map((line) => {
      const [prefix, number, digits, result] = line.split(",");
      return { prefix, number, digits: Number(digits), result };
    });
    expect(body).toEqual(rows);
  });
});

describe("Umobile bill prints one Mobile No.", () => {
  const cases: { kind: "home" | "business"; mobile: string; expect: string }[] = [
    { kind: "home", mobile: "+60177540173", expect: "60177540173" },
    { kind: "home", mobile: "+601112345678", expect: "601112345678" },
    { kind: "business", mobile: "+60177540173", expect: "60177540173" },
    { kind: "business", mobile: "+601112345678", expect: "601112345678" },
  ];

  for (const row of cases) {
    it(`${row.kind} ${row.expect.slice(0, 4)} prints ${row.expect.length} digits once`, async () => {
      const pdf = await generateInternetBill(caseFor(row.kind, row.mobile));
      const printed = await printedMobile(pdf);
      expect(printed).toBe(row.expect);
      expect(printed).toHaveLength(row.expect.length);

      const text = await billText(pdf);
      expect(text).toContain("2-T.12-U.01");
      expect(text).toContain("BLOK B2");
      // Charges row sits on the same baseline as the Mobile No. and must stay intact.
      expect(text).toContain("(A)-15(c)-19(c)-19(es)-19(s)");
      expect(text).toContain("(H)-12(o)-38(m)-17(e)");
      if (row.kind === "business") {
        expect(text).toContain("(MONBLEU CAFE)");
        expect(text).not.toContain("JM0920662");
      } else {
        expect(text).toContain("(TAN PEI SHAN\\(940924045066\\))");
      }
    });
  }
});

import { inflateSync } from "zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { generateInternetBill, type CaseData } from "@/lib/bill-generator/internet-bill";
import { getPageStreamRefs } from "@/lib/bill-generator/pdf-utils";
import {
  generateUmobileMobile,
  umobileMobileStreamToken,
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

describe("Umobile Mobile No. is a new 6011 number", () => {
  it("is 6011 + 8 random digits, 60 samples", () => {
    const randomDigits = randomDigitsFrom(lcg(20261014));
    const numbers = Array.from({ length: 60 }, () => generateUmobileMobile(randomDigits));
    for (const n of numbers) expect(n).toMatch(/^6011\d{8}$/);
    expect(new Set(numbers).size).toBe(60);
  });

  it("asks for exactly 8 digits and fills all 12 template slots", () => {
    expect(generateUmobileMobile((count) => "9".repeat(count))).toBe("601199999999");
    expect(umobileMobileStreamToken("601199999999")).toBe("601199999999");
  });
});

describe("Umobile bill prints one Mobile No.", () => {
  const cases: { kind: "home" | "business"; mobile: string }[] = [
    { kind: "home", mobile: "+60177540173" },
    { kind: "home", mobile: "+601112345678" },
    { kind: "business", mobile: "+60177540173" },
    { kind: "business", mobile: "" },
  ];

  for (const row of cases) {
    it(`${row.kind} case mobile "${row.mobile}" prints a new 6011 number`, async () => {
      const pdf = await generateInternetBill(caseFor(row.kind, row.mobile));
      const printed = await printedMobile(pdf);
      expect(printed).toMatch(/^6011\d{8}$/);

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

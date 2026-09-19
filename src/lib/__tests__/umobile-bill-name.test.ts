import { inflateSync } from "zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { generateInternetBill } from "@/lib/bill-generator/internet-bill";
import { getPageStreamRefs } from "@/lib/bill-generator/pdf-utils";

const ADDRESS = "22 JALAN TH 2 TAMAN TEMPOI HARMONI 75760 KRUBONG MELAKA MALAYSIA";
const MOBILE = "+60123456789";

function streamBytes(stream: { dict: { get: (n: ReturnType<typeof PDFName.of>) => { toString(): string } | undefined }; getContents: () => Uint8Array }): string {
  const bytes = Buffer.from(stream.getContents());
  const filter = stream.dict.get(PDFName.of("Filter"))?.toString() ?? "";
  const raw = filter.includes("FlateDecode") ? inflateSync(bytes) : bytes;
  return raw.toString("latin1");
}

async function overlayStream(fullName: string, extra: Record<string, string> = {}): Promise<string> {
  const pdf = await generateInternetBill({
    case_no: "202661159",
    full_name: fullName,
    full_address: ADDRESS,
    mobile: MOBILE,
    ...extra,
  });
  const doc = await PDFDocument.load(pdf);
  return getPageStreamRefs(doc, doc.getPages()[0])
    .map((entry) => streamBytes(entry.stream))
    .join("\n");
}

describe("U Mobile bill name overlay", () => {
  it("keeps a residential name+(NRIC) on a Home Fibre case", async () => {
    const stream = await overlayStream("TAN PEI SHAN(940924045066)", {
      case_url: "https://wifibizz.com/applications/1?module=home_fibre",
      provider: "Unifi Premium Value",
      package: "Unifi Home 500Mbps",
    });
    expect(stream).toContain("(TAN PEI SHAN\\(940924045066\\)) Tj");
  });

  it("keeps a letter BRN on a Business Fibre case", async () => {
    const stream = await overlayStream("MONBLEU CAFE(JM0920662-D)", {
      case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      provider: "Unifi Business",
      package: "Unifi Business Fibre 300Mbps",
    });
    expect(stream).toContain("(MONBLEU CAFE\\(JM0920662-D\\)) Tj");
  });

  it("strips trailing digits on a Business Fibre case", async () => {
    const stream = await overlayStream("TAN PEI SHAN(940924045066)", {
      case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      package: "Unifi Business Fibre 300Mbps",
    });
    expect(stream).toContain("(TAN PEI SHAN) Tj");
    expect(stream).not.toContain("940924045066");
  });
});

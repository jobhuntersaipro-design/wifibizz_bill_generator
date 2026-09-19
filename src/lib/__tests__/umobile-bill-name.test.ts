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

  it("strips a letter BRN on a Business Fibre case", async () => {
    const stream = await overlayStream("MONBLEU CAFE(JM0920662-D)", {
      case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      provider: "Unifi Business",
      package: "Unifi Business Fibre 300Mbps",
    });
    expect(stream).toContain("(MONBLEU CAFE) Tj");
    expect(stream).not.toContain("JM0920662");
  });

  it("strips a passport-shaped ID on a Business Fibre case (202659425)", async () => {
    const stream = await overlayStream("XU QING(EC0606230)", {
      case_url:
        "https://wifibizz.com/applications/201467?module=biz_fibre&application_no=202659425",
      provider: "Unifi Business With Device",
      package: "Unifi Business Premium 2.0 300M with Device (MESH6) RM149 TV",
    });
    expect(stream).toContain("(XU QING) Tj");
    expect(stream).not.toContain("EC0606230");
  });

  it("strips trailing digits on a Business Fibre case", async () => {
    const stream = await overlayStream("TAN PEI SHAN(940924045066)", {
      case_url: "https://wifibizz.com/applications/1?module=biz_fibre",
      package: "Unifi Business Fibre 300Mbps",
    });
    expect(stream).toContain("(TAN PEI SHAN) Tj");
    expect(stream).not.toContain("940924045066");
  });

  it("strips a trailing NNNNNN-T BRN on a Business Fibre case", async () => {
    const stream = await overlayStream("VSD AUTOMATION SDN. BHD.(510254-T)", {
      case_url: "https://wifibizz.com/applications/1?module=biz_fibre&application_no=202672121",
      package: "Unifi Business Fibre 300Mbps",
    });
    expect(stream).toContain("(VSD AUTOMATION SDN. BHD.) Tj");
    expect(stream).not.toContain("510254");
  });
});

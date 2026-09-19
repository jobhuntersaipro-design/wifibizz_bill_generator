import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  billDownloadPath,
  nextBillObjectKey,
  r2KeyFromPublicUrl,
  revisionFromPublicUrl,
} from "@/lib/bill-object";
import { generateInternetBill } from "@/lib/bill-generator/internet-bill";
import { appendUmobileImagePage, type ModemImage } from "@/lib/bill-generator/umobile-modem";
import { storedBillReplaced } from "@/lib/persist-bill";

const BASE = "https://files.example.com";

describe("nextBillObjectKey", () => {
  it("writes a new object per revision so empty-pool generate cannot keep the old combine", () => {
    const first = nextBillObjectKey("user-1", "202666996", "internet", "rev-a");
    const second = nextBillObjectKey("user-1", "202666996", "internet", "rev-b");
    expect(first).toBe("bills/user-1/202666996/internet_bill-rev-a.pdf");
    expect(second).toBe("bills/user-1/202666996/internet_bill-rev-b.pdf");
    expect(first).not.toBe(second);
  });

  it("stringifies the numeric wifibizz user id used by generate", () => {
    expect(nextBillObjectKey(42, "202666996", "internet", "rev-a")).toBe(
      "bills/42/202666996/internet_bill-rev-a.pdf",
    );
  });
});

describe("r2KeyFromPublicUrl", () => {
  it("reads the stored public URL so download follows the latest generate", () => {
    const key = nextBillObjectKey("user-1", "202666996", "internet", "rev-empty");
    const url = `${BASE}/${key}`;
    expect(r2KeyFromPublicUrl(url, BASE)).toBe(key);
    expect(r2KeyFromPublicUrl(url, `${BASE}/`)).toBe(key);
  });

  it("still resolves a legacy unversioned internet_bill.pdf key", () => {
    expect(
      r2KeyFromPublicUrl(`${BASE}/bills/user-1/202666996/internet_bill.pdf`, BASE),
    ).toBe("bills/user-1/202666996/internet_bill.pdf");
  });
});

describe("billDownloadPath", () => {
  it("includes the revision so a later download does not reuse a cached 4-page response", () => {
    const url = `${BASE}/bills/user-1/202666996/internet_bill-rev-empty.pdf`;
    expect(billDownloadPath("202666996", "internet", revisionFromPublicUrl(url))).toBe(
      "/api/bills/download?case_no=202666996&type=internet&v=internet_bill-rev-empty",
    );
    expect(
      billDownloadPath("202666996", "internet", "r", { preview: true }),
    ).toContain("preview=1");
  });
});

describe("Case List generate overwrites the stored bill object", () => {
  it("uploads a revisioned key, updates internet_bill_url, and deletes the previous object", async () => {
    const generate = await readFile("src/app/api/bills/generate/route.ts", "utf8");
    const download = await readFile("src/app/api/bills/download/route.ts", "utf8");
    const persist = await readFile("src/lib/persist-bill.ts", "utf8");
    const caseList = await readFile("src/components/dashboard/CaseManagementSection.tsx", "utf8");
    const nextConfig = await readFile("next.config.ts", "utf8");

    expect(persist).toContain("nextBillObjectKey");
    expect(persist).toContain("SET internet_bill_url = ${publicUrl}");
    expect(persist).toContain("deleteFromR2(previousKey)");
    expect(generate).toContain("persistBillPdf");
    expect(generate).toContain("buildInternetBillPdf");
    expect(generate).not.toMatch(/bills\/\$\{wifibizzUserId\}\/\$\{caseNo\}\/\$\{r2Prefix\}\.pdf/);

    expect(download).toContain("buildInternetBillPdf");
    expect(download).toContain("persistBillPdf");
    expect(download).toContain("Vercel-CDN-Cache-Control");
    expect(download).toContain('"attachment"');
    expect(nextConfig).toContain("'/api/bills/download'");

    expect(caseList).toContain('handleGenerateSingle(c.case_no, "internet")');
    expect(caseList).toContain("Building Umobile bill");
    expect(caseList).toContain("a.download");
    const internetHandler = caseList.slice(
      caseList.indexOf("async function handleGenerateSingle"),
      caseList.indexOf("async function handleGenerateChat"),
    );
    expect(internetHandler).not.toContain("window.open(");
    expect(internetHandler).toContain("45_000");

    const utilityPreview = caseList.slice(
      caseList.indexOf('title="Utility Bill Preview"') - 280,
      caseList.indexOf('title="Utility Bill Preview"'),
    );
    expect(utilityPreview).toContain("preview: true");
    expect(utilityPreview).toContain('"utility"');
  });

  it("empty-pool bytes are 3 pages and not the previous 4-page combine", async () => {
    const CASE = {
      case_no: "202666996",
      full_name: "PROBE AC5",
      full_address: "NO 1 JALAN TEST 50000 KUALA LUMPUR WILAYAH PERSEKUTUAN",
      mobile: "+60123456789",
    };
    const PIXEL_PNG = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const image: ModemImage = { bytes: PIXEL_PNG, mime: "image/png" };
    const bill = await generateInternetBill(CASE);
    const previousCombine = await appendUmobileImagePage(bill, image);
    const emptyPool = await appendUmobileImagePage(bill, null);

    expect((await PDFDocument.load(emptyPool)).getPageCount()).toBe(3);
    expect((await PDFDocument.load(previousCombine)).getPageCount()).toBe(4);
    expect(emptyPool.byteLength).not.toBe(previousCombine.byteLength);
    expect(Buffer.from(emptyPool).equals(Buffer.from(previousCombine))).toBe(false);

    const previousUrl = `${BASE}/bills/42/202666996/internet_bill.pdf`;
    const nextUrl = `${BASE}/${nextBillObjectKey(42, "202666996", "internet", "rev-empty")}`;
    expect(storedBillReplaced(previousUrl, nextUrl)).toBe(true);
    expect(storedBillReplaced(previousUrl, previousUrl)).toBe(false);
    expect(r2KeyFromPublicUrl(nextUrl, BASE)).not.toBe(
      r2KeyFromPublicUrl(previousUrl, BASE),
    );
  });
});

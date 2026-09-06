import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import {
  billDownloadPath,
  nextBillObjectKey,
  r2KeyFromPublicUrl,
  revisionFromPublicUrl,
} from "@/lib/bill-object";

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
  });
});

describe("Case List generate overwrites the stored bill object", () => {
  it("uploads a revisioned key, updates internet_bill_url, and deletes the previous object", async () => {
    const generate = await readFile("src/app/api/bills/generate/route.ts", "utf8");
    const download = await readFile("src/app/api/bills/download/route.ts", "utf8");

    expect(generate).toContain("nextBillObjectKey");
    expect(generate).toContain("crypto.randomUUID()");
    expect(generate).toContain("SET internet_bill_url = ${publicUrl}");
    expect(generate).toContain("deleteFromR2(previousKey)");
    expect(generate).not.toMatch(/bills\/\$\{wifibizzUserId\}\/\$\{caseNo\}\/\$\{r2Prefix\}\.pdf/);

    expect(download).toContain("r2KeyFromPublicUrl");
    expect(download).toContain("getBytesFromR2");
    expect(download).toContain("Vercel-CDN-Cache-Control");
    expect(download).toContain("ETag:");
  });
});

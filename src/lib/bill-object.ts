/**
 * Where a generated bill lives in R2, and how download finds it.
 *
 * The object key is revisioned on every generate so a new 3-page (empty pool)
 * bill cannot share a key with the previous 4-page combine. Download reads
 * whatever key `internet_bill_url` currently points at.
 */

export function nextBillObjectKey(
  userId: string | number,
  caseNo: string,
  type: "internet" | "utility",
  revision: string,
): string {
  const owner = String(userId);
  if (!owner || !caseNo || owner.includes("..") || caseNo.includes("..") || caseNo.includes("/")) {
    throw new Error("invalid bill object key");
  }
  const prefix = type === "utility" ? "utility_bill" : "internet_bill";
  return `bills/${owner}/${caseNo}/${prefix}-${revision}.pdf`;
}

export function r2KeyFromPublicUrl(
  billUrl: string,
  publicUrlBase: string,
): string | null {
  if (!billUrl) return null;
  const base = publicUrlBase.replace(/\/+$/, "");
  let key = billUrl.startsWith(`${base}/`) ? billUrl.slice(base.length + 1) : "";
  if (!key) {
    const marked = billUrl.indexOf("/bills/");
    if (marked >= 0) key = billUrl.slice(marked + 1);
  }
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return key;
}

export function revisionFromPublicUrl(billUrl: string): string {
  const file = billUrl.split("/").pop() ?? "";
  return file.replace(/\.pdf$/i, "") || billUrl;
}

export function billDownloadPath(
  caseNo: string,
  type: "internet" | "utility",
  revision?: string | null,
): string {
  const qs = new URLSearchParams({ case_no: caseNo, type });
  if (revision) qs.set("v", revision);
  return `/api/bills/download?${qs.toString()}`;
}

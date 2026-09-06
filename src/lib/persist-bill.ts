import { neon } from "@neondatabase/serverless";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { nextBillObjectKey, r2KeyFromPublicUrl } from "@/lib/bill-object";

/**
 * Store a freshly built bill under a new R2 key and point the case at it.
 *
 * A reused `internet_bill.pdf` key is how Case List kept serving a previous
 * 4-page combine after an empty-pool 3-page generate. The stored URL must
 * change so download cannot resolve the old object.
 */
export async function persistBillPdf(opts: {
  userId: string | number;
  caseNo: string;
  type: "internet" | "utility";
  previousUrl: string | null;
  pdf: Buffer | Uint8Array;
}): Promise<{ publicUrl: string; key: string }> {
  const key = nextBillObjectKey(opts.userId, opts.caseNo, opts.type, crypto.randomUUID());
  const publicUrl = await uploadToR2(key, opts.pdf, "application/pdf");
  const sql = neon(process.env.DATABASE_URL!);

  if (opts.type === "utility") {
    await sql`
      UPDATE wifibizz_cases
      SET utility_bill_url = ${publicUrl}
      WHERE case_no = ${opts.caseNo} AND user_id = ${opts.userId}
    `;
  } else {
    await sql`
      UPDATE wifibizz_cases
      SET internet_bill_url = ${publicUrl}
      WHERE case_no = ${opts.caseNo} AND user_id = ${opts.userId}
    `;
  }

  const previousKey = opts.previousUrl
    ? r2KeyFromPublicUrl(opts.previousUrl, process.env.R2_PUBLIC_URL ?? "")
    : null;
  if (previousKey && previousKey !== key) {
    await deleteFromR2(previousKey).catch((err) => {
      console.error(
        `Previous ${opts.type} bill delete skipped for ${opts.caseNo}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  return { publicUrl, key };
}

export function storedBillReplaced(
  previousUrl: string | null,
  nextUrl: string,
): boolean {
  return nextUrl.length > 0 && nextUrl !== previousUrl;
}

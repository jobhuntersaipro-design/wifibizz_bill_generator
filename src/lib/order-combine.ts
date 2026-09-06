// Turn already-stored order documents into one PDF.
//
// Order Entry used to fetch every file into the browser, wrap images as PNG
// pages, merge, then POST the result through `uploadOrderDocument`. That last
// step is a Server Action. A JPEG that has been canvas-re-encoded as PNG (the
// only image path the form had) routinely makes a combined body that Next/Vercel
// cannot return as a Server Action flight response — the client then throws
// "An unexpected response was received from the server."
//
// Combining from the R2 keys instead keeps the request to a few dozen bytes of
// JSON. JPEG/PNG are embedded natively (no PNG explosion). WEBP/BMP go through
// sharp to JPEG so they still take part.

import sharp from "sharp";
import { imageToPdfPage } from "@/lib/bill-generator/image-page";
import { mergePdfs, type MergeResult, type MergeSource } from "@/lib/bill-generator/merge-pdfs";
import { isImageDocument } from "@/lib/order-merge";

/** Per-file upload cap. Combined output may exceed this — see MAX_COMBINED_BYTES. */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/**
 * Ceiling for the stored combined PDF. Two 5MB inputs plus wrapper overhead
 * still fit; this is not a new upload allowance for the file picker.
 */
export const MAX_COMBINED_BYTES = 12 * 1024 * 1024;

export interface CombineSource {
  filename: string;
  bytes: Uint8Array;
}

/**
 * The filename the combined PDF is stored under — same scheme as
 * `uploadOrderDocument` (`{idNumber}_combined_{seq}.pdf`).
 */
export function combinedFilename(idNumber: string, seq: number): string {
  const id = idNumber.replace(/[^A-Za-z0-9]/g, "");
  const n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 1;
  return `${id}_combined_${n}.pdf`;
}

export function ownedOrderKey(userId: string, key: string): boolean {
  const prefix = `orders/${userId}/`;
  return key.startsWith(prefix) && !key.includes("..");
}

function extOf(filename: string): string {
  return (filename.split(".").pop() || "").toLowerCase();
}

/**
 * One source, as PDF bytes. Images become a single A4 page; PDFs pass through.
 *
 * JPEG/JFIF stay JPEG inside the page (DCTDecode). The old client path decoded
 * every image onto a canvas and re-encoded PNG, which is what made PDF+JPG
 * overflow the Server Action body while PDF+PNG of the same pixel size did not.
 */
export async function documentToPdfBytes(filename: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!isImageDocument(filename)) {
    return bytes;
  }
  const ext = extOf(filename);
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") {
    return imageToPdfPage(bytes, "image/jpeg");
  }
  if (ext === "png") {
    return imageToPdfPage(bytes, "image/png");
  }
  const jpeg = await sharp(bytes).jpeg({ quality: 85 }).toBuffer();
  return imageToPdfPage(new Uint8Array(jpeg), "image/jpeg");
}

/**
 * Wrap each source and merge. A source that cannot be wrapped or parsed is
 * named in `failed` rather than aborting the rest — same contract as `mergePdfs`.
 */
export async function combineOrderDocuments(sources: CombineSource[]): Promise<MergeResult> {
  if (sources.length === 0) {
    throw new Error("No documents to merge.");
  }

  const wrapped: MergeSource[] = [];
  const failed: string[] = [];

  for (const source of sources) {
    try {
      wrapped.push({
        label: source.filename,
        bytes: await documentToPdfBytes(source.filename, source.bytes),
      });
    } catch {
      failed.push(source.filename);
    }
  }

  if (wrapped.length === 0) {
    throw new Error(
      failed.length === sources.length
        ? "None of the selected documents could be read."
        : "The selected documents produced no pages.",
    );
  }

  const merged = await mergePdfs(wrapped);
  return { ...merged, failed: [...failed, ...merged.failed] };
}

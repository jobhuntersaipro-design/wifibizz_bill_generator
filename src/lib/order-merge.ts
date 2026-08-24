// Combining an order's SUPPORTING documents into one PDF.
//
// Only the supporting documents take part. The ID copy is deliberately excluded:
// `hasIdentityDocument` is the save gate and the scraper reads `id_paths`, and
// neither can see inside a merged file — folding the MyKad into one would strip
// it from both while looking, on screen, like it was still attached.
//
// Combining takes EVERY supporting document and leaves exactly one file behind.
// There is deliberately no way to leave one out: a per-file selection meant a
// document you simply forgot to tick could be deleted while its pages were not in
// the PDF, and no arrangement of the UI makes that safe.
//
// Everything here is pure so the rules can be tested without a browser. The
// fetching, merging and uploading live in the order form.

import type { OrderDocument } from "./order-types";

/** The docType a combined file is stored under, and its filename slug. */
export const COMBINED_DOC_TYPE = "other";
export const COMBINED_DOC_LABEL = "combined";

/** Combining one file is a format conversion, not a combine. */
export const MIN_COMBINE = 2;

export function canCombine(docs: readonly unknown[]): boolean {
  return docs.length >= MIN_COMBINE;
}

/**
 * Move the document at `index` one place up or down.
 *
 * Order is page order in the combined PDF, so this is the only control over how
 * the merged file reads. Out-of-range moves return the list unchanged rather
 * than wrapping — a document jumping from the top to the bottom is never what
 * pressing "up" meant.
 */
export function moveDoc<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Replace the merged sources with the combined file, in place.
 *
 * The combined PDF takes the position of the FIRST document it replaced rather
 * than being appended: it stands for those files, and appending would leave the
 * list reordering itself under the agent every time they combined.
 */
export function applyCombine(
  docs: readonly OrderDocument[],
  mergedKeys: readonly string[],
  combined: OrderDocument,
): OrderDocument[] {
  const merged = new Set(mergedKeys);
  const at = docs.findIndex((d) => merged.has(d.key));
  const rest = docs.filter((d) => !merged.has(d.key));
  if (at < 0) return [...rest, combined];
  const before = docs.slice(0, at).filter((d) => !merged.has(d.key));
  return [...before, combined, ...rest.slice(before.length)];
}

/** A human-readable label for a source, used in merge failure messages. */
export function mergeLabel(doc: OrderDocument): string {
  return doc.filename;
}

/** True when this document is an image that must be wrapped in a PDF page. */
export function isImageDocument(filename: string): boolean {
  return /\.(jpe?g|jfif|png|bmp|webp)$/i.test(filename);
}

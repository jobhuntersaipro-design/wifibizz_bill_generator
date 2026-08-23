import { PDFDocument } from "pdf-lib";

/**
 * Combine several PDFs into one, in the order given.
 *
 * Pure and browser-safe: it takes bytes and returns bytes, touching no network,
 * no filesystem and no R2. The case list merges the documents for the selected
 * cases entirely in the browser, so nothing about the combined file is ever
 * uploaded or stored.
 *
 * A source that fails to parse is reported by name rather than silently
 * dropped — a merged file quietly missing a page looks exactly like a merge
 * that worked, which is the failure mode worth being loud about.
 */
export interface MergeSource {
  /** Human-readable label used in error messages, e.g. "202624115 — Internet Bill". */
  label: string;
  bytes: Uint8Array;
}

export interface MergeResult {
  /** The combined PDF. */
  bytes: Uint8Array;
  /** Total pages in the combined PDF. */
  pageCount: number;
  /** Labels of sources that could not be read, in the order they were given. */
  failed: string[];
}

/**
 * Merge `sources` into a single PDF.
 *
 * Sources that cannot be parsed are skipped and named in `failed`. Throws only
 * when NOTHING could be merged: an empty PDF is not a usable answer, and
 * returning one would report success for a merge that produced nothing.
 */
export async function mergePdfs(sources: MergeSource[]): Promise<MergeResult> {
  if (sources.length === 0) {
    throw new Error("No documents to merge.");
  }

  const merged = await PDFDocument.create();
  const failed: string[] = [];

  for (const source of sources) {
    try {
      const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch {
      failed.push(source.label);
    }
  }

  if (merged.getPageCount() === 0) {
    throw new Error(
      failed.length === sources.length
        ? "None of the selected documents could be read."
        : "The selected documents produced no pages."
    );
  }

  return {
    bytes: await merged.save(),
    pageCount: merged.getPageCount(),
    failed,
  };
}

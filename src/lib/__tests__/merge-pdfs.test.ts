import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mergePdfs } from "@/lib/bill-generator/merge-pdfs";

/** A PDF of `pageCount` pages, each stamped with `label` so order is checkable. */
async function makePdf(label: string, pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`${label}-${i + 1}`, { x: 20, y: 100, size: 12, font });
  }
  return doc.save();
}

describe("mergePdfs", () => {
  it("combines every page of every source", async () => {
    const result = await mergePdfs([
      { label: "A", bytes: await makePdf("A", 2) },
      { label: "B", bytes: await makePdf("B", 3) },
      { label: "C", bytes: await makePdf("C", 1) },
    ]);

    expect(result.pageCount).toBe(6);
    expect(result.failed).toEqual([]);
    // The result is itself a readable PDF, not just bytes we produced.
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(6);
  });

  it("preserves the order the sources were given in", async () => {
    // Page sizes stand in for identity: pdf-lib gives no text extraction, but a
    // distinct size per source survives copyPages and pins the sequence.
    const wide = await PDFDocument.create();
    wide.addPage([400, 100]);
    const tall = await PDFDocument.create();
    tall.addPage([100, 400]);

    const result = await mergePdfs([
      { label: "tall", bytes: await tall.save() },
      { label: "wide", bytes: await wide.save() },
    ]);

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPage(0).getSize()).toMatchObject({ width: 100, height: 400 });
    expect(reloaded.getPage(1).getSize()).toMatchObject({ width: 400, height: 100 });
  });

  it("skips an unreadable source, names it, and still merges the rest", async () => {
    const result = await mergePdfs([
      { label: "good", bytes: await makePdf("good", 2) },
      { label: "junk", bytes: new TextEncoder().encode("this is not a PDF") },
    ]);

    expect(result.pageCount).toBe(2);
    expect(result.failed).toEqual(["junk"]);
  });

  it("throws rather than returning an empty PDF when nothing can be read", async () => {
    await expect(
      mergePdfs([{ label: "junk", bytes: new TextEncoder().encode("nope") }])
    ).rejects.toThrow(/none of the selected documents/i);
  });

  it("throws when given no sources at all", async () => {
    await expect(mergePdfs([])).rejects.toThrow(/no documents/i);
  });
});

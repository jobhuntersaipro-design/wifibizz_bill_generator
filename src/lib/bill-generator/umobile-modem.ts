import { PDFDocument, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { getBytesFromR2 } from "@/lib/r2";
import { fitWithin } from "./image-page";

export type ModemImageMime = "image/png" | "image/jpeg";

export type ModemImage = {
  bytes: Uint8Array;
  mime: ModemImageMime;
};

/**
 * Page 2 empty region below the Current Charges notes.
 *
 * pdf-lib origin is bottom-left. The template is 612×792. Notes end near
 * y-from-top 405, so this box sits in the unused body without covering
 * charges, the note text, or the page footer.
 */
export const UMOBILE_MODEM_SLOT = {
  pageIndex: 1,
  x: 206,
  y: 162,
  width: 200,
  height: 200,
} as const;

export function pickRandomFromPool<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T | null {
  if (items.length === 0) return null;
  const index = Math.floor(rng() * items.length);
  if (index < 0 || index >= items.length) return null;
  return items[index] ?? null;
}

export function modemMime(contentType: string): ModemImageMime | null {
  if (contentType === "image/png") return "image/png";
  if (contentType === "image/jpeg") return "image/jpeg";
  return null;
}

export async function loadRandomModemImage(): Promise<ModemImage | null> {
  try {
    const rows = await prisma.umobileModemImage.findMany({
      select: { r2Key: true, contentType: true },
    });
    const row = pickRandomFromPool(rows);
    if (!row) return null;
    const mime = modemMime(row.contentType);
    if (!mime) return null;
    const bytes = await getBytesFromR2(row.r2Key);
    if (!bytes) return null;
    return { bytes, mime };
  } catch (error) {
    console.error(
      "umobile modem pool read failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function stampModemInSlot(
  pdfDoc: PDFDocument,
  image: ModemImage | null,
): Promise<boolean> {
  if (!image) return false;
  const page = pdfDoc.getPages()[UMOBILE_MODEM_SLOT.pageIndex];
  if (!page) return false;
  try {
    await drawModemOnPage(pdfDoc, page, image);
    return true;
  } catch (error) {
    console.error(
      "umobile modem stamp skipped:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

async function drawModemOnPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  image: ModemImage,
): Promise<void> {
  const embedded =
    image.mime === "image/png"
      ? await pdfDoc.embedPng(image.bytes)
      : await pdfDoc.embedJpg(image.bytes);
  const slot = UMOBILE_MODEM_SLOT;
  const fitted = fitWithin(
    embedded.width,
    embedded.height,
    slot.width,
    slot.height,
    slot.width,
    slot.height,
  );
  page.drawImage(embedded, {
    x: slot.x + fitted.x,
    y: slot.y + fitted.y,
    width: fitted.width,
    height: fitted.height,
  });
}

import { prisma } from "@/lib/prisma";
import { getBytesFromR2 } from "@/lib/r2";
import { imageToPdfPage } from "./image-page";
import { mergePdfs } from "./merge-pdfs";

export type ModemImageMime = "image/png" | "image/jpeg";

export type ModemImage = {
  bytes: Uint8Array;
  mime: ModemImageMime;
};

export type UmobileImagePick = {
  id: string;
  filename: string;
};

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

export async function pickRandomUmobileImage(
  excludeId?: string,
): Promise<UmobileImagePick | null> {
  try {
    const rows = await prisma.umobileModemImage.findMany({
      select: { id: true, filename: true },
    });
    const candidates =
      excludeId && rows.length > 1 ? rows.filter((row) => row.id !== excludeId) : rows;
    return pickRandomFromPool(candidates);
  } catch (error) {
    console.error(
      "umobile modem pool list failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function loadModemImageById(id: string): Promise<ModemImage | null> {
  if (!id) return null;
  try {
    const row = await prisma.umobileModemImage.findUnique({
      where: { id },
      select: { r2Key: true, contentType: true },
    });
    return row ? bytesFromRow(row) : null;
  } catch (error) {
    console.error(
      "umobile modem load failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function loadRandomModemImage(): Promise<ModemImage | null> {
  const pick = await pickRandomUmobileImage();
  return pick ? loadModemImageById(pick.id) : null;
}

async function bytesFromRow(row: {
  r2Key: string;
  contentType: string;
}): Promise<ModemImage | null> {
  const mime = modemMime(row.contentType);
  if (!mime || row.r2Key.includes("..")) return null;
  const bytes = await getBytesFromR2(row.r2Key);
  if (!bytes) return null;
  return { bytes, mime };
}

/**
 * Append one A4 page holding `image` after the bill pages.
 *
 * Null image or a failed embed returns the bill bytes unchanged. The bill
 * must still generate when the pool is empty or R2 is missing a key.
 */
export async function appendUmobileImagePage(
  billPdf: Uint8Array,
  image: ModemImage | null,
): Promise<Buffer> {
  if (!image) return Buffer.from(billPdf);
  try {
    const extra = await imageToPdfPage(image.bytes, image.mime);
    const merged = await mergePdfs([
      { label: "internet bill", bytes: billPdf },
      { label: "umobile image", bytes: extra },
    ]);
    return Buffer.from(merged.bytes);
  } catch (error) {
    console.error(
      "umobile modem page skipped:",
      error instanceof Error ? error.message : error,
    );
    return Buffer.from(billPdf);
  }
}

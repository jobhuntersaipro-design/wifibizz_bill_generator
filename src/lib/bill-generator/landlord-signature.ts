/**
 * Admin-uploaded landlord signature images.
 *
 * Model A: the pool is just images. Generation picks one at random and pairs
 * it to the invented landlord for that generate. An empty pool is valid —
 * generate still succeeds and the landlord signature line stays blank.
 */

import { prisma } from "@/lib/prisma";
import { getBytesFromR2 } from "@/lib/r2";
import {
  createDocumentParties,
  rngFromSeed,
  type DocumentParties,
} from "./document-parties";
import { pickRandomFromPool } from "./umobile-modem";

export type SignatureImageMime = "image/png" | "image/jpeg";

export type SignatureImage = {
  bytes: Uint8Array;
  mime: SignatureImageMime;
};

export type SignatureImagePick = {
  id: string;
  filename: string;
};

export function signatureMime(contentType: string): SignatureImageMime | null {
  if (contentType === "image/png") return "image/png";
  if (contentType === "image/jpeg") return "image/jpeg";
  return null;
}

export async function pickRandomLandlordSignature(
  rng: () => number = Math.random,
): Promise<SignatureImagePick | null> {
  try {
    const rows = await prisma.landlordSignatureImage.findMany({
      select: { id: true, filename: true },
    });
    return pickRandomFromPool(rows, rng);
  } catch (error) {
    console.error(
      "landlord signature pool list failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function loadLandlordSignatureById(
  id: string,
): Promise<SignatureImage | null> {
  if (!id) return null;
  try {
    const row = await prisma.landlordSignatureImage.findUnique({
      where: { id },
      select: { r2Key: true, contentType: true },
    });
    return row ? bytesFromRow(row) : null;
  } catch (error) {
    console.error(
      "landlord signature load failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Pick and load one pool image. Null when the pool is empty, R2 is missing
 * the key, or the row is unreadable. Callers must not hard-fail on null.
 */
export async function loadRandomLandlordSignature(
  rng: () => number = Math.random,
): Promise<SignatureImage | null> {
  const pick = await pickRandomLandlordSignature(rng);
  return pick ? loadLandlordSignatureById(pick.id) : null;
}

async function bytesFromRow(row: {
  r2Key: string;
  contentType: string;
}): Promise<SignatureImage | null> {
  const mime = signatureMime(row.contentType);
  if (!mime || row.r2Key.includes("..")) return null;
  try {
    const bytes = await getBytesFromR2(row.r2Key);
    if (!bytes) return null;
    return { bytes, mime };
  } catch (error) {
    console.error(
      "landlord signature r2 read failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export interface TaAuthContext {
  parties: DocumentParties;
  signature: SignatureImage | null;
  rng: () => number;
  now: Date;
}

/**
 * One generate's shared landlord, witnesses, and optional signature image.
 * Empty pool → signature is null; generate must still succeed.
 */
export async function createTaAuthContext(opts: {
  tenantName: string;
  now?: Date;
  partiesSeed?: number;
  rng?: () => number;
}): Promise<TaAuthContext> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? rngFromSeed(opts.partiesSeed);
  const parties = createDocumentParties(now, rng, opts.tenantName);
  const signature = await loadRandomLandlordSignature(rng);
  return { parties, signature, rng, now };
}

import { prisma } from "@/lib/prisma";
import { getBytesFromR2 } from "@/lib/r2";
import {
  createDocumentParties,
  rngFromSeed,
  type DocumentParties,
} from "./document-parties";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { pickDistinctFromPool, pickRandomFromPool } from "./umobile-modem";

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
      orderBy: { id: "asc" },
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

export async function loadRandomLandlordSignature(
  rng: () => number = Math.random,
): Promise<SignatureImage | null> {
  const pick = await pickRandomLandlordSignature(rng);
  return pick ? loadLandlordSignatureById(pick.id) : null;
}

export const EXECUTION_SIGNATURE_SLOTS = 3;
export const MIN_SIGNATURE_PX = 40;

export async function isUsableSignatureImage(image: SignatureImage): Promise<boolean> {
  try {
    const meta = await sharp(image.bytes).metadata();
    return (meta.width ?? 0) >= MIN_SIGNATURE_PX && (meta.height ?? 0) >= MIN_SIGNATURE_PX;
  } catch {
    return false;
  }
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

/** Distinct pool scans for landlord + both witnesses. Drops duplicate file bytes. */
export async function loadDistinctLandlordSignatures(
  count: number = EXECUTION_SIGNATURE_SLOTS,
  rng: () => number = Math.random,
): Promise<SignatureImage[]> {
  try {
    const rows = await prisma.landlordSignatureImage.findMany({
      orderBy: { id: "asc" },
      select: { id: true, r2Key: true, contentType: true },
    });
    const shuffled = pickDistinctFromPool(rows, rows.length, rng);
    const unique: SignatureImage[] = [];
    const seen = new Set<string>();
    for (const row of shuffled) {
      if (unique.length >= count) break;
      const image = await bytesFromRow(row);
      if (!image) continue;
      if (!(await isUsableSignatureImage(image))) continue;
      const hash = createHash("sha256").update(image.bytes).digest("hex");
      if (seen.has(hash)) continue;
      seen.add(hash);
      unique.push(image);
    }
    return unique;
  } catch (error) {
    console.error(
      "landlord signature pool load failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export interface TaAuthContext {
  parties: DocumentParties;
  signature: SignatureImage | null;
  signatures: SignatureImage[];
  rng: () => number;
  now: Date;
}

export async function createTaAuthContext(opts: {
  tenantName: string;
  now?: Date;
  partiesSeed?: number;
  rng?: () => number;
}): Promise<TaAuthContext> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? rngFromSeed(opts.partiesSeed);
  const parties = createDocumentParties(now, rng, opts.tenantName);
  const signatures = await loadDistinctLandlordSignatures(EXECUTION_SIGNATURE_SLOTS, rng);
  return { parties, signature: signatures[0] ?? null, signatures, rng, now };
}

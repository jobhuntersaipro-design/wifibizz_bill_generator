"use server";

import { verifyAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";

const MAX_BYTES = 5 * 1024 * 1024;

const EXT_CONTENT_TYPE: Record<string, "image/png" | "image/jpeg"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export type LandlordSignatureView = {
  id: string;
  filename: string;
  createdAt: string;
  previewUrl: string;
};

function previewUrl(id: string): string {
  return `/api/admin/landlord-signatures/${id}`;
}

export async function adminListLandlordSignatures(): Promise<{
  success: boolean;
  error?: string;
  images: LandlordSignatureView[];
}> {
  if (!(await verifyAdminSession())) {
    return { success: false, error: "Unauthorized", images: [] };
  }
  const rows = await prisma.landlordSignatureImage.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, createdAt: true },
  });
  return {
    success: true,
    images: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      previewUrl: previewUrl(row.id),
    })),
  };
}

export async function adminUploadLandlordSignature(formData: FormData): Promise<{
  success: boolean;
  error?: string;
  image?: LandlordSignatureView;
}> {
  if (!(await verifyAdminSession())) {
    return { success: false, error: "Unauthorized" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "No file selected." };
  }
  if (file.size > MAX_BYTES) {
    return { success: false, error: "File exceeds the 5MB limit." };
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return { success: false, error: "Use a PNG or JPEG image." };
  }

  const filename =
    file.name.replace(/[/\\]/g, "").slice(0, 200) || `signature.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const row = await prisma.landlordSignatureImage.create({
    data: {
      filename,
      contentType,
      r2Key: `landlord-signatures/pending-${crypto.randomUUID()}`,
    },
  });
  const r2Key = `landlord-signatures/${row.id}.${ext}`;

  try {
    await uploadToR2(r2Key, buf, contentType);
    const saved = await prisma.landlordSignatureImage.update({
      where: { id: row.id },
      data: { r2Key },
      select: { id: true, filename: true, createdAt: true },
    });
    return {
      success: true,
      image: {
        id: saved.id,
        filename: saved.filename,
        createdAt: saved.createdAt.toISOString(),
        previewUrl: previewUrl(saved.id),
      },
    };
  } catch (error) {
    await deleteFromR2(r2Key).catch(() => undefined);
    await prisma.landlordSignatureImage.delete({ where: { id: row.id } }).catch(() => undefined);
    console.error(
      "adminUploadLandlordSignature error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "Upload failed. Try again." };
  }
}

export async function adminDeleteLandlordSignature(id: string): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!(await verifyAdminSession())) {
    return { success: false, error: "Unauthorized" };
  }
  if (!id) return { success: false, error: "Missing image." };

  const row = await prisma.landlordSignatureImage.findUnique({
    where: { id },
    select: { id: true, r2Key: true },
  });
  if (!row) return { success: true };

  try {
    if (!row.r2Key.includes("/pending-")) {
      await deleteFromR2(row.r2Key);
    }
  } catch (error) {
    console.error(
      "adminDeleteLandlordSignature r2:",
      error instanceof Error ? error.message : error,
    );
  }

  await prisma.landlordSignatureImage.delete({ where: { id: row.id } });
  return { success: true };
}

import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getFromR2 } from "@/lib/r2";

const CONTENT_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const row = await prisma.landlordSignatureImage.findUnique({
    where: { id },
    select: { r2Key: true, contentType: true, filename: true },
  });
  const contentType = row ? CONTENT_TYPES[row.contentType] : undefined;
  if (!row || !contentType || row.r2Key.includes("..")) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const filename = row.filename.replace(/["\\]/g, "") || "signature";

  try {
    const stream = await getFromR2(row.r2Key);
    if (!stream) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(
      "admin landlord signature error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}

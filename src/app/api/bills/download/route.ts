import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { r2KeyFromPublicUrl } from "@/lib/bill-object";
import { getBytesFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const caseNo = url.searchParams.get("case_no");
    const type = url.searchParams.get("type") || "internet";

    if (!caseNo) {
      return NextResponse.json(
        { success: false, error: "case_no is required" },
        { status: 400 }
      );
    }

    if (type !== "internet" && type !== "utility") {
      return NextResponse.json(
        { success: false, error: "type must be 'internet' or 'utility'" },
        { status: 400 }
      );
    }

    // Get user's wifibizz_user id
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    // Verify case belongs to user and bill exists
    const sql = neon(process.env.DATABASE_URL!);
    const billColumn = type === "internet" ? "internet_bill_url" : "utility_bill_url";

    const rows = await sql`
      SELECT internet_bill_url, utility_bill_url, order_no
      FROM wifibizz_cases
      WHERE case_no = ${caseNo} AND user_id = ${wifibizzUser.id}
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Case not found" },
        { status: 404 }
      );
    }

    const billUrl = rows[0][billColumn] as string | null;
    if (!billUrl) {
      return NextResponse.json(
        { success: false, error: "Bill not generated yet" },
        { status: 404 }
      );
    }

    const r2Key = r2KeyFromPublicUrl(billUrl, process.env.R2_PUBLIC_URL ?? "");
    if (!r2Key) {
      return NextResponse.json(
        { success: false, error: "File not found in storage" },
        { status: 404 }
      );
    }

    const bytes = await getBytesFromR2(r2Key);
    if (!bytes) {
      return NextResponse.json(
        { success: false, error: "File not found in storage" },
        { status: 404 }
      );
    }

    const orderNo = rows[0].order_no as string | null;
    const orderSuffix = orderNo ? `_${orderNo}` : "";
    const prefix = type === "utility" ? "utilityBill" : "internetBill";
    const filename = `${prefix}_${caseNo}${orderSuffix}.pdf`;

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
        ETag: `"${r2Key.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Bill download error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

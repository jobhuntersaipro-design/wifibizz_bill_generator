import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { r2KeyFromPublicUrl } from "@/lib/bill-object";
import { persistBillPdf } from "@/lib/persist-bill";
import { buildInternetBillPdf } from "@/lib/bill-generator/umobile-modem";
import { getBytesFromR2 } from "@/lib/r2";

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
      SELECT internet_bill_url, utility_bill_url, order_no, full_name, full_address, mobile,
             case_url, provider, package
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

    const orderNo = rows[0].order_no as string | null;
    const orderSuffix = orderNo ? `_${orderNo}` : "";
    const prefix = type === "utility" ? "utilityBill" : "internetBill";
    const filename = `${prefix}_${caseNo}${orderSuffix}.pdf`;

    // Default internet GET rebuilds from the live pool and returns those bytes
    // as an attachment. `preview=1` (case-detail iframe) only reads the stored
    // object so opening a row does not start a second generate.
    const previewOnly = url.searchParams.get("preview") === "1";
    if (type === "internet" && !previewOnly) {
      const pdf = await buildInternetBillPdf({
        case_no: caseNo,
        full_name: String(rows[0].full_name ?? ""),
        full_address: String(rows[0].full_address ?? ""),
        mobile: String(rows[0].mobile ?? ""),
        case_url: String(rows[0].case_url ?? ""),
        provider: String(rows[0].provider ?? ""),
        package: String(rows[0].package ?? ""),
      });
      const stored = await persistBillPdf({
        userId: wifibizzUser.id,
        caseNo,
        type: "internet",
        previousUrl: billUrl,
        pdf,
      });
      const stamped = `${prefix}_${caseNo}${orderSuffix}_${Date.now()}.pdf`;
      return pdfResponse(pdf, stamped, stored.key, "attachment");
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

    return pdfResponse(bytes, filename, r2Key, previewOnly ? "inline" : "attachment");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Bill download error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

function pdfResponse(
  bytes: Uint8Array,
  filename: string,
  r2Key: string,
  disposition: "inline" | "attachment",
) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      ETag: `"${r2Key.replace(/"/g, "")}"`,
    },
  });
}

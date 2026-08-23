import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateTimeInvoice } from "@/lib/bill-generator/time-invoice";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * GET /api/bills/time-invoice?case_no=…
 *
 * Streams the invoice straight to the browser. Like the authorization letter and
 * unlike the two bills there is nothing to store and nothing to charge: no R2
 * object, no column on `wifibizz_cases`, and no `CaseUsageLog` row — the case
 * limit counts cases that have had a *bill* generated, and this is not one.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const caseNo = new URL(request.url).searchParams.get("case_no");
    if (!caseNo) {
      return NextResponse.json({ success: false, error: "case_no is required" }, { status: 400 });
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        wifibizzEmail: true,
        wifibizzPasswordEnc: true,
        lastCrawlAt: true,
        googleSheetId: true,
      },
    });
    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    // Ownership is scoped in the query rather than checked afterwards, so a case
    // belonging to someone else is indistinguishable from one that is not there.
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT case_no, full_name, full_address, mobile, case_url
      FROM wifibizz_cases
      WHERE case_no = ${caseNo} AND user_id = ${wifibizzUser.id}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Case not found or not owned" },
        { status: 404 }
      );
    }

    const fullName = ((row.full_name as string) || "").trim();
    if (!fullName) {
      return NextResponse.json(
        { success: false, error: "This case has no customer name, which the invoice bills." },
        { status: 400 }
      );
    }

    // The same lazy portal fill the bills and the chat script use — a case crawled
    // list-only has no address until the portal is asked for it.
    const caseData = {
      case_no: row.case_no as string,
      full_name: fullName,
      full_address: (row.full_address as string) || "",
      mobile: (row.mobile as string) || "",
      case_url: (row.case_url as string) || "",
    };
    const resolved = await fillMissingAddresses(wifibizzUser, [caseData]);
    const fullAddress = (resolved[caseData.case_no] ?? caseData.full_address).trim();

    // An invoice with a blank billing address is not worth handing to anyone, so
    // this fails loudly rather than printing an empty customer block.
    if (!fullAddress) {
      return NextResponse.json(
        {
          success: false,
          error: "This case has no installation address, which the invoice bills to.",
        },
        { status: 400 }
      );
    }

    const pdf = await generateTimeInvoice({
      case_no: caseData.case_no,
      full_name: fullName,
      full_address: fullAddress,
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="time_invoice_${caseNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("TIME invoice generation failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

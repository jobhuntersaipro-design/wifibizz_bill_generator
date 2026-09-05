import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateTenancyAgreement } from "@/lib/bill-generator/tenancy-agreement";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * GET /api/bills/tenancy-agreement?case_no=…
 *
 * Streams the tenancy agreement straight to the browser. Like the authorization
 * letter and the TIME invoice — and unlike the two bills — there is nothing to
 * store and nothing to charge: no R2 object, no column on `wifibizz_cases`, and
 * no `CaseUsageLog` row. A case that has never had a bill generated still works.
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

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT case_no, full_name, full_address, mobile, id_no, case_url
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
        { success: false, error: "This case has no customer name, which the tenancy agreement needs for the tenant." },
        { status: 400 }
      );
    }

    const caseData = {
      case_no: row.case_no as string,
      full_name: fullName,
      full_address: (row.full_address as string) || "",
      mobile: (row.mobile as string) || "",
      case_url: (row.case_url as string) || "",
    };
    const resolved = await fillMissingAddresses(wifibizzUser, [caseData]);
    const fullAddress = resolved[caseData.case_no] ?? caseData.full_address;

    const pdf = await generateTenancyAgreement({
      case_no: caseData.case_no,
      full_name: fullName,
      full_address: fullAddress,
      id_no: ((row.id_no as string) || "").trim(),
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tenancy_agreement_${caseNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("Tenancy agreement generation failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

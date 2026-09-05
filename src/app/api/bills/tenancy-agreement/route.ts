import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateTenancyAgreement, TEMPLATE_MISSING } from "@/lib/bill-generator/tenancy-agreement";

/**
 * GET /api/bills/tenancy-agreement?case_no=…
 *
 * Stamps the case tenant name + NRIC onto Chris’s 13-page sample and streams
 * the PDF. Nothing is stored: no R2 object, no column, no CaseUsageLog row.
 * Landlord, dates, premises and commercial terms stay as the template printed.
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
      select: { id: true },
    });
    if (!wifibizzUser) {
      return NextResponse.json(
        { success: false, error: "WifiBizz account not linked" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT case_no, full_name, id_no
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

    const pdf = await generateTenancyAgreement({
      case_no: row.case_no as string,
      full_name: fullName,
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
    const missing = message === TEMPLATE_MISSING;
    return NextResponse.json(
      { success: false, error: message },
      { status: missing ? 503 : 500 },
    );
  }
}

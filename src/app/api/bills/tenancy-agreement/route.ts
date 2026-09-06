import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateTenancyAgreement, TEMPLATE_MISSING } from "@/lib/bill-generator/tenancy-agreement";
import {
  looksCompleteAddress,
  orderInstallationAddress,
  pickFullestAddress,
} from "@/lib/bill-generator/tenancy-fields";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * GET /api/bills/tenancy-agreement?case_no=…
 *
 * Stamps the case tenant, address, a fresh random landlord, today’s term
 * dates, and a rent/deposit pair onto Chris’s sample and streams the PDF.
 * Nothing is stored: no R2 object, no column, no CaseUsageLog row.
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
      SELECT case_no, full_name, full_address, id_no, case_url, order_no
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
      id_no: ((row.id_no as string) || "").trim(),
      case_url: (row.case_url as string) || "",
    };
    const orderNo = ((row.order_no as string) || "").trim();
    const idDigits = caseData.id_no.replace(/\D/g, "");
    const orderMatch = [
      ...(orderNo ? [{ orderId: orderNo }] : []),
      ...(idDigits ? [{ idNumber: idDigits }, { idNumber: caseData.id_no }] : []),
    ];
    const order = orderMatch.length === 0
      ? null
      : await prisma.order.findFirst({
          where: { userId: session.user.id, OR: orderMatch },
          orderBy: { updatedAt: "desc" },
          select: {
            addressFull: true,
            street: true,
            postcode: true,
            city: true,
            state: true,
          },
        });
    const fromOrder = order ? orderInstallationAddress(order) : "";
    const stored = caseData.full_address.trim();
    const needDetail =
      !!caseData.case_url && !looksCompleteAddress(pickFullestAddress(fromOrder, stored));
    const resolved = await fillMissingAddresses(
      wifibizzUser,
      [caseData],
      { force: needDetail },
    );
    const fromCase = (resolved[caseData.case_no] ?? stored).trim();
    // Order/case detail fields win over a truncated Case List / control-app string.
    const fullAddress = pickFullestAddress(fromOrder, fromCase);
    if (!fullAddress) {
      return NextResponse.json(
        {
          success: false,
          error: "This case has no installation address, which the tenancy agreement needs for the demised premises.",
        },
        { status: 400 }
      );
    }

    const pdf = await generateTenancyAgreement({
      case_no: caseData.case_no,
      full_name: fullName,
      full_address: fullAddress,
      id_no: caseData.id_no,
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

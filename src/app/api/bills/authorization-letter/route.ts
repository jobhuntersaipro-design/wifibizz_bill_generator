import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateAuthorizationLetter } from "@/lib/bill-generator/authorization-letter";
import { createTaAuthContext } from "@/lib/bill-generator/landlord-signature";
import { parsePartiesSeed } from "@/lib/bill-generator/document-parties";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * GET /api/bills/authorization-letter?case_no=…
 *
 * Streams the letter straight to the browser. Unlike the two bill routes there
 * is nothing to store and nothing to charge: no R2 object, no column on
 * `wifibizz_cases`, and no `CaseUsageLog` row — the case limit counts cases that
 * have had a *bill* generated, and this is not one.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const caseNo = url.searchParams.get("case_no");
    const partiesSeed = parsePartiesSeed(url.searchParams.get("partiesSeed"));
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

    // A residence letter whose resident has no IC is not worth handing to TM, so
    // this fails loudly rather than printing a blank.
    const idNo = ((row.id_no as string) || "").trim();
    if (!idNo) {
      return NextResponse.json(
        {
          success: false,
          error: "This case has no ID number, which the letter needs for the resident.",
        },
        { status: 400 }
      );
    }

    // Same lazy fill the bills and the chat script use — a case crawled list-only
    // has no address until the portal is asked for it.
    const caseData = {
      case_no: row.case_no as string,
      full_name: (row.full_name as string) || "",
      full_address: (row.full_address as string) || "",
      mobile: (row.mobile as string) || "",
      case_url: (row.case_url as string) || "",
    };
    const resolved = await fillMissingAddresses(wifibizzUser, [caseData]);
    const fullAddress = resolved[caseData.case_no] ?? caseData.full_address;

    const ctx = await createTaAuthContext({
      tenantName: caseData.full_name,
      partiesSeed,
    });
    const pdf = await generateAuthorizationLetter(
      {
        case_no: caseData.case_no,
        full_name: caseData.full_name,
        full_address: fullAddress,
        id_no: idNo,
      },
      ctx.now,
      { parties: ctx.parties, signature: ctx.signature, rng: ctx.rng },
    );

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="authorization_letter_${caseNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("Authorization letter generation failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import type { CaseData } from "@/lib/bill-generator/internet-bill";
import { fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * Streams a per-request case document (TIME invoice, Maxis bill) straight to the
 * browser. Nothing is stored and nothing is charged: no R2 object, no column on
 * `wifibizz_cases`, and no `CaseUsageLog` row.
 */
export async function serveCaseDocument(
  request: Request,
  doc: {
    generate: (c: CaseData) => Promise<Uint8Array | Buffer>;
    filePrefix: string;
    /** "invoice" / "bill", for the error messages. */
    noun: string;
  },
) {
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
        { success: false, error: `This case has no customer name, which the ${doc.noun} bills.` },
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

    // A document with a blank billing address is not worth handing to anyone, so
    // this fails loudly rather than printing an empty customer block.
    if (!fullAddress) {
      return NextResponse.json(
        {
          success: false,
          error: `This case has no installation address, which the ${doc.noun} bills to.`,
        },
        { status: 400 }
      );
    }

    const pdf = await doc.generate({ ...caseData, full_address: fullAddress });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${doc.filePrefix}_${caseNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error(`${doc.filePrefix} generation failed:`, message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

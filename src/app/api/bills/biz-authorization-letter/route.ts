import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { generateBizAuthorizationLetter } from "@/lib/bill-generator/biz-authorization-letter";
import { fetchBizzDetailFields, fillMissingAddresses } from "@/lib/crawler/lazy-address";

/**
 * GET /api/bills/biz-authorization-letter?case_no=…
 *
 * The business authorisation letter, streamed straight to the browser. Like the
 * residential letter beside it there is nothing to store and nothing to charge:
 * no R2 object, no column on `wifibizz_cases`, and no `CaseUsageLog` row — the
 * case limit counts cases that have had a *bill* generated, and this is not one.
 *
 * Unlike that route it does NOT refuse a case with missing data. The brief's
 * rule is that an incomplete record still produces a letter with the unknown
 * fields blank, so an agent can print it and fill the rest in by hand.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const caseNo = url.searchParams.get("case_no");
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
      SELECT case_no, full_name, full_address, mobile, id_no, package, provider, case_url
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

    const caseData = {
      case_no: row.case_no as string,
      full_name: (row.full_name as string) || "",
      full_address: (row.full_address as string) || "",
      case_url: (row.case_url as string) || "",
    };

    // Same lazy fill the bills and the chat scripts use — a case crawled
    // list-only has no address until the portal is asked for it.
    const resolved = await fillMissingAddresses(wifibizzUser, [caseData]);
    const fullAddress = resolved[caseData.case_no] ?? caseData.full_address;

    // Company name, BRN and the director live on the WifiBizz case DETAIL page
    // and in no column here, so they are fetched the same way the Bizz Chat
    // fetches them. A failed fetch is not fatal: `resolveBizLetterFields` falls
    // back to the `COMPANY(REG)` shape the crawler stores in `full_name`.
    let companyName = "";
    let companyReg = "";
    let directorName = "";
    try {
      const details = await fetchBizzDetailFields(wifibizzUser, [caseData]);
      const d = details[caseData.case_no];
      if (d) {
        companyName = d.companyName;
        companyReg = d.companyReg;
        directorName = d.customerName;
      }
    } catch (err) {
      console.error("Biz letter detail fetch failed:", err);
    }

    const pdf = await generateBizAuthorizationLetter({
      full_name: caseData.full_name,
      company_name: companyName,
      company_reg: companyReg,
      director_name: directorName,
      id_no: (row.id_no as string) || "",
      full_address: fullAddress,
      package: (row.package as string) || "",
      provider: (row.provider as string) || "",
      mobile: (row.mobile as string) || "",
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="biz_authorization_letter_${caseNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("Biz authorization letter generation failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

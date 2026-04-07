import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { uploadToR2 } from "@/lib/r2";
import { generateInternetBill } from "@/lib/bill-generator/internet-bill";
import { generateUtilityBill } from "@/lib/bill-generator/utility-bill";
import { getUserCaseUsage } from "@/lib/case-limit";

const MAX_BATCH = 20;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const caseNos: string[] = body.caseNos;
    const billType: "internet" | "utility" = body.type === "utility" ? "utility" : "internet";

    if (!Array.isArray(caseNos) || caseNos.length === 0) {
      return NextResponse.json(
        { success: false, error: "caseNos must be a non-empty array" },
        { status: 400 }
      );
    }

    if (caseNos.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Maximum ${MAX_BATCH} cases per batch` },
        { status: 400 }
      );
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
    const wifibizzUserId = wifibizzUser.id;

    // Check case limit — only cases with NO existing bills count as new charges
    const usage = await getUserCaseUsage(session.user.id);

    // Find which requested cases already have at least one bill (already charged)
    const caseBillStatus = await sql`
      SELECT case_no, internet_bill_url, utility_bill_url, full_name
      FROM wifibizz_cases
      WHERE case_no = ANY(${caseNos}) AND user_id = ${wifibizzUserId}
    `;

    const caseStatusMap = new Map(
      caseBillStatus.map((c) => [c.case_no as string, {
        hasAnyBill: c.internet_bill_url != null || c.utility_bill_url != null,
        fullName: c.full_name as string | null,
      }])
    );

    // Separate into "free" (already charged) and "new" (will cost 1 each)
    const freeCases: string[] = [];
    const newCases: string[] = [];
    for (const cn of caseNos) {
      const status = caseStatusMap.get(cn);
      if (!status) continue; // case not found, will error in processCase
      if (status.hasAnyBill) {
        freeCases.push(cn);
      } else {
        newCases.push(cn);
      }
    }

    // Check if new cases exceed remaining limit
    const newCasesToCharge = Math.min(newCases.length, usage.remaining);
    if (newCases.length > 0 && usage.remaining === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "case_limit_reached",
          casesUsed: usage.casesUsed,
          limit: usage.limit,
        },
        { status: 403 }
      );
    }

    // Cap new cases to remaining limit, keep all free cases
    const allowedNewCases = newCases.slice(0, newCasesToCharge);
    const cappedCaseNos = [...freeCases, ...allowedNewCases];
    const skipped = caseNos.length - cappedCaseNos.length;

    // Fetch all case data upfront in a single query
    const casesData = await sql`
      SELECT case_no, full_name, full_address, mobile
      FROM wifibizz_cases
      WHERE case_no = ANY(${cappedCaseNos}) AND user_id = ${wifibizzUserId}
    `;

    const caseDataMap = new Map(
      casesData.map((c) => [
        c.case_no,
        {
          case_no: c.case_no as string,
          full_name: c.full_name as string,
          full_address: c.full_address as string,
          mobile: c.mobile as string,
        },
      ])
    );

    const r2Prefix = billType === "utility" ? "utility_bill" : "internet_bill";
    const newCaseSet = new Set(allowedNewCases);

    const results: { caseNo: string; status: string; url?: string; error?: string }[] = [];

    async function processCase(caseNo: string) {
      const caseData = caseDataMap.get(caseNo);
      if (!caseData) {
        return { caseNo, status: "error", error: "Case not found or not owned" };
      }

      try {
        // Generate PDF using TypeScript bill generator
        const pdfBuffer = billType === "utility"
          ? await generateUtilityBill(caseData)
          : await generateInternetBill(caseData);

        const r2Key = `bills/${wifibizzUserId}/${caseNo}/${r2Prefix}.pdf`;
        const publicUrl = await uploadToR2(r2Key, pdfBuffer, "application/pdf");

        if (billType === "utility") {
          await sql`
            UPDATE wifibizz_cases
            SET utility_bill_url = ${publicUrl}
            WHERE case_no = ${caseNo} AND user_id = ${wifibizzUserId}
          `;
        } else {
          await sql`
            UPDATE wifibizz_cases
            SET internet_bill_url = ${publicUrl}
            WHERE case_no = ${caseNo} AND user_id = ${wifibizzUserId}
          `;
        }

        // Log usage if this is a newly charged case (first bill for this case)
        if (newCaseSet.has(caseNo)) {
          const caseName = caseStatusMap.get(caseNo)?.fullName ?? caseData.full_name;
          await prisma.caseUsageLog.create({
            data: {
              userId: session!.user!.id!,
              caseNo,
              caseName,
              billType,
            },
          });
        }

        return { caseNo, status: "success", url: publicUrl } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error(`Bill generation failed for ${caseNo}:`, message);
        return { caseNo, status: "error", error: message } as const;
      }
    }

    // Process cases concurrently in chunks of 5
    const CONCURRENCY = 5;
    for (let i = 0; i < cappedCaseNos.length; i += CONCURRENCY) {
      const chunk = cappedCaseNos.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processCase));
      results.push(...chunkResults);
    }

    const successCount = results.filter((r) => r.status === "success").length;

    return NextResponse.json({
      success: true,
      generated: successCount,
      total: caseNos.length,
      skipped,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Bill generation error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

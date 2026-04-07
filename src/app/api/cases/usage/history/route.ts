import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { getUserCaseUsage } from "@/lib/case-limit";

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
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");
    const search = url.searchParams.get("search")?.trim() ?? "";
    const chartDays = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 90);
    const fromDate = url.searchParams.get("from") ?? "";
    const toDate = url.searchParams.get("to") ?? "";

    // Build where clause with optional search
    const where: Record<string, unknown> = { userId: session.user.id };
    if (search) {
      where.OR = [
        { caseNo: { contains: search, mode: "insensitive" } },
        { caseName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.caseUsageLog.findMany({
        where,
        orderBy: { chargedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.caseUsageLog.count({ where }),
    ]);

    // Get bill URLs for each case to show which bills are generated
    const caseNos = logs.map((l) => l.caseNo);
    let billStatusMap: Map<string, { internet: boolean; utility: boolean }> = new Map();

    if (caseNos.length > 0) {
      const wifibizzUser = await prisma.wifibizzUser.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });

      if (wifibizzUser) {
        const sql = neon(process.env.DATABASE_URL!);
        const billRows = await sql`
          SELECT case_no, internet_bill_url, utility_bill_url
          FROM wifibizz_cases
          WHERE case_no = ANY(${caseNos}) AND user_id = ${wifibizzUser.id}
        `;
        billStatusMap = new Map(
          billRows.map((r) => [
            r.case_no as string,
            {
              internet: r.internet_bill_url != null,
              utility: r.utility_bill_url != null,
            },
          ])
        );
      }
    }

    // Determine chart date range from from/to or days preset
    let chartStart: Date;
    let chartEnd: Date;
    if (fromDate && toDate) {
      chartStart = new Date(fromDate + "T00:00:00");
      chartEnd = new Date(toDate + "T23:59:59");
    } else if (fromDate) {
      chartStart = new Date(fromDate + "T00:00:00");
      chartEnd = new Date();
    } else {
      chartStart = new Date();
      chartStart.setDate(chartStart.getDate() - chartDays);
      chartEnd = new Date();
    }

    // Get ALL usage logs up to chartEnd to compute cumulative usage
    const allLogsBeforeEnd = await prisma.caseUsageLog.findMany({
      where: {
        userId: session.user.id,
        chargedAt: { lte: chartEnd },
      },
      select: { chargedAt: true },
      orderBy: { chargedAt: "asc" },
    });

    // Count usage before chart start (for cumulative baseline)
    let cumulativeBefore = 0;
    const dailyMap = new Map<string, number>();
    for (const log of allLogsBeforeEnd) {
      const day = log.chargedAt.toISOString().slice(0, 10);
      if (log.chargedAt < chartStart) {
        cumulativeBefore++;
      } else {
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
      }
    }

    // Usage summary
    const usage = await getUserCaseUsage(session.user.id);

    // Get limit changes for building limit timeline
    const limitChanges = await prisma.caseLimitChangeLog.findMany({
      where: { userId: session.user.id },
      orderBy: { changedAt: "asc" },
    });

    // Build dual-axis chart data: cumulative usage, limit, percentage
    let currentLimit = limitChanges.length > 0 ? limitChanges[0].previousLimit : usage.limit;
    let changeIdx = 0;
    let cumulativeUsage = cumulativeBefore;

    const dualAxisChart: { date: string; usage: number; limit: number; percentage: number }[] = [];
    const totalDays = Math.ceil((chartEnd.getTime() - chartStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(chartStart);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);

      // Apply limit changes
      while (changeIdx < limitChanges.length && limitChanges[changeIdx].changedAt.toISOString().slice(0, 10) <= key) {
        currentLimit = limitChanges[changeIdx].newLimit;
        changeIdx++;
      }

      cumulativeUsage += dailyMap.get(key) ?? 0;
      const pct = currentLimit > 0 ? Math.round((cumulativeUsage / currentLimit) * 100) : 0;

      dualAxisChart.push({ date: key, usage: cumulativeUsage, limit: currentLimit, percentage: pct });
    }

    // Limit change log for purchase history section
    const limitChangeLog = await prisma.caseLimitChangeLog.findMany({
      where: { userId: session.user.id },
      orderBy: { changedAt: "desc" },
    });

    return NextResponse.json({
      data: logs.map((l) => {
        const bills = billStatusMap.get(l.caseNo);
        return {
          caseNo: l.caseNo,
          caseName: l.caseName,
          billType: l.billType,
          hasInternet: bills?.internet ?? false,
          hasUtility: bills?.utility ?? false,
          chargedAt: l.chargedAt.toISOString(),
        };
      }),
      total,
      limit,
      offset,
      dualAxisChart,
      usage: {
        casesUsed: usage.casesUsed,
        limit: usage.limit,
        remaining: usage.remaining,
        internetBills: usage.internetBills,
        utilityBills: usage.utilityBills,
        totalCases: usage.totalCases,
      },
      limitChangeLog: limitChangeLog.map((l) => ({
        previousLimit: l.previousLimit,
        newLimit: l.newLimit,
        changedBy: l.changedBy,
        reason: l.reason,
        changedAt: l.changedAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Usage history error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

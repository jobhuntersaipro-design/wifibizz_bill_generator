import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getUserCaseUsage } from "@/lib/case-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const isAdmin = await verifyAdminSession();
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { userId } = await params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const [usageLogs, limitChangeLogs, caseUsage] = await Promise.all([
      prisma.caseUsageLog.findMany({
        where: { userId },
        orderBy: { chargedAt: "desc" },
      }),
      prisma.caseLimitChangeLog.findMany({
        where: { userId },
        orderBy: { changedAt: "desc" },
      }),
      getUserCaseUsage(userId),
    ]);

    return NextResponse.json({
      summary: {
        casesUsed: caseUsage.casesUsed,
        limit: caseUsage.limit,
        remaining: caseUsage.remaining,
        internetBills: caseUsage.internetBills,
        utilityBills: caseUsage.utilityBills,
      },
      usageLog: usageLogs.map((l) => ({
        caseNo: l.caseNo,
        caseName: l.caseName,
        billType: l.billType,
        chargedAt: l.chargedAt.toISOString(),
      })),
      limitChangeLog: limitChangeLogs.map((l) => ({
        previousLimit: l.previousLimit,
        newLimit: l.newLimit,
        changedBy: l.changedBy,
        reason: l.reason,
        changedAt: l.changedAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Admin usage history error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

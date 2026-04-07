import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserCaseUsage } from "@/lib/case-limit";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const usage = await getUserCaseUsage(session.user.id);

    return NextResponse.json({
      casesUsed: usage.casesUsed,
      limit: usage.limit,
      remaining: usage.remaining,
      internetBills: usage.internetBills,
      utilityBills: usage.utilityBills,
      totalCases: usage.totalCases,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Usage fetch error:", message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

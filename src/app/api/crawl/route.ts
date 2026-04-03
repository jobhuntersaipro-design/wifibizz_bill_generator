import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crawl } from "@/lib/crawler/scraper";
import { upsertUser, upsertCases, updateLastCrawl } from "@/lib/crawler/db";
import { getUserCaseUsage } from "@/lib/case-limit";

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
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Check case limit before crawling
    const usage = await getUserCaseUsage(session.user.id);
    if (usage.isAtLimit) {
      return NextResponse.json(
        {
          success: false,
          error: "case_limit_reached",
          current: usage.current,
          limit: usage.limit,
        },
        { status: 403 }
      );
    }

    // Upsert user with encrypted credentials
    const user = await upsertUser(email, password);

    // Crawl WifiBizz for activated cases
    const { activatedCases } = await crawl(email, password);

    // Only insert up to remaining slots
    const casesToInsert = activatedCases.slice(0, usage.remaining);
    const skipped = activatedCases.length - casesToInsert.length;

    // Save cases to database
    const saved = await upsertCases(user.id, casesToInsert);

    // Update last crawl timestamp
    await updateLastCrawl(user.id);

    return NextResponse.json({
      success: true,
      activated: activatedCases.length,
      saved,
      skipped,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Crawl error:", message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

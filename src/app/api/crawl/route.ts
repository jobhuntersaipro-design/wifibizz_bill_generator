import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crawl } from "@/lib/crawler/scraper";
import { upsertCases, updateLastCrawl, decryptUserPassword } from "@/lib/crawler/db";
import { getUserCaseUsage } from "@/lib/case-limit";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get WifiBizz credentials from DB
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
    });

    if (!wifibizzUser) {
      return NextResponse.json(
        {
          success: false,
          error: "no_credentials",
          message: "Set your WifiBizz credentials in Settings first.",
        },
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

    // Decrypt password and crawl
    const password = decryptUserPassword({
      id: wifibizzUser.id,
      wifibizz_email: wifibizzUser.wifibizzEmail,
      wifibizz_password_enc: wifibizzUser.wifibizzPasswordEnc,
      last_crawl_at: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
    });

    const { cases } = await crawl(wifibizzUser.wifibizzEmail, password);

    // Only insert up to remaining slots
    const casesToInsert = cases.slice(0, usage.remaining);
    const skipped = cases.length - casesToInsert.length;

    // Save cases to database
    const saved = await upsertCases(wifibizzUser.id, casesToInsert);

    // Update last crawl timestamp
    await updateLastCrawl(wifibizzUser.id);

    return NextResponse.json({
      success: true,
      total: cases.length,
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

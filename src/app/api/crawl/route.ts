import { NextResponse } from "next/server";
import { crawl } from "@/lib/crawler/scraper";
import { upsertUser, upsertCases, updateLastCrawl } from "@/lib/crawler/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Upsert user with encrypted credentials
    const user = await upsertUser(email, password);

    // Crawl WifiBizz for activated cases
    const { activatedCases } = await crawl(email, password);

    // Save cases to database
    const saved = await upsertCases(user.id, activatedCases);

    // Update last crawl timestamp
    await updateLastCrawl(user.id);

    return NextResponse.json({
      success: true,
      activated: activatedCases.length,
      saved,
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

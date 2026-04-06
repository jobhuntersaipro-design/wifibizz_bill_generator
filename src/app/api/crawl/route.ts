import { auth } from "@/auth";
import { crawl, type CrawlProgress } from "@/lib/crawler/scraper";
import { upsertCases, updateLastCrawl, getUserPassword } from "@/lib/crawler/db";
import { getUserCaseUsage } from "@/lib/case-limit";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
    });

    if (!wifibizzUser) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "no_credentials",
          message: "Set your WifiBizz credentials in Settings first.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const usage = await getUserCaseUsage(session.user.id);
    if (usage.isAtLimit) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "case_limit_reached",
          current: usage.current,
          limit: usage.limit,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse date filter from query params
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("date_from") || undefined;
    const dateTo = url.searchParams.get("date_to") || undefined;

    const password = getUserPassword({
      id: wifibizzUser.id,
      wifibizz_email: wifibizzUser.wifibizzEmail,
      wifibizz_password_enc: wifibizzUser.wifibizzPasswordEnc,
      last_crawl_at: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(type: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, ...data as object })}\n\n`)
          );
        }

        try {
          const { cases } = await crawl(
            wifibizzUser.wifibizzEmail,
            password,
            (progress: CrawlProgress) => {
              sendEvent("progress", progress);
            },
            { dateFrom, dateTo }
          );

          const casesToInsert = cases.slice(0, usage.remaining);
          const skipped = cases.length - casesToInsert.length;

          sendEvent("progress", {
            step: "Saving to database...",
            current: 0,
            total: 0,
            percent: 97,
          });

          const saved = await upsertCases(wifibizzUser.id, casesToInsert);
          await updateLastCrawl(wifibizzUser.id);

          sendEvent("done", {
            success: true,
            total: cases.length,
            saved,
            skipped,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          sendEvent("error", { error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Crawl error:", message);

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

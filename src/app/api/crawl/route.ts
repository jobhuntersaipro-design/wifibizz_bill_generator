import { auth } from "@/auth";
import { crawl, type CrawlProgress } from "@/lib/crawler/scraper";
import { upsertCases, updateLastCrawl, getUserPassword } from "@/lib/crawler/db";
import { prisma } from "@/lib/prisma";
import { appendCasesToSheet, getSheetCaseNumbers } from "@/lib/google-sheets";

// Large accounts have many Activated/Pending cases; give the crawl room to finish
// (Vercel caps this at the plan max — Hobby 60s, Pro 300s).
export const maxDuration = 300;

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

    // Parse date filter from query params
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("date_from") || undefined;
    const dateTo = url.searchParams.get("date_to") || undefined;

    const perUserPassword = getUserPassword({
      id: wifibizzUser.id,
      wifibizz_email: wifibizzUser.wifibizzEmail,
      wifibizz_password_enc: wifibizzUser.wifibizzPasswordEnc,
      last_crawl_at: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
    });

    // SHARED crawl account: every enabled user (i.e. one the admin gave WifiBizz
    // credentials to, so `wifibizzUser` exists) crawls with the SAME WifiBizz
    // account, regardless of which BizzFlow email they signed in with. Configure
    // it via WIFIBIZZ_CRAWL_EMAIL / WIFIBIZZ_CRAWL_PASSWORD; falls back to the
    // per-user stored creds when the shared env isn't set.
    const crawlEmail = process.env.WIFIBIZZ_CRAWL_EMAIL || wifibizzUser.wifibizzEmail;
    const password = process.env.WIFIBIZZ_CRAWL_PASSWORD || perUserPassword;

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
            crawlEmail,
            password,
            (progress: CrawlProgress) => {
              sendEvent("progress", progress);
            },
            { dateFrom, dateTo }
          );

          sendEvent("progress", {
            step: "Saving to database...",
            current: 0,
            total: 0,
            percent: 97,
          });

          const { inserted, updated } = await upsertCases(wifibizzUser.id, cases);
          await updateLastCrawl(wifibizzUser.id);

          // Auto-sync to Google Sheet if configured
          let sheetSynced = 0;
          if (wifibizzUser.googleSheetId) {
            try {
              // Check for rows manually deleted from sheet
              const sheetCaseNos = await getSheetCaseNumbers(wifibizzUser.googleSheetId);
              const syncedCases = await prisma.wifibizzCase.findMany({
                where: { userId: wifibizzUser.id, syncedToSheetAt: { not: null } },
                select: { id: true, caseNo: true },
              });
              const missingIds = syncedCases
                .filter((c) => !sheetCaseNos.has(c.caseNo))
                .map((c) => c.id);
              if (missingIds.length > 0) {
                await prisma.wifibizzCase.updateMany({
                  where: { id: { in: missingIds } },
                  data: { syncedToSheetAt: null },
                });
              }

              const unsyncedCases = await prisma.wifibizzCase.findMany({
                where: { userId: wifibizzUser.id, syncedToSheetAt: null },
                orderBy: { caseCreatedAt: "asc" },
              });
              if (unsyncedCases.length > 0) {
                const { appendedRows } = await appendCasesToSheet(
                  wifibizzUser.googleSheetId,
                  unsyncedCases
                );
                sheetSynced = appendedRows;
                await prisma.wifibizzCase.updateMany({
                  where: { id: { in: unsyncedCases.map((c) => c.id) } },
                  data: { syncedToSheetAt: new Date() },
                });
              }
            } catch (sheetErr) {
              console.error("Auto-sync to sheet failed:", sheetErr);
            }
          }

          sendEvent("done", {
            success: true,
            total: cases.length,
            saved: inserted + updated,
            inserted,
            updated,
            sheetSynced,
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

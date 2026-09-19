import { auth } from "@/auth";
import {
  crawl,
  type CrawlCursor,
  type CrawlProgress,
} from "@/lib/crawler/scraper";
import { upsertCases, updateLastCrawl, getUserPassword, casesNeedingDetail } from "@/lib/crawler/db";
import { prisma } from "@/lib/prisma";
import { appendCasesToSheet, getSheetCaseNumbers, updateSheetAddresses } from "@/lib/google-sheets";
import {
  CRAWL_LOOKBACK_MONTHS,
  isCrawlDateInLookback,
} from "@/lib/crawler/date-window";

// Large accounts have many Activated/Pending cases; give the crawl room to finish
// (Vercel caps this at the plan max — Hobby 60s, Pro 300s).
export const maxDuration = 300;

// Stop fetching with enough of the budget left to finish the last save and answer.
// A 12-month window on a big account is ~42k rows and CANNOT fit in one invocation,
// so a pass that runs out of time saves what it has and hands back a cursor; the
// crawl page then calls straight back to resume. Nothing fetched is ever discarded.
// Tunable without a deploy: portal speed varies a lot (measured between 7 ms and
// 15 ms per row on the same account hours apart), so the number of passes a window
// needs is not fixed. Lower it if the platform cap ever tightens.
const PASS_BUDGET_MS = Number(process.env.CRAWL_PASS_BUDGET_MS) || 220_000;

// Headroom for the Google Sheet backfill on the final pass, so it cannot run past
// the platform cap and kill the function before the client is told the crawl is done.
const SHEET_SYNC_BUDGET_MS = 45_000;

/** Thrown to bail out of the sheet backfill when its budget is spent (not an error). */
class SheetBudgetSpent extends Error {}

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

    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("date_from") || undefined;
    const dateTo = url.searchParams.get("date_to") || undefined;
    const now = new Date();
    if (dateFrom && !isCrawlDateInLookback(dateFrom, now)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `From date cannot be older than ${CRAWL_LOOKBACK_MONTHS} months`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (dateTo && !isCrawlDateInLookback(dateTo, now)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `To date cannot be older than ${CRAWL_LOOKBACK_MONTHS} months`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resume point handed back by the previous pass (see PASS_BUDGET_MS).
    const moduleIndexRaw = url.searchParams.get("cursor_module");
    const startRaw = url.searchParams.get("cursor_start");
    let cursor: CrawlCursor | null = null;
    if (moduleIndexRaw !== null && startRaw !== null) {
      const moduleIndex = Number(moduleIndexRaw);
      const start = Number(startRaw);
      if (
        !Number.isInteger(moduleIndex) || moduleIndex < 0 ||
        !Number.isInteger(start) || start < 0
      ) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid crawl cursor" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      cursor = { moduleIndex, start };
    }
    const fetchedSoFar = Math.max(0, Number(url.searchParams.get("fetched") ?? 0) || 0);

    const perUserPassword = getUserPassword({
      id: wifibizzUser.id,
      wifibizz_email: wifibizzUser.wifibizzEmail,
      wifibizz_password_enc: wifibizzUser.wifibizzPasswordEnc,
      last_crawl_at: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
    });

    // Role-based: each user crawls with THEIR OWN WifiBizz account, so the WifiBizz
    // portal scopes the results to their role — a regular agent sees only their own
    // cases, not everyone's. (The WifiBizz superadmin account sees all cases; the
    // crawler bounds it to the recent window so it no longer hangs / fails to fetch.)
    const crawlEmail = wifibizzUser.wifibizzEmail;
    const password = perUserPassword;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(type: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, ...data as object })}\n\n`)
          );
        }

        try {
          // Saved incrementally, as each page arrives.
          let inserted = 0;
          let updated = 0;

          const outcome = await crawl(
            crawlEmail,
            password,
            (progress: CrawlProgress) => {
              sendEvent("progress", progress);
            },
            {
              dateFrom,
              dateTo,
              cursor,
              fetchedSoFar,
              deadline: Date.now() + PASS_BUDGET_MS,
              onBatch: async (batch) => {
                if (batch.length === 0) return;
                const r = await upsertCases(wifibizzUser.id, batch);
                inserted += r.inserted;
                updated += r.updated;
              },
              // Business cases carry two fields the list row cannot supply (the
              // director's name and the installation address), each costing one
              // detail-page request. Only rows that still lack them are fetched,
              // so the first crawl backfills and later ones cost nothing.
              needsDetail: async (candidates) =>
                casesNeedingDetail(
                  wifibizzUser.id,
                  candidates.map((c) => c.case_no),
                ),
            }
          );

          if (!outcome.complete) {
            // Out of time, not out of data. Everything fetched this pass is already
            // in the database; the page resumes from the cursor.
            sendEvent("done", {
              success: true,
              complete: false,
              nextCursor: outcome.nextCursor,
              fetched: fetchedSoFar + outcome.fetched,
              total: fetchedSoFar + outcome.fetched,
              saved: inserted + updated,
              inserted,
              updated,
              oldestSeen: outcome.oldestSeen,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          sendEvent("progress", {
            step: "Finishing up…",
            current: 0,
            total: 0,
            percent: 97,
          });

          await updateLastCrawl(wifibizzUser.id);

          // Auto-sync to Google Sheet if configured. Bounded, so a big backlog can
          // never eat the headroom this pass needs to answer the client.
          const sheetDeadline = Date.now() + SHEET_SYNC_BUDGET_MS;
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

              // Append in chunks, marking each one synced as it lands. A 12-month
              // crawl can leave tens of thousands of unsynced rows, and one append
              // that large would risk both the Sheets request limit and the rest of
              // this function's time budget. Anything not reached stays unsynced and
              // is picked up by the next crawl — the marker already works that way.
              const SHEET_CHUNK = 2000;
              for (let i = 0; i < unsyncedCases.length; i += SHEET_CHUNK) {
                if (Date.now() > sheetDeadline) break;
                const part = unsyncedCases.slice(i, i + SHEET_CHUNK);
                const { appendedRows } = await appendCasesToSheet(
                  wifibizzUser.googleSheetId,
                  part
                );
                sheetSynced += appendedRows;
                await prisma.wifibizzCase.updateMany({
                  where: { id: { in: part.map((c) => c.id) } },
                  data: { syncedToSheetAt: new Date() },
                });
              }

              // Backfill addresses filled since the last sync (e.g. at bill time)
              // into already-synced rows — append-only never updates those cells.
              // Skipped if the append already used the budget; the next crawl redoes it.
              if (Date.now() > sheetDeadline) throw new SheetBudgetSpent();
              const withAddress = await prisma.wifibizzCase.findMany({
                where: {
                  userId: wifibizzUser.id,
                  syncedToSheetAt: { not: null },
                  fullAddress: { not: null },
                  NOT: { fullAddress: "" },
                },
                select: { caseNo: true, fullAddress: true },
              });
              await updateSheetAddresses(wifibizzUser.googleSheetId, withAddress);
            } catch (sheetErr) {
              if (sheetErr instanceof SheetBudgetSpent) {
                console.warn("Sheet sync ran out of budget; the next crawl continues it.");
              } else {
                console.error("Auto-sync to sheet failed:", sheetErr);
              }
            }
          }

          sendEvent("done", {
            success: true,
            complete: true,
            nextCursor: null,
            fetched: fetchedSoFar + outcome.fetched,
            total: fetchedSoFar + outcome.fetched,
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

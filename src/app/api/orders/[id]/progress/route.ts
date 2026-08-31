/**
 * Live progress for one in-flight order submit.
 *
 * The browser polls this while a row is submitting. Each call advances the
 * order's persisted stage and, once the scraper's job finishes, writes the
 * final status — so the run is finalized by whoever polls, not by whoever
 * started it. That is what makes closing the tab mid-submit survivable.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_ORDER } from "@/lib/order-scope";
import { pollOrderProgress } from "@/lib/order-submit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Same visibility rule as submitting: superadmins may follow any order, and
  // everyone else only their own.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true },
  });
  const order = await prisma.order.findFirst({
    where: me?.isSuperAdmin ? { id, ...ACTIVE_ORDER } : { id, userId: session.user.id, ...ACTIVE_ORDER },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const state = await pollOrderProgress(id);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Read the retry claim back AFTER the poll, because the poll is what writes
  // it. Without this the browser learns the run failed and nothing else — so
  // the row would paint Failed with a live Submit button for the seconds before
  // the next full list load, which is precisely the window that invites a
  // second run against an order already queued to be retried.
  const retry = await prisma.order.findUnique({
    where: { id },
    select: { autoRetries: true, autoRetryAt: true },
  });

  // The watcher's own browser receiving the terminal state IS the seeing, so
  // the badge never counts an outcome the agent watched happen. Conditional on
  // NULL so a later poll cannot move the timestamp, and never stamped for a
  // non-terminal state — an in-flight run has no outcome to have seen. The
  // webhook path stamps nothing: it fires with the tab closed, which is exactly
  // the case the unseen badge exists for.
  if (state.status === "submitted" || state.status === "failed" || state.status === "warning") {
    await prisma.order.updateMany({
      where: { id, outcomeSeenAt: null },
      data: { outcomeSeenAt: new Date() },
    });
  }

  return NextResponse.json({
    ...state,
    autoRetries: retry?.autoRetries ?? 0,
    autoRetryAt: retry?.autoRetryAt ? retry.autoRetryAt.toISOString() : null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

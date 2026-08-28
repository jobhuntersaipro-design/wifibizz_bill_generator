import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pollOrderProgress } from "@/lib/order-submit";
import { finishBatch, retryFailedMembers } from "@/lib/batch-submit";
import { maybeAutoRetry } from "@/lib/order-retry";
import { notifyBatchResult, notifyOrderResult } from "@/lib/notifications/send";

/**
 * The droplet telling BizzFlow that a run finished.
 *
 * An API route rather than a Server Action because the caller is a specific
 * machine presenting a bearer token — Server Actions authenticate a browser
 * session, which the scraper does not have.
 *
 * This, NOT the browser poll, is what triggers every notification email. The
 * browser poll remains the UI's source of progress and is unchanged; putting
 * the send here is what makes an email arrive when the tab was closed, which
 * is the whole reason the batch moved off the browser in the first place.
 */

const SECRET = process.env.SCRAPER_WEBHOOK_SECRET ?? "";

export async function POST(req: Request) {
  if (!SECRET) {
    // Not configured is not "allowed" — an unauthenticated route here would let
    // anyone on the internet trigger reconciliation and mail on real orders.
    console.error("[hooks/scraper] SCRAPER_WEBHOOK_SECRET is not set — refusing.");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    orderId?: string;
    batchId?: string;
  } | null;
  if (!body?.event) {
    return NextResponse.json({ error: "event_required" }, { status: 400 });
  }

  try {
    if (body.event === "order_finished") {
      // Keyed on BizzFlow's own order id, not the scraper job id: a browser poll
      // that finalized the run first has already cleared `Order.jobId`, and the
      // event would then match nothing and silently send no email.
      if (!body.orderId) {
        return NextResponse.json({ error: "orderId_required" }, { status: 400 });
      }
      const order = await prisma.order.findUnique({
        where: { id: body.orderId },
        select: { id: true },
      });
      if (!order) return NextResponse.json({ ok: true, skipped: "unknown_order" });
      // Safe to run twice — it short-circuits on an order already finalized.
      await pollOrderProgress(order.id);
      // The automatic retry lives HERE rather than in `applyResult`, which is
      // where the outcome is decided: that function is also called by the
      // browser's progress poll, and starting a portal run from inside a GET
      // would make an idle open tab a submit trigger. This handler is the one
      // caller that is server-only, fires exactly once per finished job, and
      // runs at the moment the droplet's single-browser lock is provably free.
      const retry = await maybeAutoRetry(order.id);
      // No email while another run is coming: the reader would be told an order
      // failed and then, minutes later, that it succeeded. The last try is the
      // one worth reporting.
      if (retry === "no") await notifyOrderResult(order.id);
      return NextResponse.json({ ok: true, retry });
    }

    if (body.event === "batch_finished") {
      if (!body.batchId) {
        return NextResponse.json({ error: "batchId_required" }, { status: 400 });
      }
      const batch = await prisma.batchRun.findUnique({
        where: { id: body.batchId },
        select: { id: true },
      });
      if (!batch) return NextResponse.json({ ok: true, skipped: "unknown_batch" });
      await finishBatch(batch.id);
      // The summary describes THIS run and is sent for it, as before. It is
      // deliberately not deferred the way a single order's email is: nothing
      // fires a second batch_finished for a member retried on its own, so
      // waiting would risk sending nothing at all. The retried members each get
      // their own result email when they settle, which is the more useful
      // message anyway — it carries the outcome that ended up mattering.
      await notifyBatchResult(batch.id);
      // Started only after the summary, and only now that the batch has released
      // the droplet's single browser: a member cannot retry while its own batch
      // still holds the lock.
      const retrying = await retryFailedMembers(batch.id);
      return NextResponse.json({ ok: true, retrying });
    }

    return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  } catch (e) {
    // A 500 makes the droplet redeliver. That is right for a genuine processing
    // failure — the reconcile is idempotent and the notify guard is exactly-once,
    // so a retry costs nothing and recovers a batch whose results were never
    // written.
    console.error("[hooks/scraper] handler failed:", e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";
import { pollOrderProgress } from "@/lib/order-submit";
import { caseDetailsFrom, type OrderOutcome } from "@/lib/notifications/outcomes";

/**
 * BizzFlow's half of a server-side batch submit.
 *
 * The loop itself runs on the droplet — one order at a time, in the order it was
 * given, never stopping on a failure — because a browser tab that closed
 * mid-batch used to strand every remaining draft with nobody told. What lives
 * here is the reconciliation: turning the member jobs into final Order rows and
 * a frozen per-order result list the summary email is built from.
 *
 * Every function here is safe to run twice. The webhook can be redelivered, the
 * UI polls the same batch every two seconds, and both land in these functions.
 */

/** The ids in a BatchRun.orderIds column, defensively parsed. */
export function batchOrderIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Poll every member order once and describe where each one landed.
 *
 * `pollOrderProgress` is the SAME function the browser's per-order poll and
 * `listOrders`'s reconcile use — deliberately, so a batch cannot invent a
 * second set of rules for deciding an order's final state. It short-circuits on
 * an order that is already terminal, so calling it here costs nothing for the
 * orders that finished earlier in the run.
 */
export async function reconcileBatch(batchRunId: string): Promise<{
  outcomes: OrderOutcome[];
  /** True when no member is still in flight. */
  allDone: boolean;
} | null> {
  const batch = await prisma.batchRun.findUnique({
    where: { id: batchRunId },
    select: { orderIds: true },
  });
  if (!batch) return null;

  const ids = batchOrderIds(batch.orderIds);
  const outcomes: OrderOutcome[] = [];
  let allDone = true;

  // Sequential, not Promise.all: each poll can hit the droplet, and firing ten
  // at once at a 1GB box that is mid-submit is how a reconcile turns into the
  // thing that wedges the run it was reporting on.
  for (const id of ids) {
    // Best-effort per order — one unreachable job must not lose the other nine.
    await pollOrderProgress(id).catch((e) =>
      console.error(`[batch] poll ${id} failed:`, e),
    );
    const o = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true, reference: true, fullName: true, status: true,
        orderId: true, errorCode: true, errorMessage: true,
        // Repeated back in the summary so a reader can act on a row without
        // opening the app. Frozen onto the BatchRun with the rest of the
        // result: an order edited afterwards must not rewrite what was sent.
        idType: true, idNumber: true, mobilePrefix: true, mobile: true,
        email: true, street: true, offerName: true, deviceName: true,
        installationDate: true, attempt: true,
      },
    });
    // A member deleted mid-run: recorded as gone rather than dropped, so the
    // summary's count still matches the number of orders the agent selected.
    if (!o) {
      outcomes.push({
        orderId: id, reference: null, fullName: "(deleted)", status: "failed",
        portalOrderNo: null, errorCode: null,
        errorMessage: "This order was deleted while the batch was running.",
      });
      continue;
    }
    if (o.status === "submitting") allDone = false;
    outcomes.push({
      orderId: o.id,
      reference: o.reference,
      fullName: o.fullName,
      status: o.status,
      portalOrderNo: o.orderId,
      errorCode: o.errorCode,
      errorMessage: o.errorMessage,
      details: caseDetailsFrom(o),
      tries: o.attempt,
    });
  }
  return { outcomes, allDone };
}

/**
 * Close a batch out: freeze its results and mark it finished.
 *
 * The results are DENORMALISED onto the row on purpose. The summary email
 * describes the run as it happened, and an order edited, resubmitted or deleted
 * after the fact must not be able to rewrite what the agent was told.
 *
 * Idempotent: the status flip is conditional on `running`, so a redelivered
 * webhook re-reconciles (harmless) and does not move `finishedAt`.
 */
export async function finishBatch(
  batchRunId: string,
  opts: { errorMessage?: string } = {},
): Promise<void> {
  const reconciled = await reconcileBatch(batchRunId);
  if (!reconciled) return;
  await prisma.batchRun.updateMany({
    where: { id: batchRunId, status: "running" },
    data: {
      status: "finished",
      finishedAt: new Date(),
      results: reconciled.outcomes as unknown as object,
      ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    },
  });
  // Refreshed even on a redelivery, but only while the summary is still unsent:
  // a member that was `submitting` at first delivery now has a real outcome, and
  // a summary listing it as unfinished would be wrong about a real portal order.
  // Once notified, the results are frozen — they are what the reader was told.
  await prisma.batchRun.updateMany({
    where: { id: batchRunId, status: "finished", notifiedAt: null },
    data: { results: reconciled.outcomes as unknown as object },
  });
}

/**
 * Offer every failed member of a finished batch an automatic retry.
 *
 * A member cannot retry while its own batch is still running: the droplet drives
 * ONE browser and holds that lock for the whole batch, so an in-flight retry
 * would only collect a 409. They are therefore collected here, once the batch
 * has released it.
 *
 * Returns how many were started, so the caller knows whether the summary email
 * is still the final word on this run.
 */
export async function retryFailedMembers(batchRunId: string): Promise<number> {
  const batch = await prisma.batchRun.findUnique({
    where: { id: batchRunId },
    select: { orderIds: true },
  });
  if (!batch) return 0;

  // Lazily imported: order-retry reaches back into the submit path, and a static
  // import here would close a module cycle through order-submit.
  const { maybeAutoRetry } = await import("@/lib/order-retry");

  let started = 0;
  // Sequential and one at a time, for the same reason the batch itself is: the
  // first retry to be accepted takes the browser, and the rest are deferred by
  // their own 409 handling rather than by anything here.
  for (const id of batchOrderIds(batch.orderIds)) {
    const outcome = await maybeAutoRetry(id).catch((e) => {
      console.error(`[batch] retry ${id} failed:`, e);
      return "no" as const;
    });
    if (outcome !== "no") started++;
  }
  return started;
}

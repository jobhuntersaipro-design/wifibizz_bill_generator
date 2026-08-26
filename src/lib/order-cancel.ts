/**
 * Finalizing an in-flight PORTAL CANCEL.
 *
 * The mirror of order-submit.ts, deliberately smaller. A portal cancel runs
 * against a SUBMITTED order: `startPortalCancel` moves it to the transient
 * "cancelling" status (so the row shows the live checklist exactly as a submit
 * does), and this poll decides the terminal state:
 *
 *   - the portal CONFIRMED  → "cancelled". This is the only path to cancelled;
 *     nothing is marked cancelled until Unifi's own screen showed it.
 *   - anything else         → back to "submitted". A failed or unconfirmed
 *     cancel leaves a live portal record, and "failed" would re-enable Submit
 *     against an order the portal already holds as paid.
 *
 * The job id rides the same `Order.jobId` column the submit uses: an order in
 * "cancelling" is the only kind that carries a cancel job, so the two flows
 * can never read each other's jobs. Everything here must be safe to run twice
 * on the same job — the row's follow loop can race the reconcile in listOrders.
 */
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/order-history";
import {
  drainStages,
  fetchJob,
  type ProgressState,
} from "@/lib/order-submit";
import { movesStagePointer, submitErrorCopy } from "@/lib/order-types";

const CANCEL_LOST_MSG =
  "The cancel run was lost (the order service restarted). Check the order in " +
  "the portal before treating it as cancelled — it may or may not have gone through.";

/**
 * Poll one in-flight portal cancel once and persist whatever changed.
 *
 * Returns the same ProgressState shape as pollOrderProgress, so the progress
 * route, the row's follow loop and the detail page drive both runs through one
 * pipeline.
 */
export async function pollCancelProgress(id: string): Promise<ProgressState | null> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return null;

  const current: ProgressState = {
    status: order.status,
    stage: order.stage,
    orderId: order.orderId,
    errorMessage: order.errorMessage,
    errorCode: order.errorCode,
    done: order.status !== "cancelling",
  };
  // Not cancelling (or already finalized by a concurrent poll) — nothing to do.
  if (order.status !== "cancelling" || !order.jobId) {
    // A "cancelling" row with no job can only mean a partial write; repair it
    // to submitted rather than leaving it transient forever.
    if (order.status === "cancelling" && !order.jobId) {
      const o = await prisma.order.update({
        where: { id },
        data: { status: "submitted", stage: null },
      });
      return { ...current, status: o.status, stage: o.stage, done: true };
    }
    return current;
  }

  const job = await fetchJob(order.jobId);
  // A network blip must not read as an outcome — keep polling.
  if (job === "unreachable") return { ...current, done: false };
  if (job === null) {
    await prisma.order.update({
      where: { id },
      data: { status: "submitted", stage: null, jobId: null },
    });
    await recordEvent({
      orderId: id, attempt: order.attempt, status: "warning",
      stage: null, message: CANCEL_LOST_MSG,
    });
    return { ...current, status: "submitted", errorMessage: CANCEL_LOST_MSG, done: true };
  }

  // Drain stage rows + captures into the trail BEFORE branching — a run can
  // finish between two polls, and the frames exist only in the job record.
  const { details } = await drainStages(id, order.attempt, job.stages, order.screenshotUrl);
  const withDetails = (s: ProgressState): ProgressState => ({ ...s, details });

  if (job.status === "error") {
    const msg = job.error || "The portal cancel run failed.";
    await prisma.order.update({
      where: { id },
      data: { status: "submitted", stage: null, jobId: null },
    });
    await recordEvent({
      orderId: id, attempt: order.attempt, status: "failed", stage: null, message: msg,
    });
    return withDetails({
      ...current, status: "submitted", stage: null, errorMessage: msg, done: true,
    });
  }

  if (job.status !== "done") {
    // Still running — move the stage pointer (milestones only, same rule as
    // pollOrderProgress: a capture stage must not read as a position).
    if (job.stage && job.stage !== order.stage && movesStagePointer(job.stage)) {
      const o = await prisma.order.update({
        where: { id },
        data: { stage: job.stage, stageAt: new Date() },
      });
      return withDetails({ ...current, stage: o.stage, done: false });
    }
    return withDetails({ ...current, done: false });
  }

  const result = job.result ?? {};
  if (result.status === "cancelled") {
    // The ONLY path to "cancelled": the portal's own screen showed the state.
    await prisma.order.update({
      where: { id },
      data: { status: "cancelled", stage: null, jobId: null },
    });
    await recordEvent({
      orderId: id, attempt: order.attempt, status: "cancelled", stage: null,
      message:
        `Cancelled at Unifi via the portal (order ${order.orderId ?? result.order_id ?? ""}). ` +
        (result.message ?? "") +
        " The confirmation and proof screenshots are on this attempt's timeline.",
    });
    return withDetails({
      ...current, status: "cancelled", stage: null, errorMessage: null, done: true,
    });
  }

  // The scraper classified the refusal. `cancel_unconfirmed` is the one code
  // where the portal MAY have acted — its event is a warning, the rest failed.
  const code = submitErrorCopy(result.error) ? result.error! : null;
  const msg = result.message || result.error || "The portal cancel did not complete.";
  await prisma.order.update({
    where: { id },
    data: { status: "submitted", stage: null, jobId: null },
  });
  await recordEvent({
    orderId: id, attempt: order.attempt,
    status: result.error === "cancel_unconfirmed" ? "warning" : "failed",
    stage: null, message: msg, errorCode: code,
  });
  return withDetails({
    ...current, status: "submitted", stage: null,
    errorMessage: msg, errorCode: code, done: true,
  });
}

/**
 * Reconcile cancels whose browser went away.
 *
 * Called from listOrders, same as reconcileStaleSubmits, so reopening the page
 * repairs them. No staleness window: polling a live cancel is harmless (the
 * poll is idempotent) and a cancel run is short.
 */
export async function reconcileStaleCancels(userId: string | null): Promise<void> {
  const stale = await prisma.order.findMany({
    where: {
      status: "cancelling",
      ...(userId ? { userId } : {}),
    },
    select: { id: true },
    take: 10,
  });
  await Promise.allSettled(stale.map((o) => pollCancelProgress(o.id)));
}

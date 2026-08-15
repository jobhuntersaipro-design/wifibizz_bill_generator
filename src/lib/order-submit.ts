/**
 * Finalizing an in-flight order submit.
 *
 * A submit is a long portal run (minutes) owned by the Flask scraper. BizzFlow
 * starts it, gets a job id back, and then *polls*: the browser polls the
 * progress route while it is open, and `listOrders` reconciles anything left
 * behind when it is not. Both paths land here, so the rules that decide an
 * order's final state live in exactly one place and cannot drift apart.
 *
 * Everything here must be safe to run twice on the same job — two polls can
 * overlap, and reconciliation can race a live poll.
 */
import { prisma } from "@/lib/prisma";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
const ORDER_TOKEN = process.env.ORDER_ENTRY_API_TOKEN ?? "";

export interface OrderJobResult {
  status?: string;
  order_id?: string;
  order_url?: string;
  advance_payment?: string;
  warning?: string;
  error?: string;
  message?: string;
}

export interface JobSnapshot {
  status?: string; // queued | running | done | error
  stage?: string;
  result?: OrderJobResult;
  error?: string;
}

/** What a poll concluded, for the caller to hand back to the browser. */
export interface ProgressState {
  status: string; // the order's status AFTER this poll
  stage: string | null;
  orderId: string | null;
  errorMessage: string | null;
  done: boolean; // no further polling needed
}

/**
 * Read a job from the scraper.
 *
 * `null` means the job is GONE, not that the request failed — the Flask job
 * registry is in-memory, so a scraper restart erases every in-flight job. That
 * is a distinct outcome from a network blip and the caller must treat it as
 * such (see finalizeMissingJob).
 */
async function fetchJob(jobId: string): Promise<JobSnapshot | null | "unreachable"> {
  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs/${jobId}`, {
      headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      // Node's fetch has NO default timeout. Without this a slow or wedged
      // scraper would hang whoever is polling — including `listOrders`, which
      // reconciles before it returns, so the whole drafts list would stall on an
      // unreachable droplet. Reading a job is an in-memory dict lookup; if it
      // hasn't answered in 5s the service is not healthy.
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return "unreachable";
    return (await res.json()) as JobSnapshot;
  } catch {
    return "unreachable";
  }
}

/**
 * Turn a finished job's result into the order's final state.
 *
 * The order of these branches matters. An `error` that still carries an
 * order_id means the portal DID mint the order before failing — persisting that
 * id is what stops a retry from creating a duplicate, so it must be checked
 * before the plain-failure path.
 */
async function applyResult(
  orderId: string,
  result: OrderJobResult,
): Promise<ProgressState> {
  const finish = async (data: {
    status: string;
    orderId?: string | null;
    errorMessage?: string | null;
  }): Promise<ProgressState> => {
    const o = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: data.status,
        ...(data.orderId !== undefined ? { orderId: data.orderId } : {}),
        errorMessage: data.errorMessage ?? null,
        jobId: null, // the run is over — nothing left to reconcile
      },
    });
    return {
      status: o.status,
      stage: o.stage,
      orderId: o.orderId,
      errorMessage: o.errorMessage,
      done: true,
    };
  };

  // Full flow through Pay done ("submitted"), or the legacy order-id-only path.
  if ((result.status === "submitted" || result.status === "success") && result.order_id) {
    const ap = result.advance_payment
      ? `Advance Payment RM${result.advance_payment} was required.`
      : null;
    const note = [result.warning, ap].filter(Boolean).join(" ") || null;
    return finish({ status: "submitted", orderId: result.order_id, errorMessage: note });
  }

  if (result.status === "error") {
    if (result.order_id) {
      // Order EXISTS in the portal despite the failure. Surface as a warning to
      // verify/complete by hand — a plain "failed" would re-enable submit and
      // invite a duplicate.
      const msg = `Order ${result.order_id} was created but the flow didn't finish: ${
        result.message || result.error || "error"
      }. Verify in the portal before retrying.`;
      return finish({ status: "warning", orderId: result.order_id, errorMessage: msg });
    }
    return finish({
      status: "failed",
      errorMessage: result.message || result.error || "The portal returned an error.",
    });
  }

  // e.g. duplicate customer records. Keep any order id so a partially-placed
  // order can't be re-submitted.
  if (result.warning) {
    return finish({
      status: "warning",
      ...(result.order_id ? { orderId: result.order_id } : {}),
      errorMessage: result.warning,
    });
  }

  // Customer profile created but no order id — the legacy stop-early result.
  return finish({ status: "order_entered", errorMessage: null });
}

/**
 * A `submitting` order whose job the scraper no longer knows about.
 *
 * This is genuinely unknown, not failed: the run may have completed in the
 * portal moments before the scraper restarted. Marking it `failed` would
 * re-enable submit and risk a duplicate order, so it becomes a warning telling
 * the agent to check the portal.
 */
async function finalizeMissingJob(id: string): Promise<ProgressState> {
  const o = await prisma.order.update({
    where: { id },
    data: {
      status: "warning",
      jobId: null,
      errorMessage:
        "The submit run was lost (the order service restarted). Check the portal " +
        "for this customer before submitting again — the order may already exist.",
    },
  });
  return {
    status: o.status,
    stage: o.stage,
    orderId: o.orderId,
    errorMessage: o.errorMessage,
    done: true,
  };
}

/**
 * Poll one in-flight order once and persist whatever changed.
 *
 * Safe to call concurrently and after the fact — an order with no jobId, or one
 * already past `submitting`, short-circuits to its current state.
 */
export async function pollOrderProgress(id: string): Promise<ProgressState | null> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return null;

  const current: ProgressState = {
    status: order.status,
    stage: order.stage,
    orderId: order.orderId,
    errorMessage: order.errorMessage,
    done: order.status !== "submitting",
  };
  // Already finalized (possibly by a concurrent poll) — nothing to do.
  if (!order.jobId || order.status !== "submitting") return current;

  const job = await fetchJob(order.jobId);
  // A transient network failure must NOT be mistaken for a finished run; keep
  // the order in flight and let the next poll try again.
  if (job === "unreachable") return current;
  if (job === null) return finalizeMissingJob(id);

  if (job.status === "error") {
    const o = await prisma.order.update({
      where: { id },
      data: {
        status: "failed",
        jobId: null,
        errorMessage: job.error || "The portal run failed.",
      },
    });
    return {
      status: o.status,
      stage: o.stage,
      orderId: o.orderId,
      errorMessage: o.errorMessage,
      done: true,
    };
  }

  if (job.status === "done") return applyResult(id, job.result ?? {});

  // Still running — record the stage if it moved.
  if (job.stage && job.stage !== order.stage) {
    const o = await prisma.order.update({
      where: { id },
      data: { stage: job.stage, stageAt: new Date() },
    });
    return { ...current, stage: o.stage };
  }
  return current;
}

/**
 * How long an order may sit in `submitting` without its stage moving before a
 * reconcile is attempted. Comfortably longer than the slowest single portal
 * step (the Customer Order Information page waits up to 45s on its own) so a
 * merely slow step is never mistaken for an abandoned run.
 */
const STALE_MS = 3 * 60 * 1000;

/**
 * Reconcile orders left mid-flight by a browser that went away.
 *
 * Called from listOrders so simply reopening the page repairs them. Without
 * this an order whose submitting tab was closed would sit in `submitting`
 * forever, since nothing else ever reads its job.
 */
export async function reconcileStaleSubmits(userId: string | null): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.order.findMany({
    where: {
      status: "submitting",
      jobId: { not: null },
      ...(userId ? { userId } : {}),
      OR: [{ stageAt: null }, { stageAt: { lt: cutoff } }],
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
    // Bounded because this runs BEFORE the drafts list is returned: with the 5s
    // per-fetch cap, a dead scraper costs one 5s wait, not one per batch of
    // orders. Anything not reached this time is picked up on the next load.
    take: 10,
  });
  // Best-effort: a failure here must never break the list itself.
  await Promise.allSettled(stale.map((o) => pollOrderProgress(o.id)));
}

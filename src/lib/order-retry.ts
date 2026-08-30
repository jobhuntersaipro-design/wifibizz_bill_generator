/**
 * Running a failed submit again, by itself.
 *
 * Hangs off the droplet's `order_finished` webhook rather than the browser: the
 * whole point is that an agent who closed the tab — or never watched in the
 * first place — still gets the retry. `reconcileStaleSubmits` calls it too, as a
 * net for a webhook that never arrived.
 *
 * The decision of WHETHER to retry is in `retry-policy.ts` and is pure. This
 * file owns the side effects: claiming the try, recording what it is doing, and
 * handing off to the scraper.
 */

import { prisma } from "@/lib/prisma";
import { ACTIVE_ORDER } from "@/lib/order-scope";
import { recordEvent } from "@/lib/order-history";
import { startSubmitRun } from "@/lib/order-start";
import { MAX_AUTO_RETRIES, retryVerdict } from "@/lib/retry-policy";

/**
 * How long to wait before trying a hand-off that the droplet refused.
 *
 * Not a backoff on failure — retries are immediate by design. This covers only
 * the case where the single browser was busy with somebody else's job, so it is
 * "come back when the box is likely free", and the length is a guess at one
 * short job rather than a policy.
 */
const BUSY_RETRY_DELAY_MS = 2 * 60 * 1000;

export type RetryOutcome =
  /** A run was handed to the scraper. The caller must NOT send a result email. */
  | "retried"
  /** Owed, but the droplet was busy. Also no email — the order is not finished. */
  | "deferred"
  /** Nothing more will happen automatically. The caller should send its email. */
  | "no";

/**
 * Retry this order if the failure looks temporary and it has budget left.
 *
 * Safe to call twice on the same order: the try is claimed with a conditional
 * update, so the webhook and a reconcile racing each other produce one run, not
 * two. That matters more than usual here — two runs would mean two real orders
 * at Unifi.
 */
export async function maybeAutoRetry(orderId: string): Promise<RetryOutcome> {
  // ACTIVE_ORDER, not a bare id lookup. A deleted order must never be retried:
  // the portal mints an order number early, so a retry on something the agent
  // deleted creates a real billable order at Unifi with nothing in their list
  // to show it happened.
  const order = await prisma.order.findFirst({ where: { id: orderId, ...ACTIVE_ORDER } });
  if (!order) return "no";

  const verdict = retryVerdict({
    status: order.status,
    errorCode: order.errorCode,
    errorMessage: order.errorMessage,
    autoRetries: order.autoRetries,
    attempt: order.attempt,
  });

  if (!verdict.retry) {
    // Clear the claim FIRST. `applyResult` stamps `autoRetryAt` from the same
    // verdict, so the two normally agree — but a budget spent between the stamp
    // and here (three retries later) leaves a row whose pill would otherwise
    // read "Retrying" for an order nothing is ever coming back for.
    if (order.autoRetryAt) {
      await prisma.order.update({
        where: { id: order.id },
        data: { autoRetryAt: null },
      });
    }
    // Say so in the history, but only once there was a decision worth recording:
    // an order that simply succeeded should not carry a note about not being
    // retried.
    if (order.status === "failed" || order.status === "warning") {
      await recordEvent({
        orderId: order.id,
        attempt: order.attempt,
        status: "info",
        message: `No automatic retry — ${verdict.reason}.`,
      });
    }
    return "no";
  }

  // Claim the try. The `autoRetries` equality is an optimistic lock: whoever
  // writes first wins and everyone else matches no row. Without it, the webhook
  // and `listOrders`'s reconcile could each start a run for the same failure.
  const claim = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: order.status,
      autoRetries: order.autoRetries,
    },
    data: { autoRetries: order.autoRetries + 1, autoRetryAt: null },
  });
  if (claim.count === 0) return "no";

  const tryNo = order.autoRetries + 1;

  // Name the order the previous attempt left behind, BEFORE the next run
  // overwrites `Order.orderId` with its own. The portal mints a number early, so
  // a retried order can leave several real orders at Unifi and only the newest
  // is reachable from the row — the rest live here, in an append-only trail.
  const stranded = order.orderId
    ? ` Attempt ${order.attempt} left order ${order.orderId} in the portal — if this retry creates another, void the one you are not keeping.`
    : "";

  await recordEvent({
    orderId: order.id,
    attempt: order.attempt,
    status: "info",
    message: `Automatic retry ${tryNo} of ${MAX_AUTO_RETRIES} — ${verdict.reason}.${stranded}`,
  });

  const started = await startSubmitRun(order, {
    userKey: order.lastSubmitUserId ?? order.userId,
    auto: true,
  });

  if (started.ok) return "retried";

  if (started.busy) {
    // The droplet was holding its single-browser lock for someone else. That is
    // not this order's failure, so the try is given back and a due date is left
    // for the sweeper.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        autoRetries: order.autoRetries,
        autoRetryAt: new Date(Date.now() + BUSY_RETRY_DELAY_MS),
      },
    });
    await recordEvent({
      orderId: order.id,
      attempt: order.attempt,
      status: "info",
      message: "The order service was busy with another job — this retry will start shortly.",
    });
    return "deferred";
  }

  // A real refusal (an expired session, a missing token). `startSubmitRun` has
  // already written the reason onto the order; the caller should tell someone.
  return "no";
}

/**
 * Start the retries that were owed but could not be handed off.
 *
 * Vercel cannot sleep between requests, so a deferred retry is a row with a due
 * date rather than a timer. Called from `reconcileStaleSubmits` (so opening the
 * Orders page catches up) and from the cron route (so a closed tab does too).
 *
 * Sequential, and small by default: the droplet drives ONE browser, so firing a
 * batch of retries at it would just collect 409s.
 */
export async function sweepPendingRetries(limit = 3): Promise<number> {
  const due = await prisma.order.findMany({
    where: {
      autoRetryAt: { lte: new Date() },
      status: { in: ["failed", "warning"] },
      autoRetries: { lt: MAX_AUTO_RETRIES },
      // Deleting an order clears autoRetryAt, so this is the second of two
      // guards rather than the only one — but a sweep that could pick up a
      // deleted order would submit it to the live portal, which is not a
      // failure mode worth leaving to a single write elsewhere.
      ...ACTIVE_ORDER,
    },
    orderBy: { autoRetryAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let started = 0;
  for (const { id } of due) {
    // Clear the due date first and conditionally, so two sweepers racing (a
    // cron tick and a page load) cannot both take the same row.
    const claimed = await prisma.order.updateMany({
      where: { id, autoRetryAt: { not: null } },
      data: { autoRetryAt: null },
    });
    if (claimed.count === 0) continue;
    // Best-effort per order: one unreachable droplet must not lose the rest.
    const outcome = await maybeAutoRetry(id).catch((e) => {
      console.error(`[retry] sweep ${id} failed:`, e);
      return "no" as const;
    });
    if (outcome === "retried") started++;
  }
  return started;
}

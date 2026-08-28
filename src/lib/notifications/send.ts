import { prisma } from "@/lib/prisma";
import { resolveRecipient } from "./recipient";
import { sendEmail } from "./resend";
import { batchSummaryEmail, singleResultEmail } from "./templates";
import { caseDetailsFrom, type OrderOutcome } from "./outcomes";

/**
 * Sending a notification exactly once.
 *
 * Both emails are triggered by a webhook the droplet retries up to three times,
 * so "send this email" has to be idempotent. The rule is the same in both
 * functions:
 *
 *   1. CLAIM the send with a conditional update (`WHERE notified_at IS NULL`).
 *      Two concurrent deliveries race on that update and exactly one wins.
 *   2. Only the winner sends.
 *   3. If the send fails, RELEASE the claim.
 *
 * Step 3 matters as much as step 1. Without it, a failed send leaves
 * `notified_at` set, and the row then claims an email that never went out —
 * which is exactly the state the "webhook delivered but email lost" check reads
 * as healthy. Releasing means `notified_at IS NULL` keeps its plain meaning:
 * nobody has been told yet.
 */

/** Statuses that are worth an email. A run still in flight is not news. */
const TERMINAL = new Set(["submitted", "warning", "order_entered", "failed"]);

/** Claim the send, returning false when someone else already has it. */
async function claimOrder(id: string): Promise<boolean> {
  const { count } = await prisma.order.updateMany({
    where: { id, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  return count > 0;
}

async function releaseOrder(id: string): Promise<void> {
  await prisma.order
    .updateMany({ where: { id }, data: { notifiedAt: null } })
    .catch((e) => console.error("[notifications] couldn't release order claim:", e));
}

/**
 * Email the result of one submit.
 *
 * Batch members never come through here — the batch summary covers them, and
 * one email per order inside a batch is exactly what the summary exists to
 * avoid.
 */
export async function notifyOrderResult(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, reference: true, fullName: true, status: true,
      orderId: true, errorCode: true, errorMessage: true,
      idType: true, idNumber: true, mobilePrefix: true, mobile: true,
      email: true, street: true, offerName: true, deviceName: true,
      installationDate: true, attempt: true, autoRetryAt: true,
      user: { select: { email: true, notificationEmail: true } },
    },
  });
  if (!order) return;
  if (!TERMINAL.has(order.status)) return;
  // An automatic retry is owed on this order — it is not finished, whatever its
  // status says right now. Belt and braces beside the caller's own gate: this
  // makes "an email is owed" and "a retry is owed" mutually exclusive at the
  // source, so a future caller cannot mail a result that is about to change.
  if (order.autoRetryAt) return;

  const to = resolveRecipient(order.user);
  if (!to) {
    console.warn(`[notifications] order ${order.reference ?? order.id}: no address to send to.`);
    return;
  }
  // Claimed only once there is something to send AND somewhere to send it —
  // claiming earlier would mark a never-sent email as sent.
  if (!(await claimOrder(order.id))) return;

  const outcome: OrderOutcome = {
    orderId: order.id,
    reference: order.reference,
    fullName: order.fullName,
    status: order.status,
    portalOrderNo: order.orderId,
    errorCode: order.errorCode,
    errorMessage: order.errorMessage,
    details: caseDetailsFrom(order),
    tries: order.attempt,
  };
  const { subject, html } = singleResultEmail(outcome);
  const res = await sendEmail({ to, subject, html });
  if (!res.sent) await releaseOrder(order.id);
}

/**
 * Email ONE summary for a whole batch.
 *
 * Reads the per-order results off the BatchRun rather than the live Order rows:
 * the summary describes the run as it happened, and an order edited or deleted
 * afterwards must not rewrite history.
 */
export async function notifyBatchResult(batchRunId: string): Promise<void> {
  const batch = await prisma.batchRun.findUnique({
    where: { id: batchRunId },
    select: {
      id: true, results: true, startedAt: true, finishedAt: true, status: true,
      user: { select: { email: true, notificationEmail: true } },
    },
  });
  if (!batch) return;
  if (batch.status !== "finished") return;

  const results = Array.isArray(batch.results)
    ? (batch.results as unknown as OrderOutcome[])
    : [];
  // A batch that ran nothing still finished, but there is no news in it.
  if (results.length === 0) return;

  const to = resolveRecipient(batch.user);
  if (!to) {
    console.warn(`[notifications] batch ${batch.id}: no address to send to.`);
    return;
  }
  const { count } = await prisma.batchRun.updateMany({
    where: { id: batch.id, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (count === 0) return;

  const { subject, html } = batchSummaryEmail({
    results,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt ?? new Date(),
  });
  const res = await sendEmail({ to, subject, html });
  if (!res.sent) {
    await prisma.batchRun
      .updateMany({ where: { id: batch.id }, data: { notifiedAt: null } })
      .catch((e) => console.error("[notifications] couldn't release batch claim:", e));
  }
}

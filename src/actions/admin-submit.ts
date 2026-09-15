"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { describeConnection, type ConnectionView } from "@/lib/agent-connection";
import { isRetryPending } from "@/lib/retry-policy";
import { mintLiveViewToken } from "@/lib/live-view-token";
import { dealerSessionLive, ORDER_TOKEN, SCRAPER_API_URL, startSubmitRun } from "@/lib/order-start";
import { ACTIVE_ORDER } from "@/lib/order-scope";

/**
 * Admin submits an order under a chosen agent's dealer session and watches
 * the droplet's browser drive it. Spec: context/features/admin-live-submit.md
 *
 * Every refusal here happens BEFORE any write: `startSubmitRun` files a
 * refused start as failed, which is right for an agent's Submit but wrong
 * for a dialog that has not yet committed to anything.
 */

export interface SubmitTarget {
  id: string;
  email: string | null;
  name: string | null;
  isSuperAdmin: boolean;
  staffCode: string | null;
  connection: ConnectionView;
}

const DEAD_SESSION = "That account's dealer session has expired — reconnect it from Order Entry first.";

export async function adminSubmitTargets() {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: [] as SubmitTarget[] };
  const users = await prisma.user.findMany({
    where: { orderEntryEnabled: true },
    select: {
      id: true, email: true, name: true, isSuperAdmin: true,
      dealerAccount: { select: { staffCode: true, sessionExpiresAt: true } },
    },
    orderBy: [{ isSuperAdmin: "desc" }, { email: "asc" }],
  });
  const data: SubmitTarget[] = users.map((u) => ({
    id: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin,
    staffCode: u.dealerAccount?.staffCode?.trim() || null,
    connection: describeConnection(u.dealerAccount),
  }));
  return { success: true as const, data };
}

function refusalFor(order: { status: string; autoRetries: number; autoRetryAt: Date | null }): string | null {
  if (order.status === "submitting") return "A run is already in flight for this order.";
  if (order.status === "submitted") return "This order has already been submitted.";
  if (order.status === "cancelled") return "This order was cancelled.";
  if (isRetryPending(order)) return "An automatic retry is already scheduled for this order.";
  if (!["draft", "failed", "warning"].includes(order.status)) return `An order in status "${order.status}" cannot be submitted.`;
  return null;
}

function tokenFor(jobId: string) {
  const { token, expiresAt } = mintLiveViewToken(jobId, ORDER_TOKEN);
  return { jobId, viewerToken: token, expiresAt };
}

export async function adminSubmitOrder(
  orderId: string,
  targetUserId: string,
  opts: { stopBeforePay: boolean },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const order = await prisma.order.findFirst({ where: { id: orderId, ...ACTIVE_ORDER } });
  if (!order) return { success: false as const, error: "Order not found." };
  const refusal = refusalFor(order);
  if (refusal) return { success: false as const, error: refusal };

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, orderEntryEnabled: true, dealerAccount: { select: { staffCode: true } } },
  });
  if (!target?.orderEntryEnabled) return { success: false as const, error: "That account does not have Order Entry access." };
  if (!(await dealerSessionLive(targetUserId))) return { success: false as const, error: DEAD_SESSION };

  // Precedent: clones. An admin watching a run must not be surprised by three
  // silent retries after it, and a Stop-before-Pay run retried automatically
  // would mint more unpaid orders.
  await prisma.order.update({ where: { id: orderId }, data: { autoRetryDisabled: true } });

  const started = await startSubmitRun(order, {
    userKey: targetUserId, doPay: !opts.stopBeforePay, liveView: true, startedBy: "admin",
  });
  if (!started.ok) return { success: false as const, error: started.error };

  const who = `${target.email ?? target.id}${target.dealerAccount?.staffCode ? ` (${target.dealerAccount.staffCode})` : ""}`;
  await recordAudit({
    actor: ADMIN_ACTOR, action: "order_admin_submitted", targetOrder: orderId,
    detail: `Submitted ${order.reference ?? order.id} as ${who}${opts.stopBeforePay ? ", stopping before Pay" : ""} — job ${started.jobId}.`,
  });
  return { success: true as const, ...tokenFor(started.jobId) };
}

export async function adminLiveViewToken(orderId: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const order = await prisma.order.findFirst({ where: { id: orderId }, select: { jobId: true } });
  if (!order) return { success: false as const, error: "Order not found." };
  if (!order.jobId) return { success: false as const, error: "This order has no run in flight." };
  return { success: true as const, ...tokenFor(order.jobId) };
}

/**
 * Stop the run from the live page. Only the droplet is told; the order row is
 * filed by the existing finalization (webhook / reconcile), exactly as an
 * agent's Stop is — so a stop cannot be recorded as anything but a stop.
 */
export async function adminStopJob(orderId: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const order = await prisma.order.findFirst({ where: { id: orderId }, select: { jobId: true, reference: true } });
  if (!order?.jobId) return { success: false as const, error: "This order has no run in flight." };
  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs/${encodeURIComponent(order.jobId)}/cancel`, {
      method: "POST", headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) return { success: false as const, error: body.message || body.error || "Could not stop the run." };
    await recordAudit({
      actor: ADMIN_ACTOR, action: "job_released", targetOrder: orderId,
      detail: `Stopped job ${order.jobId} from the live view of ${order.reference ?? orderId}.`,
    });
    return { success: true as const, message: "Stop requested — the browser is being torn down. The order's history will record how it ended." };
  } catch (e) {
    console.error("[adminStopJob]", e);
    return { success: false as const, error: "Could not reach the order service." };
  }
}

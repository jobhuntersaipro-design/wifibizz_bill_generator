"use server";

import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import {
  agentStats,
  errorBreakdown,
  fillDays,
  submitsPerDay,
  purgePhraseMatches,
  type AgentStat,
  type StatEvent,
} from "@/lib/admin-order-stats";

/**
 * Admin oversight of every agent's orders.
 *
 * **This is the only module that sees soft-deleted orders.** Every agent-facing
 * query carries `ACTIVE_ORDER` (see `src/lib/order-scope.ts`); nothing here
 * does, and that asymmetry is the whole feature. Adding the filter to a query
 * in this file would silently remove deleted orders from the one view built to
 * show them.
 *
 * Gated by the admin JWT (`verifyAdminSession`), NOT by `auth()` — `/admin` is a
 * separate identity from a signed-in agent.
 */

async function requireAdmin(): Promise<{ success: false; error: string } | null> {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) return { success: false, error: "Unauthorized" };
  return null;
}

/** Clamp a requested window to something sane, and never let `to` precede `from`. */
function resolveRange(fromISO?: string, toISO?: string): { from: Date; to: Date } {
  const now = new Date();
  const to = toISO ? new Date(toISO) : now;
  const from = fromISO ? new Date(fromISO) : new Date(now.getTime() - 29 * 86400_000);
  const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());
  const safeTo = valid(to) ? to : now;
  const safeFrom = valid(from) ? from : new Date(safeTo.getTime() - 29 * 86400_000);
  // A reversed range is a UI bug, not a reason to error at the admin: it is
  // clamped to a single day rather than returning nothing with no explanation.
  return safeFrom > safeTo ? { from: safeTo, to: safeTo } : { from: safeFrom, to: safeTo };
}

export interface AdminOrderRow {
  id: string;
  reference: string | null;
  fullName: string;
  idNumber: string;
  status: string;
  orderId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  offerName: string | null;
  attempt: number;
  createdAt: Date;
  deletedAt: Date | null;
  agentEmail: string | null;
  agentId: string;
  documentCount: number;
}

/**
 * Every order, every agent, deleted included.
 *
 * Deliberately unpaginated for now: the whole table is four rows in dev and a
 * few hundred in production, and a filter that silently truncates is worse than
 * a long page. Revisit when the row count makes it slow, not before.
 */
export async function adminListOrders(filters?: {
  agentId?: string;
  status?: string;
  includeDeleted?: boolean;
}) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: [] as AdminOrderRow[] };

  try {
    const orders = await prisma.order.findMany({
      where: {
        ...(filters?.agentId ? { userId: filters.agentId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        // The default SHOWS deleted rows — this page exists to see them. The
        // flag is there to hide them, which is the unusual request here.
        ...(filters?.includeDeleted === false ? { deletedAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true } } },
    });

    return {
      success: true as const,
      data: orders.map((o): AdminOrderRow => ({
        id: o.id,
        reference: o.reference,
        fullName: o.fullName,
        idNumber: o.idNumber,
        status: o.status,
        orderId: o.orderId,
        errorCode: o.errorCode,
        errorMessage: o.errorMessage,
        offerName: o.offerName,
        attempt: o.attempt,
        createdAt: o.createdAt,
        deletedAt: o.deletedAt,
        agentEmail: o.user.email,
        agentId: o.user.id,
        documentCount: Array.isArray(o.documents) ? o.documents.length : 0,
      })),
    };
  } catch (e) {
    console.error("[adminListOrders]", e);
    return { success: false as const, error: "Could not load orders.", data: [] as AdminOrderRow[] };
  }
}

export interface AdminStats {
  from: string;
  to: string;
  trend: { day: string; count: number }[];
  errors: { code: string; count: number }[];
  agents: (AgentStat & { email: string })[];
  totals: { submitted: number; failedAttempts: number; agents: number; deleted: number };
}

/**
 * The numbers behind the three charts.
 *
 * Reads terminal status events in range and hands them to the pure functions in
 * `admin-order-stats`. The shaping rules live there because each of them is a
 * place where a wrong answer renders just as convincingly as a right one.
 *
 * Only terminal statuses are fetched — `submitting` is per-portal-milestone and
 * outnumbers everything else roughly 35 to 1, so pulling it would be both slow
 * and useless. The new `(status, created_at)` index serves exactly this shape.
 */
export async function adminOrderStats(range?: { from?: string; to?: string }) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: null };

  const { from, to } = resolveRange(range?.from, range?.to);
  try {
    const [events, deleted, emails] = await Promise.all([
      prisma.orderStatusEvent.findMany({
        where: {
          status: { in: ["submitted", "failed", "warning"] },
          createdAt: { gte: from, lte: to },
        },
        select: {
          orderId: true, attempt: true, status: true, errorCode: true, createdAt: true,
          order: { select: { userId: true } },
        },
      }),
      prisma.order.count({ where: { deletedAt: { not: null } } }),
      prisma.user.findMany({ select: { id: true, email: true } }),
    ]);

    const emailOf = new Map(emails.map((u) => [u.id, u.email]));
    const stat: StatEvent[] = events.map((e) => ({
      orderId: e.orderId,
      userId: e.order.userId,
      attempt: e.attempt,
      status: e.status,
      errorCode: e.errorCode,
      createdAt: e.createdAt,
    }));

    const agents = agentStats(stat).map((a) => ({
      ...a,
      // An agent whose account was removed still owns historical events; naming
      // them by id beats dropping the row and losing the count.
      email: emailOf.get(a.userId) || a.userId,
    }));

    return {
      success: true as const,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        trend: fillDays(submitsPerDay(stat), from, to),
        errors: errorBreakdown(stat),
        agents,
        totals: {
          submitted: agents.reduce((n, a) => n + a.submitted, 0),
          failedAttempts: agents.reduce((n, a) => n + a.failedAttempts, 0),
          agents: agents.length,
          deleted,
        },
      } satisfies AdminStats,
    };
  } catch (e) {
    console.error("[adminOrderStats]", e);
    return { success: false as const, error: "Could not load statistics.", data: null };
  }
}

/** One order with its full status history, for the detail view. */
export async function adminGetOrderDetail(id: string) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: null };
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!order) return { success: false as const, error: "Order not found.", data: null };
    const events = await prisma.orderStatusEvent.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
    });
    return { success: true as const, data: { order, events } };
  } catch (e) {
    console.error("[adminGetOrderDetail]", e);
    return { success: false as const, error: "Could not load the order.", data: null };
  }
}

/** Put a deleted order back in its agent's list. */
export async function adminRestoreOrder(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const res = await prisma.order.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (res.count === 0) return { success: false as const, error: "Order is not deleted." };
    return { success: true as const };
  } catch (e) {
    console.error("[adminRestoreOrder]", e);
    return { success: false as const, error: "Could not restore the order." };
  }
}

/**
 * Destroy an order permanently, taking its status history with it.
 *
 * The one irreversible action on the page, so it is not gated on a dialog the
 * browser could have skipped: the caller must send back the order's own
 * confirmation phrase and it is checked HERE. Server Actions are directly
 * POST-able, which is exactly why the check cannot live only in the dialog.
 *
 * Only a soft-deleted order can be purged. Destroying a live order out from
 * under the agent working on it is not a power this page needs.
 */
export async function adminPurgeOrder(id: string, typedPhrase: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, reference: true, fullName: true, deletedAt: true },
    });
    if (!order) return { success: false as const, error: "Order not found." };
    if (!order.deletedAt) {
      return { success: false as const, error: "Only a deleted order can be purged." };
    }
    if (!purgePhraseMatches(order, typedPhrase)) {
      return { success: false as const, error: "That does not match the order's name." };
    }
    // Cascades order_status_events. Nothing survives this.
    await prisma.order.delete({ where: { id } });
    return { success: true as const };
  } catch (e) {
    console.error("[adminPurgeOrder]", e);
    return { success: false as const, error: "Could not purge the order." };
  }
}

"use server";

import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { SCRAPER_API_URL, ORDER_TOKEN } from "@/lib/order-start";
import { describeConnection, isConnected, type ConnectionView } from "@/lib/agent-connection";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import {
  agentStats,
  errorBreakdown,
  fillBuckets,
  submitsPerBucket,
  autoGranularity,
  type Granularity,
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
  granularity: Granularity;
  trend: { day: string; count: number }[];
  errors: { code: string; count: number }[];
  agents: (AgentStat & { email: string; connection: ConnectionView })[];
  totals: {
    submitted: number; failedAttempts: number; agents: number; deleted: number;
    /** Agents whose dealer session is live — i.e. who could submit right now. */
    connected: number;
  };
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
export async function adminOrderStats(range?: {
  from?: string; to?: string; agentId?: string; granularity?: Granularity;
}) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: null };

  const { from, to } = resolveRange(range?.from, range?.to);
  const granularity = range?.granularity ?? autoGranularity(from, to);
  try {
    const [events, deleted, emails, dealers] = await Promise.all([
      prisma.orderStatusEvent.findMany({
        where: {
          status: { in: ["submitted", "failed", "warning"] },
          createdAt: { gte: from, lte: to },
          // Narrowing HERE rather than after the fact, so the KPI tiles, the
          // trend and the error breakdown all filter together and cannot
          // disagree about which agent they are describing.
          ...(range?.agentId ? { order: { userId: range.agentId } } : {}),
        },
        select: {
          orderId: true, attempt: true, status: true, errorCode: true, createdAt: true,
          order: { select: { userId: true } },
        },
      }),
      prisma.order.count({ where: { deletedAt: { not: null } } }),
      prisma.user.findMany({ select: { id: true, email: true } }),
      // One query for every agent's session, not one per row.
      prisma.dealerAccount.findMany({ select: { userId: true, sessionExpiresAt: true } }),
    ]);

    const emailOf = new Map(emails.map((u) => [u.id, u.email]));
    const now = new Date();
    const dealerOf = new Map(dealers.map((d) => [d.userId, d]));
    // Connected counts EVERY agent with a live session, not only those who
    // appear in the range: "who can submit right now" is a question about the
    // present, and answering it from a date filter would understate it.
    const connectedCount = dealers.filter((d) => isConnected(describeConnection(d, now))).length;
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
      connection: describeConnection(dealerOf.get(a.userId), now),
    }));

    return {
      success: true as const,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
        trend: fillBuckets(submitsPerBucket(stat, granularity), from, to, granularity),
        errors: errorBreakdown(stat),
        agents,
        totals: {
          submitted: agents.reduce((n, a) => n + a.submitted, 0),
          failedAttempts: agents.reduce((n, a) => n + a.failedAttempts, 0),
          agents: agents.length,
          deleted,
          connected: connectedCount,
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
    await recordAudit({ actor: ADMIN_ACTOR, action: "order_restored", targetOrder: id });
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
    // Cascades order_status_events. Nothing survives this — except the audit
    // row written below, which is the point of the trail having no relations.
    await prisma.order.delete({ where: { id } });
    await recordAudit({
      actor: ADMIN_ACTOR,
      action: "order_purged",
      targetOrder: id,
      detail: `Purged ${order.reference ?? order.fullName} permanently.`,
    });
    return { success: true as const };
  } catch (e) {
    console.error("[adminPurgeOrder]", e);
    return { success: false as const, error: "Could not purge the order." };
  }
}

/* ── Live jobs ───────────────────────────────────────────────────────────── */

export interface LiveJob {
  jobId: string;
  status: string;
  stage: string | null;
  ageS: number;
  /** Past the droplet's own cap, so it cannot still be legitimately working. */
  stuck: boolean;
  agentId: string | null;
  agentEmail: string | null;
  orderId: string | null;
  orderLabel: string | null;
}

/**
 * What is holding a submit slot right now.
 *
 * Reads the auth-gated `GET /jobs` on the droplet server-side under the ADMIN
 * gate, so no new public surface exists and the token never reaches a browser.
 *
 * A job whose BizzFlow order cannot be found is REPORTED, not dropped. A slot
 * held by something nobody can name is exactly the case an admin needs to see —
 * it is what the 2026-08-29 stuck lock looked like from the outside.
 */
export async function adminLiveJobs() {
  const denied = await requireAdmin();
  // `reachable: true` on purpose. An expired admin session is not a droplet
  // outage, and reporting it as one sends whoever is looking to debug the
  // wrong system entirely. The panel shows this error verbatim instead.
  if (denied) return { ...denied, data: [] as LiveJob[], reachable: true };

  try {
    const res = await fetch(`${SCRAPER_API_URL}/jobs`, {
      cache: "no-store",
      headers: { "X-Internal-Token": ORDER_TOKEN },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { success: false as const, error: `Order service answered ${res.status}.`,
               data: [] as LiveJob[], reachable: false };
    }
    const body = (await res.json()) as {
      jobs?: { job_id: string; user_key?: string | null; status?: string; stage?: string | null; age_s?: number }[];
      max_job_runtime_s?: number | null;
    };
    const active = (body.jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
    if (active.length === 0) {
      return { success: true as const, data: [] as LiveJob[], reachable: true };
    }

    const cap = typeof body.max_job_runtime_s === "number" ? body.max_job_runtime_s : null;
    const [orders, users] = await Promise.all([
      prisma.order.findMany({
        where: { jobId: { in: active.map((j) => j.job_id) } },
        select: { id: true, jobId: true, reference: true, fullName: true },
      }),
      prisma.user.findMany({
        where: { id: { in: active.map((j) => j.user_key).filter(Boolean) as string[] } },
        select: { id: true, email: true },
      }),
    ]);
    const orderOf = new Map(orders.map((o) => [o.jobId!, o]));
    const emailOf = new Map(users.map((u) => [u.id, u.email]));

    return {
      success: true as const,
      reachable: true,
      data: active.map((j): LiveJob => {
        const order = orderOf.get(j.job_id);
        const age = typeof j.age_s === "number" ? j.age_s : 0;
        return {
          jobId: j.job_id,
          status: j.status ?? "running",
          stage: j.stage ?? null,
          ageS: age,
          // The same rule the agent-side hover text applies, so the two
          // surfaces cannot disagree about what "stuck" means.
          stuck: cap !== null && age > cap,
          agentId: j.user_key ?? null,
          agentEmail: j.user_key ? emailOf.get(j.user_key) ?? j.user_key : null,
          orderId: order?.id ?? null,
          orderLabel: order ? order.reference || order.fullName : null,
        };
      }),
    };
  } catch (e) {
    console.error("[adminLiveJobs]", e);
    return { success: false as const, error: "Could not reach the order service.",
             data: [] as LiveJob[], reachable: false };
  }
}

/**
 * Free a submit slot.
 *
 * Tries the ORDINARY cancel first, because it does more: when a live task
 * handle exists the droplet cancels the run itself and the browser is torn
 * down. Only when that is refused (`409 not_cancellable` — the genuinely wedged
 * case, where the handle is gone) does it fall back to `?force=1`, which frees
 * the registry entry WITHOUT stopping whatever may still be executing.
 *
 * The two outcomes are reported separately because they mean different things
 * to whoever pressed the button.
 */
export async function adminReleaseJob(jobId: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const call = (force: boolean) =>
    fetch(`${SCRAPER_API_URL}/jobs/${encodeURIComponent(jobId)}/cancel${force ? "?force=1" : ""}`, {
      method: "POST",
      headers: { "X-Internal-Token": ORDER_TOKEN },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

  try {
    const first = await call(false);
    if (first.ok) {
      await recordAudit({ actor: ADMIN_ACTOR, action: "job_released", targetOrder: null,
        detail: `Released job ${jobId} — the run itself was cancelled.` });
      return { success: true as const, stopped: true,
               message: "The run was cancelled — the browser is being torn down." };
    }
    const body = (await first.json().catch(() => ({}))) as { error?: string; message?: string };
    if (body.error !== "not_cancellable") {
      // unknown_job / not_running / unauthorized: nothing to force, and
      // guessing would misreport what happened.
      return { success: false as const, error: body.message || body.error || "Could not release the job." };
    }

    const forced = await call(true);
    const fBody = (await forced.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!forced.ok) {
      return { success: false as const, error: fBody.message || fBody.error || "Could not release the job." };
    }
    await recordAudit({ actor: ADMIN_ACTOR, action: "job_released", targetOrder: null,
      detail: `Force-released job ${jobId} — the run itself was NOT stopped.` });
    return { success: true as const, stopped: false,
             message: "Slot released. The run itself was not stopped." };
  } catch (e) {
    console.error("[adminReleaseJob]", e);
    return { success: false as const, error: "Could not reach the order service." };
  }
}

/** One agent, for the detail page: who they are and whether they can submit. */
export async function adminGetAgent(id: string) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: null };
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, notes: true, caseLimit: true,
        orderEntryEnabled: true, isSuperAdmin: true, createdAt: true,
        dealerAccount: {
          select: { staffCode: true, registeredEmail: true, lastConnectedAt: true, sessionExpiresAt: true },
        },
      },
    });
    if (!user) return { success: false as const, error: "Agent not found.", data: null };
    return {
      success: true as const,
      data: { ...user, connection: describeConnection(user.dealerAccount, new Date()) },
    };
  } catch (e) {
    console.error("[adminGetAgent]", e);
    return { success: false as const, error: "Could not load the agent.", data: null };
  }
}

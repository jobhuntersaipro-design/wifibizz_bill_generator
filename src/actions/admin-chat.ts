"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { chatConfig } from "@/lib/admin-chat/config";

/**
 * The admin assistant's Handoffs list — questions it passed to a person
 * (Sofie, a placeholder). Admin-gated like every admin action.
 */

export interface HandoffRow {
  id: string;
  assignee: string;
  summary: string;
  reason: string;
  orderRef: string | null;
  status: string;
  emailed: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export async function listChatHandoffs(includeResolved = false) {
  const denied = await requireAdmin();
  if (denied) return { ...denied, data: [] as HandoffRow[] };
  if (!chatConfig().enabled) return { success: false as const, error: "Not enabled", data: [] as HandoffRow[] };
  try {
    const rows = await prisma.adminChatEscalation.findMany({
      where: includeResolved ? {} : { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      success: true as const,
      data: rows.map(
        (r): HandoffRow => ({
          id: r.id,
          assignee: r.assignee,
          summary: r.summary,
          reason: r.reason,
          orderRef: r.orderRef,
          status: r.status,
          emailed: r.emailed,
          createdAt: r.createdAt.toISOString(),
          resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        }),
      ),
    };
  } catch (e) {
    console.error("[listChatHandoffs]", e);
    return { success: false as const, error: "Could not load handoffs.", data: [] as HandoffRow[] };
  }
}

export async function resolveChatHandoff(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    // Conditional on still being open, so a double click cannot move the time.
    await prisma.adminChatEscalation.updateMany({
      where: { id, status: "open" },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    return { success: true as const };
  } catch (e) {
    console.error("[resolveChatHandoff]", e);
    return { success: false as const, error: "Could not resolve the handoff." };
  }
}

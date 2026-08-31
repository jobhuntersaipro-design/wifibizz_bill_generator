"use server";

import { verifyAdminSession } from "@/lib/admin-auth";
import { listAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** The Activity list on the admin Users page. Read-only, admin-gated. */
export async function getAuditLog(opts?: { before?: string; limit?: number }) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) return { success: false as const, error: "Unauthorized", data: [] };
  try {
    const rows = await listAudit(
      Math.min(opts?.limit ?? 20, 100),
      opts?.before ? new Date(opts.before) : undefined,
    );
    // Resolve target user ids to emails for reading — the trail stores ids so
    // it survives renames; the view translates.
    const ids = [...new Set(rows.map((r) => r.targetUser).filter(Boolean))] as string[];
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, name: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
    return {
      success: true as const,
      data: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        // A deleted user's id no longer resolves; the id itself is still shown,
        // because "done to somebody who no longer exists" is exactly what an
        // audit trail is for.
        targetUser: r.targetUser ? nameOf.get(r.targetUser) ?? r.targetUser : null,
        targetOrder: r.targetOrder,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (e) {
    console.error("[getAuditLog]", e);
    return { success: false as const, error: "Could not load activity.", data: [] };
  }
}

import { prisma } from "@/lib/prisma";

/**
 * The people audit trail — who did what to whom.
 *
 * Append-only by code as well as convention: this module exposes a writer and
 * a reader and nothing else. There is no update and no delete anywhere in the
 * codebase, and the table has no relations, so purging a user cannot destroy
 * the record of who purged them.
 */

/** The one shared admin identity. The admin JWT carries role alone, so this is
 * as much "who" as an admin action can honestly claim. */
export const ADMIN_ACTOR = "admin";

export type AuditAction =
  | "user_created"
  | "user_updated"
  | "user_deleted"
  | "order_entry_enabled"
  | "order_entry_disabled"
  | "case_limit_topup"
  | "order_restored"
  | "order_purged"
  | "order_cloned"
  | "job_released"
  | "invite_created"
  | "password_changed"
  | "password_reset";

/**
 * Record one event. NEVER throws.
 *
 * An audit outage must not make user management fall over, so a failed write
 * is logged to the console and swallowed. The trade — an action can succeed
 * unrecorded — is accepted and stated in the spec; the alternative couples
 * every admin operation to one table's availability.
 *
 * `detail` is one human sentence. Never a secret ("password changed", not the
 * password), never JSON to parse later.
 */
export async function recordAudit(event: {
  actor: string;
  action: AuditAction;
  targetUser?: string | null;
  targetOrder?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actor: event.actor,
        action: event.action,
        targetUser: event.targetUser ?? null,
        targetOrder: event.targetOrder ?? null,
        detail: event.detail ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] write failed (action proceeded):", event.action, e);
  }
}

/** Newest first. The reader half of the append-only pair. */
export async function listAudit(limit = 20, before?: Date) {
  return prisma.adminAuditLog.findMany({
    where: before ? { createdAt: { lt: before } } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

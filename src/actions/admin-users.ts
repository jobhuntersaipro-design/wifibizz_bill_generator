"use server";

import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { describeConnection } from "@/lib/agent-connection";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";

interface ActionResult {
  success: boolean;
  error?: string;
}

async function requireAdmin(): Promise<ActionResult | null> {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) return { success: false, error: "Unauthorized" };
  return null;
}

export async function getUsers() {
  const denied = await requireAdmin();
  if (denied) return { success: false, error: denied.error, data: [] };

  try {
    const users = await prisma.user.findMany({
      include: {
        wifibizzUser: {
          select: { wifibizzEmail: true, lastCrawlAt: true },
        },
        // Whether this agent can submit right now. Read here rather than on the
        // client so the Users list and the oversight page answer from the same
        // column — see src/lib/agent-connection.ts.
        dealerAccount: { select: { sessionExpiresAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    return {
      success: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        passwordRaw: u.passwordRaw,
        notes: u.notes,
        caseLimit: u.caseLimit,
        orderEntryEnabled: u.orderEntryEnabled,
        wifibizzEmail: u.wifibizzUser?.wifibizzEmail ?? null,
        lastCrawlAt: u.wifibizzUser?.lastCrawlAt?.toISOString() ?? null,
        connection: describeConnection(u.dealerAccount, now),
        createdAt: u.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    console.error("getUsers error:", err);
    return { success: false, error: "Failed to load users", data: [] };
  }
}

export async function createUser(data: {
  name: string;
  email: string;
  /** Optional since onboarding: blank creates a password-less account that
   * cannot sign in until the agent sets one through an invite link. */
  password?: string;
  notes?: string;
  caseLimit?: number;
  wifibizzEmail?: string;
}): Promise<ActionResult & { userId?: string }> {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!data.email) {
    return { success: false, error: "Email is required" };
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return { success: false, error: "A user with this email already exists" };
    }

    const hashedPassword = data.password ? await bcrypt.hash(data.password, 12) : null;

    const user = await prisma.user.create({
      data: {
        name: data.name || null,
        email: data.email,
        password: hashedPassword,
        passwordRaw: data.password ?? null,
        notes: data.notes || null,
        caseLimit: data.caseLimit ?? 10,
      },
    });

    await recordAudit({
      actor: ADMIN_ACTOR,
      action: "user_created",
      targetUser: user.id,
      detail: `Created ${data.email}.`,
    });

    // If wifibizzEmail provided, create the WifibizzUser link
    if (data.wifibizzEmail) {
      // Check if wifibizz email already in use
      const existingWb = await prisma.wifibizzUser.findUnique({
        where: { wifibizzEmail: data.wifibizzEmail },
        include: { user: true },
      });
      if (existingWb) {
        if (existingWb.user) {
          // Genuinely in use by another user
          await prisma.user.delete({ where: { id: user.id } });
          return { success: false, error: "This WifiBizz email is already assigned to another user" };
        }
        // Orphaned record (user was deleted without cascade) — clean up
        await prisma.wifibizzCase.deleteMany({ where: { userId: existingWb.id } });
        await prisma.wifibizzUser.delete({ where: { id: existingWb.id } });
      }

      // Create wifibizz_users row with a placeholder encrypted password
      const placeholder = "PLACEHOLDER_NEEDS_USER_INPUT";
      await prisma.wifibizzUser.create({
        data: {
          userId: user.id,
          wifibizzEmail: data.wifibizzEmail,
          wifibizzPasswordEnc: placeholder,
        },
      });
    }

    return { success: true, userId: user.id };
  } catch (err) {
    console.error("createUser error:", err);
    return { success: false, error: "Failed to create user" };
  }
}

export async function updateUser(
  userId: string,
  data: {
    name?: string;
    email?: string;
    password?: string;
    notes?: string;
    caseLimit?: number;
    wifibizzEmail?: string;
    limitChangeReason?: string;
  }
): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wifibizzUser: true },
    });
    if (!user) return { success: false, error: "User not found" };

    // Check email uniqueness if changing
    if (data.email && data.email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing) return { success: false, error: "A user with this email already exists" };
    }

    // Update user fields
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name || null;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.caseLimit !== undefined) updateData.caseLimit = data.caseLimit;
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 12);
      updateData.passwordRaw = data.password;
    }

    await prisma.user.update({ where: { id: userId }, data: updateData });

    // Which fields changed, never their values — "password" must appear here
    // as a word, and the password itself must not.
    const changed = Object.keys(updateData)
      .map((k) => (k === "passwordRaw" ? null : k === "password" ? "password" : k))
      .filter(Boolean)
      .join(", ");
    await recordAudit({
      actor: ADMIN_ACTOR,
      action: "user_updated",
      targetUser: userId,
      detail: changed ? `Changed ${changed}.` : "No fields changed.",
    });

    // Log case limit change if it changed
    if (data.caseLimit !== undefined && data.caseLimit !== user.caseLimit) {
      const adminUsername = process.env.BIZZFLOW_ADMIN_USERNAME ?? "admin";
      await prisma.caseLimitChangeLog.create({
        data: {
          userId,
          previousLimit: user.caseLimit,
          newLimit: data.caseLimit,
          changedBy: adminUsername,
          reason: data.limitChangeReason?.trim() || null,
        },
      });
    }

    // Handle wifibizzEmail changes
    if (data.wifibizzEmail !== undefined) {
      const newEmail = data.wifibizzEmail.trim() || null;

      if (newEmail && user.wifibizzUser) {
        // Update existing
        if (newEmail !== user.wifibizzUser.wifibizzEmail) {
          const conflict = await prisma.wifibizzUser.findUnique({
            where: { wifibizzEmail: newEmail },
          });
          if (conflict) return { success: false, error: "This WifiBizz email is already assigned to another user" };

          await prisma.wifibizzUser.update({
            where: { id: user.wifibizzUser.id },
            data: { wifibizzEmail: newEmail },
          });
        }
      } else if (newEmail && !user.wifibizzUser) {
        // Create new link
        const conflict = await prisma.wifibizzUser.findUnique({
          where: { wifibizzEmail: newEmail },
        });
        if (conflict) return { success: false, error: "This WifiBizz email is already assigned to another user" };

        const placeholder = "PLACEHOLDER_NEEDS_USER_INPUT";
        await prisma.wifibizzUser.create({
          data: {
            userId: userId,
            wifibizzEmail: newEmail,
            wifibizzPasswordEnc: placeholder,
          },
        });
      } else if (!newEmail && user.wifibizzUser) {
        // Remove link
        await prisma.wifibizzUser.delete({ where: { id: user.wifibizzUser.id } });
      }
    }

    return { success: true };
  } catch (err) {
    console.error("updateUser error:", err);
    return { success: false, error: "Failed to update user" };
  }
}

// Quick per-user toggle for Order Entry access (the admin table checkbox).
export async function setOrderEntryAccess(
  userId: string,
  enabled: boolean
): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { orderEntryEnabled: enabled },
    });

    await recordAudit({
      actor: ADMIN_ACTOR,
      action: enabled ? "order_entry_enabled" : "order_entry_disabled",
      targetUser: userId,
    });
    return { success: true };
  } catch (err) {
    console.error("setOrderEntryAccess error:", err);
    return { success: false, error: "Failed to update Order Entry access" };
  }
}

export async function topupUserCaseLimit(
  userId: string,
  data: { amount: number; reason: string }
): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!data.amount || data.amount <= 0) {
    return { success: false, error: "Amount must be a positive number" };
  }
  if (!data.reason?.trim()) {
    return { success: false, error: "Reason is required for topups" };
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, error: "User not found" };

    const newLimit = user.caseLimit + data.amount;

    await prisma.user.update({
      where: { id: userId },
      data: { caseLimit: newLimit },
    });

    await recordAudit({
      actor: ADMIN_ACTOR,
      action: "case_limit_topup",
      targetUser: userId,
      detail: `Topped up ${data.amount} cases${data.reason ? ` — ${data.reason}` : ""}.`,
    });

    const adminUsername = process.env.BIZZFLOW_ADMIN_USERNAME ?? "admin";
    await prisma.caseLimitChangeLog.create({
      data: {
        userId,
        previousLimit: user.caseLimit,
        newLimit,
        changedBy: adminUsername,
        reason: data.reason.trim(),
      },
    });

    return { success: true };
  } catch (err) {
    console.error("topupUserCaseLimit error:", err);
    return { success: false, error: "Failed to topup case limit" };
  }
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wifibizzUser: true },
    });
    if (!user) return { success: false, error: "User not found" };

    // Explicitly delete related records (DB may lack CASCADE constraints)
    if (user.wifibizzUser) {
      // Delete cases linked to the wifibizz user first
      await prisma.wifibizzCase.deleteMany({
        where: { userId: user.wifibizzUser.id },
      });
      // Delete the wifibizz user record
      await prisma.wifibizzUser.delete({
        where: { id: user.wifibizzUser.id },
      });
    }

    // Delete usage and limit change logs
    await prisma.caseUsageLog.deleteMany({ where: { userId } });
    await prisma.caseLimitChangeLog.deleteMany({ where: { userId } });

    // Delete the user
    await prisma.user.delete({ where: { id: userId } });

    await recordAudit({
      actor: ADMIN_ACTOR,
      action: "user_deleted",
      targetUser: userId,
      detail: "Account deleted.",
    });

    return { success: true };
  } catch (err) {
    console.error("deleteUser error:", err);
    return { success: false, error: "Failed to delete user" };
  }
}

/**
 * Mint an invite — a 7-day, single-use set-password link.
 *
 * COPY-LINK by design, not e-mail: several live accounts have unreal login
 * addresses, and an invite that silently cannot arrive is worse than no
 * button. A second click simply mints a fresh token, which is both "resend"
 * and "revoke by outliving" in one gesture.
 */
export async function createInviteLink(userId: string): Promise<ActionResult & { url?: string }> {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return { success: false, error: "User not found" };

    const { newResetToken, INVITE_TOKEN_TTL_MS } = await import("@/lib/password-reset");
    const { appBaseUrl } = await import("@/lib/notifications/templates");
    const { token, tokenHash, expiresAt } = newResetToken(INVITE_TOKEN_TTL_MS);
    await prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
    await recordAudit({
      actor: ADMIN_ACTOR, action: "invite_created", targetUser: userId,
      detail: "7-day set-password link minted.",
    });
    const base = appBaseUrl() ?? "";
    return { success: true, url: `${base}/auth/reset?token=${token}&welcome=1` };
  } catch (e) {
    console.error("createInviteLink error:", e);
    return { success: false, error: "Could not create the invite link" };
  }
}
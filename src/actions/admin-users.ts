"use server";

import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
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
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        passwordRaw: u.passwordRaw,
        notes: u.notes,
        billLimit: u.billLimit,
        wifibizzEmail: u.wifibizzUser?.wifibizzEmail ?? null,
        lastCrawlAt: u.wifibizzUser?.lastCrawlAt?.toISOString() ?? null,
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
  password: string;
  notes?: string;
  billLimit?: number;
  wifibizzEmail?: string;
}): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!data.email || !data.password) {
    return { success: false, error: "Email and password are required" };
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return { success: false, error: "A user with this email already exists" };
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        name: data.name || null,
        email: data.email,
        password: hashedPassword,
        passwordRaw: data.password,
        notes: data.notes || null,
        billLimit: data.billLimit ?? 10,
      },
    });

    // If wifibizzEmail provided, create the WifibizzUser link
    if (data.wifibizzEmail) {
      // Check if wifibizz email already in use
      const existingWb = await prisma.wifibizzUser.findUnique({
        where: { wifibizzEmail: data.wifibizzEmail },
      });
      if (existingWb) {
        // Clean up created user
        await prisma.user.delete({ where: { id: user.id } });
        return { success: false, error: "This WifiBizz email is already assigned to another user" };
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

    return { success: true };
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
    billLimit?: number;
    wifibizzEmail?: string;
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
    if (data.billLimit !== undefined) updateData.billLimit = data.billLimit;
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 12);
      updateData.passwordRaw = data.password;
    }

    await prisma.user.update({ where: { id: userId }, data: updateData });

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

export async function deleteUser(userId: string): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, error: "User not found" };

    // Cascade delete handles wifibizzUser due to onDelete: Cascade
    await prisma.user.delete({ where: { id: userId } });

    return { success: true };
  } catch (err) {
    console.error("deleteUser error:", err);
    return { success: false, error: "Failed to delete user" };
  }
}

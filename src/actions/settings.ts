"use server";

import { auth } from "@/auth";
import { upsertUser, getUserByEmail } from "@/lib/crawler/db";
import { prisma } from "@/lib/prisma";

export async function saveWifibizzCredentials(email: string, password: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  if (!email || !password) {
    return { success: false, error: "Email and password are required" };
  }

  try {
    // Upsert into wifibizz_users table (encrypts password)
    const wifibizzUser = await upsertUser(email, password);

    // Link wifibizz_users to auth User via user_id_ref
    await prisma.wifibizzUser.update({
      where: { id: wifibizzUser.id },
      data: { userId: session.user.id },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Save credentials error:", message);
    return { success: false, error: message };
  }
}

export async function getWifibizzCredentials() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: null };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { wifibizzEmail: true, lastCrawlAt: true },
    });

    return {
      success: true,
      data: wifibizzUser
        ? {
            email: wifibizzUser.wifibizzEmail,
            lastCrawlAt: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
          }
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message, data: null };
  }
}

"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crawler/encryption";

const PLACEHOLDER_PASSWORD = "PLACEHOLDER_NEEDS_USER_INPUT";

export async function saveWifibizzPassword(password: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  if (!password) {
    return { success: false, error: "Password is required" };
  }

  try {
    // Find the user's wifibizz record (email set by admin)
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
    });

    if (!wifibizzUser) {
      return {
        success: false,
        error: "No WifiBizz email assigned. Contact your administrator.",
      };
    }

    // Update only the password
    const encryptedPassword = encrypt(password);
    await prisma.wifibizzUser.update({
      where: { id: wifibizzUser.id },
      data: { wifibizzPasswordEnc: encryptedPassword },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Save password error:", message);
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
      select: {
        wifibizzEmail: true,
        wifibizzPasswordEnc: true,
        lastCrawlAt: true,
      },
    });

    return {
      success: true,
      data: wifibizzUser
        ? {
            email: wifibizzUser.wifibizzEmail,
            hasPassword: (() => {
              try {
                return decrypt(wifibizzUser.wifibizzPasswordEnc) !== PLACEHOLDER_PASSWORD;
              } catch {
                return false;
              }
            })(),
            lastCrawlAt: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
          }
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message, data: null };
  }
}

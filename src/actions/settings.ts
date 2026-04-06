"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { testConnection } from "@/lib/crawler/scraper";

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

    // Update only the password (stored as plain text in DB)
    await prisma.wifibizzUser.update({
      where: { id: wifibizzUser.id },
      data: { wifibizzPasswordEnc: password },
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

    const hasPassword = wifibizzUser
      ? wifibizzUser.wifibizzPasswordEnc !== PLACEHOLDER_PASSWORD
      : false;

    return {
      success: true,
      data: wifibizzUser
        ? {
            email: wifibizzUser.wifibizzEmail,
            hasPassword,
            savedPassword: hasPassword ? wifibizzUser.wifibizzPasswordEnc : null,
            lastCrawlAt: wifibizzUser.lastCrawlAt?.toISOString() ?? null,
          }
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message, data: null };
  }
}

export async function getSidebarInfo() {
  const session = await auth();
  if (!session?.user?.id) {
    return { email: null, agent: null };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { wifibizzEmail: true, id: true },
    });

    if (!wifibizzUser) {
      return { email: null, agent: null };
    }

    // Get the most common agent from the user's cases
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT agent FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id} AND agent IS NOT NULL AND agent != ''
      GROUP BY agent ORDER BY COUNT(*) DESC LIMIT 1
    `;

    return {
      email: wifibizzUser.wifibizzEmail,
      agent: rows.length > 0 ? rows[0].agent : null,
    };
  } catch {
    return { email: null, agent: null };
  }
}

export async function testWifibizzConnection() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: {
        wifibizzEmail: true,
        wifibizzPasswordEnc: true,
      },
    });

    if (!wifibizzUser) {
      return { success: false, error: "No WifiBizz account configured." };
    }

    if (
      !wifibizzUser.wifibizzPasswordEnc ||
      wifibizzUser.wifibizzPasswordEnc === PLACEHOLDER_PASSWORD
    ) {
      return { success: false, error: "Please save your WifiBizz password first." };
    }

    await testConnection(
      wifibizzUser.wifibizzEmail,
      wifibizzUser.wifibizzPasswordEnc
    );

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("invalid credentials")) {
      return {
        success: false,
        error: "Connection failed. Please check your WifiBizz password and try again.",
      };
    }
    return { success: false, error: `Connection failed: ${message}` };
  }
}

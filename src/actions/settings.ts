"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { testConnection } from "@/lib/crawler/scraper";
import { neon } from "@neondatabase/serverless";

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
    return { email: null, agent: null, orderEntryEnabled: false };
  }

  try {
    const [user, wifibizzUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { orderEntryEnabled: true },
      }),
      prisma.wifibizzUser.findUnique({
        where: { userId: session.user.id },
        select: { wifibizzEmail: true, id: true },
      }),
    ]);
    const orderEntryEnabled = !!user?.orderEntryEnabled;

    if (!wifibizzUser) {
      return { email: null, agent: null, orderEntryEnabled };
    }

    // Get the most common agent from the user's cases
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT agent FROM wifibizz_cases
      WHERE user_id = ${wifibizzUser.id} AND agent IS NOT NULL AND agent != ''
      GROUP BY agent ORDER BY COUNT(*) DESC LIMIT 1
    `;

    return {
      email: wifibizzUser.wifibizzEmail,
      agent: rows.length > 0 ? rows[0].agent : null,
      orderEntryEnabled,
    };
  } catch {
    return { email: null, agent: null, orderEntryEnabled: false };
  }
}

// Server-side access gate for the Order Entry route (defense in depth beyond
// hiding the sidebar link).
export async function hasOrderEntryAccess(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orderEntryEnabled: true },
    });
    return !!user?.orderEntryEnabled;
  } catch {
    return false;
  }
}

export async function getGoogleSheetSettings() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: null };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { googleSheetId: true },
    });

    return {
      success: true,
      data: {
        googleSheetId: wifibizzUser?.googleSheetId ?? null,
        serviceAccountEmail: await import("@/lib/google-sheets").then(
          (m) => m.getServiceAccountEmail()
        ).catch(() => null),
      },
    };
  } catch (error) {
    console.error("Get Google Sheet settings error:", error);
    return {
      success: false,
      error: "Failed to load Google Sheet settings.",
      data: null,
    };
  }
}

export async function saveGoogleSheetId(sheetId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
    });

    if (!wifibizzUser) {
      return {
        success: false,
        error: "No WifiBizz account configured. Contact your administrator.",
      };
    }

    await prisma.wifibizzUser.update({
      where: { id: wifibizzUser.id },
      data: { googleSheetId: sheetId || null },
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Save Google Sheet ID error:", message);
    return {
      success: false,
      error: "Failed to save Google Sheet ID. Please try again.",
    };
  }
}

export async function syncCasesToSheet() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const wifibizzUser = await prisma.wifibizzUser.findUnique({
      where: { userId: session.user.id },
      select: { id: true, googleSheetId: true },
    });

    if (!wifibizzUser) {
      return { success: false, error: "No WifiBizz account configured." };
    }

    if (!wifibizzUser.googleSheetId) {
      return {
        success: false,
        error: "No Google Sheet ID configured. Set it in Settings.",
      };
    }

    // Check sheet for rows that were manually deleted by the user
    const { appendCasesToSheet, getSheetCaseNumbers } = await import("@/lib/google-sheets");
    const sheetCaseNos = await getSheetCaseNumbers(wifibizzUser.googleSheetId);

    // Find cases marked as synced in DB but missing from sheet (user deleted them)
    const syncedCases = await prisma.wifibizzCase.findMany({
      where: {
        userId: wifibizzUser.id,
        syncedToSheetAt: { not: null },
      },
      select: { id: true, caseNo: true },
    });

    const missingIds = syncedCases
      .filter((c) => !sheetCaseNos.has(c.caseNo))
      .map((c) => c.id);

    if (missingIds.length > 0) {
      // Reset syncedToSheetAt so they get re-synced
      await prisma.wifibizzCase.updateMany({
        where: { id: { in: missingIds } },
        data: { syncedToSheetAt: null },
      });
    }

    // Get unsynced cases (including freshly reset ones)
    const unsyncedCases = await prisma.wifibizzCase.findMany({
      where: {
        userId: wifibizzUser.id,
        syncedToSheetAt: null,
      },
      orderBy: { caseCreatedAt: "asc" },
    });

    if (unsyncedCases.length === 0) {
      return { success: true, synced: 0, message: "All cases already synced." };
    }

    // Append to Google Sheet
    const { appendedRows } = await appendCasesToSheet(
      wifibizzUser.googleSheetId,
      unsyncedCases
    );

    // Mark cases as synced
    const now = new Date();
    await prisma.wifibizzCase.updateMany({
      where: {
        id: { in: unsyncedCases.map((c) => c.id) },
      },
      data: { syncedToSheetAt: now },
    });

    return { success: true, synced: appendedRows };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Sync to sheet error:", message);
    if (message.includes("GOOGLE_SERVICE_ACCOUNT_JSON")) {
      return {
        success: false,
        error: "Google Sheets integration is not configured yet. Please contact your administrator to set up the service account.",
      };
    }
    if (message.includes("not found") || message.includes("404")) {
      return {
        success: false,
        error: "Google Sheet not found. Double-check the Sheet ID and make sure you shared the sheet with the service account email.",
      };
    }
    if (message.includes("permission") || message.includes("403")) {
      return {
        success: false,
        error: "Permission denied. Make sure you shared the Google Sheet with the service account email and gave it Editor access.",
      };
    }
    if (message.includes("INVALID") || message.includes("parse")) {
      return {
        success: false,
        error: "Invalid service account credentials. Please contact your administrator.",
      };
    }
    return {
      success: false,
      error: "Sync failed. Please check your Google Sheet ID and sharing permissions, then try again.",
    };
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

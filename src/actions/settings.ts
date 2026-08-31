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
    return { email: null, agent: null, orderEntryEnabled: false, dealerSessionExpiresAt: null };
  }

  try {
    const [user, wifibizzUser, dealer] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { orderEntryEnabled: true },
      }),
      prisma.wifibizzUser.findUnique({
        where: { userId: session.user.id },
        select: { wifibizzEmail: true, id: true },
      }),
      // For the sidebar's session warning — same column the submit gate reads.
      prisma.dealerAccount.findUnique({
        where: { userId: session.user.id },
        select: { sessionExpiresAt: true },
      }),
    ]);
    const orderEntryEnabled = !!user?.orderEntryEnabled;

    if (!wifibizzUser) {
      return { email: null, agent: null, orderEntryEnabled, dealerSessionExpiresAt: dealer?.sessionExpiresAt?.toISOString() ?? null };
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
      dealerSessionExpiresAt: dealer?.sessionExpiresAt?.toISOString() ?? null,
    };
  } catch {
    return { email: null, agent: null, orderEntryEnabled: false, dealerSessionExpiresAt: null };
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

// Superadmins can view/manage every user's Order Entry drafts, and may browse
// the drafts view without connecting a dealer portal session (view-only —
// submitting still requires a live portal connection).
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperAdmin: true },
    });
    return !!user?.isSuperAdmin;
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
    const { appendCasesToSheet, getSheetCaseNumbers, updateSheetAddresses } = await import("@/lib/google-sheets");
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

    // Append any unsynced cases (new since last sync).
    let appendedRows = 0;
    if (unsyncedCases.length > 0) {
      ({ appendedRows } = await appendCasesToSheet(
        wifibizzUser.googleSheetId,
        unsyncedCases
      ));
      const now = new Date();
      await prisma.wifibizzCase.updateMany({
        where: { id: { in: unsyncedCases.map((c) => c.id) } },
        data: { syncedToSheetAt: now },
      });
    }

    // Backfill addresses filled AFTER a case was first synced (e.g. at bill-
    // generation time) — append-only never updates those cells, so patch them.
    const withAddress = await prisma.wifibizzCase.findMany({
      where: {
        userId: wifibizzUser.id,
        syncedToSheetAt: { not: null },
        fullAddress: { not: null },
        NOT: { fullAddress: "" },
      },
      select: { caseNo: true, fullAddress: true },
    });
    const { updated: addressesUpdated } = await updateSheetAddresses(
      wifibizzUser.googleSheetId,
      withAddress
    );

    return { success: true, synced: appendedRows, addressesUpdated };
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

// ── Notification email ───────────────────────────────────────────────────────
/**
 * Where this user's order notifications go.
 *
 * One address per user. `notificationEmail` is nullable and a blank field means
 * "use my login email", resolved at send time by `resolveRecipient` — so the
 * form returns the login address separately, to show what blank actually means
 * rather than making the user guess.
 */
export async function getNotificationSettings() {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, notificationEmail: true },
  });
  const { notificationsConfigured } = await import("@/lib/notifications/resend");
  return {
    success: true as const,
    data: {
      notificationEmail: user?.notificationEmail ?? "",
      loginEmail: user?.email ?? null,
      // False means nothing will actually be delivered, whatever is saved here.
      // Surfaced rather than hidden: a form that silently saves an address into
      // a system that cannot send is how a missing key goes unnoticed until an
      // agent asks why they never got told about a failed order.
      configured: notificationsConfigured(),
    },
  };
}

export async function saveNotificationEmail(raw: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const value = raw.trim();
  const { isValidEmail } = await import("@/lib/notifications/recipient");
  // Empty is a legitimate value — it clears the override and falls back to the
  // login email. Only a non-empty, malformed address is refused.
  if (value && !isValidEmail(value)) {
    return { success: false as const, error: "That doesn't look like an email address." };
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { notificationEmail: value || null },
  });
  return { success: true as const, notificationEmail: value };
}

/**
 * Send one test email, and report exactly what happened.
 *
 * The address comes from what the agent has TYPED, not from what is saved, so a
 * new address can be checked before committing to it (`testTargetFor` holds the
 * rule, including the blank-means-login-email fallback).
 *
 * It runs even when `notificationsConfigured` says the environment has no mail
 * provider: the card already warns about that from an env check, and a button
 * that refuses to run can neither confirm nor contradict it. `sendEmail` never
 * throws, so the missing-key case comes back as an ordinary reason.
 *
 * Rate limited because this is otherwise an authenticated "send mail to any
 * address I type" primitive. It shares the auth limiter's window under its own
 * key, and that limiter fails open — a rate limiter outage must not take the
 * button down with it.
 */
export async function sendTestNotification(typed: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  const { checkRateLimit } = await import("@/lib/rate-limit");
  const gate = await checkRateLimit(`test-email:${session.user.id}`);
  if (!gate.success) {
    return {
      success: false as const,
      error: "Too many test emails. Wait a few minutes and try again.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  const { testTargetFor } = await import("@/lib/notifications/recipient");
  const target = testTargetFor(typed, { email: user?.email });
  if ("error" in target) return { success: false as const, error: target.error };

  const { testEmail } = await import("@/lib/notifications/templates");
  const { sendEmail } = await import("@/lib/notifications/resend");
  const { subject, html } = testEmail(target.to);
  const result = await sendEmail({ to: target.to, subject, html });

  if (!result.sent) {
    // Resend's own wording, not a paraphrase: "it didn't work" without a reason
    // is what sends someone digging through deployment logs.
    return {
      success: false as const,
      to: target.to,
      error: result.reason ?? "The email could not be sent.",
    };
  }
  return { success: true as const, to: target.to };
}

/**
 * The getting-started checklist's one question: has this agent ever connected
 * a dealer account? Judged on lastConnectedAt, not the session's liveness — a
 * lapsed session is a RECONNECT problem (the sidebar warning's job), not an
 * onboarding one, and a checklist that reopened on every expiry would nag
 * people who finished it weeks ago.
 */
export async function getOnboardingState() {
  const session = await auth();
  if (!session?.user?.id) return { show: false as const };
  try {
    const [user, dealer] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { orderEntryEnabled: true },
      }),
      prisma.dealerAccount.findUnique({
        where: { userId: session.user.id },
        select: { lastConnectedAt: true },
      }),
    ]);
    // Agents without order-entry access have nothing to set up — their
    // onboarding IS complete at sign-in.
    if (!user?.orderEntryEnabled) return { show: false as const };
    if (dealer?.lastConnectedAt) return { show: false as const };
    return { show: true as const };
  } catch {
    return { show: false as const };
  }
}
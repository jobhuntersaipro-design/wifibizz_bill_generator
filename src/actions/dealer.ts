"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
const INTERNAL_TOKEN = process.env.ORDER_ENTRY_API_TOKEN;

// How long we treat a captured dealer session as good before prompting a
// reconnect. Kept short (1h) and backed by the live status check.
const SESSION_TTL_MS = 60 * 60 * 1000;

type ScraperResult = { ok: boolean; status: number; data: Record<string, unknown> };

async function callScraper(path: string, body: unknown): Promise<ScraperResult> {
  const res = await fetch(`${SCRAPER_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_TOKEN ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export type DealerConnection = {
  staffCode: string;
  lastConnectedAt: string | null;
  sessionExpiresAt: string | null;
  connected: boolean;
};

export async function getDealerConnection() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: null as DealerConnection | null };
  }

  const acct = await prisma.dealerAccount.findUnique({
    where: { userId: session.user.id },
  });

  if (!acct) {
    return { success: true, data: null as DealerConnection | null };
  }

  const connected =
    !!acct.sessionExpiresAt && acct.sessionExpiresAt.getTime() > Date.now();

  return {
    success: true,
    data: {
      staffCode: acct.staffCode,
      lastConnectedAt: acct.lastConnectedAt?.toISOString() ?? null,
      sessionExpiresAt: acct.sessionExpiresAt?.toISOString() ?? null,
      connected,
    } satisfies DealerConnection,
  };
}

export async function checkDealerConnection() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: null as DealerConnection | null };
  }

  const acct = await prisma.dealerAccount.findUnique({
    where: { userId: session.user.id },
  });
  if (!acct) {
    return { success: true, data: null as DealerConnection | null };
  }

  // Ask Flask to actually load the saved session and hit the portal.
  let connected = false;
  try {
    const { ok, data } = await callScraper("/dealer/login/status", {
      user_key: session.user.id,
    });
    connected = ok && data.connected === true;
  } catch {
    // Can't reach the service — fall back to the stored expiry as a best guess.
    connected =
      !!acct.sessionExpiresAt && acct.sessionExpiresAt.getTime() > Date.now();
    return {
      success: true,
      unreachable: true,
      data: {
        staffCode: acct.staffCode,
        lastConnectedAt: acct.lastConnectedAt?.toISOString() ?? null,
        sessionExpiresAt: acct.sessionExpiresAt?.toISOString() ?? null,
        connected,
      } satisfies DealerConnection,
    };
  }

  // Session timed out — clear the expiry so the UI reflects "needs reconnect".
  if (!connected && acct.sessionExpiresAt) {
    await prisma.dealerAccount.update({
      where: { userId: session.user.id },
      data: { sessionExpiresAt: null },
    });
  }

  return {
    success: true,
    data: {
      staffCode: acct.staffCode,
      lastConnectedAt: acct.lastConnectedAt?.toISOString() ?? null,
      sessionExpiresAt: connected
        ? acct.sessionExpiresAt?.toISOString() ?? null
        : null,
      connected,
    } satisfies DealerConnection,
  };
}

export async function requestDealerOtp(
  staffCode: string,
  password: string,
  channel: "Email" | "SMS"
) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  if (!staffCode || !password) {
    return { success: false, error: "Staff code and password are required." };
  }
  if (!INTERNAL_TOKEN) {
    return {
      success: false,
      error: "Order service is not configured yet. Contact your administrator.",
    };
  }

  try {
    const { ok, data } = await callScraper("/dealer/login/request-otp", {
      staff_code: staffCode,
      password,
      channel,
      user_key: session.user.id,
    });

    if (!ok || data.success === false) {
      return {
        success: false,
        error:
          (data.message as string) ||
          "Couldn't reach the portal. Check your staff code and password, then try again.",
      };
    }

    // Remember the staff code so we can prefill it next time. Never store the password.
    await prisma.dealerAccount.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, staffCode },
      update: { staffCode },
    });

    return {
      success: true,
      pendingId: data.pending_id as string,
      expiresIn: (data.expires_in as number) ?? 240,
    };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the order service. Is it running?",
    };
  }
}

export async function submitDealerOtp(pendingId: string, otp: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  if (!pendingId || !otp) {
    return { success: false, error: "Enter the OTP you received." };
  }

  try {
    const { ok, data } = await callScraper("/dealer/login/submit-otp", {
      pending_id: pendingId,
      otp,
    });

    if (!ok || data.success === false) {
      return {
        success: false,
        error:
          (data.message as string) ||
          "OTP verification failed — it may be wrong or expired. Start again.",
      };
    }

    const now = new Date();
    await prisma.dealerAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        staffCode: "",
        lastConnectedAt: now,
        sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
      update: {
        lastConnectedAt: now,
        sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });

    return { success: true };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the order service. Is it running?",
    };
  }
}

export async function cancelDealerOtp(pendingId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false };
  if (!pendingId) return { success: true };
  try {
    await callScraper("/dealer/login/cancel", { pending_id: pendingId });
  } catch {
    // best-effort — the pending login times out server-side anyway.
  }
  return { success: true };
}

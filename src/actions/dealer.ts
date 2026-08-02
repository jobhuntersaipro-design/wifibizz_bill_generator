"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

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

  // Reconcile the stored expiry with what the portal just told us, so the badge
  // and the countdown can never contradict each other:
  //  - connected  -> the session is provably alive, so (re)start the TTL clock
  //    from now. This is what stops the confusing "Connected" + "expired" state
  //    (the old code kept a stale, already-elapsed expiry).
  //  - not connected -> clear the expiry so the UI shows "needs reconnect".
  const refreshedExpiry = connected ? new Date(Date.now() + SESSION_TTL_MS) : null;
  if (
    (refreshedExpiry?.getTime() ?? null) !==
    (acct.sessionExpiresAt?.getTime() ?? null)
  ) {
    await prisma.dealerAccount.update({
      where: { userId: session.user.id },
      data: { sessionExpiresAt: refreshedExpiry },
    });
  }

  return {
    success: true,
    data: {
      staffCode: acct.staffCode,
      lastConnectedAt: acct.lastConnectedAt?.toISOString() ?? null,
      sessionExpiresAt: refreshedExpiry?.toISOString() ?? null,
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

  // Throttle so BizzFlow can't be used to password-spray the real Unifi dealer
  // portal (which would lock/flag the staff account).
  const rl = await checkRateLimit(`dealer-otp:${session.user.id}:${staffCode}`);
  if (!rl.success) {
    return {
      success: false,
      error: "Too many login attempts. Wait a few minutes and try again.",
    };
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
      user_key: session.user.id,
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
    await callScraper("/dealer/login/cancel", {
      pending_id: pendingId,
      user_key: session.user.id,
    });
  } catch {
    // best-effort — the pending login times out server-side anyway.
  }
  return { success: true };
}

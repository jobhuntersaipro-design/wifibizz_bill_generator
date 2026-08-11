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
  registeredEmail: string | null;
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
      registeredEmail: acct.registeredEmail,
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
        registeredEmail: acct.registeredEmail,
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
      registeredEmail: acct.registeredEmail,
      lastConnectedAt: acct.lastConnectedAt?.toISOString() ?? null,
      sessionExpiresAt: refreshedExpiry?.toISOString() ?? null,
      connected,
    } satisfies DealerConnection,
  };
}

export async function requestDealerOtp(
  staffCode: string,
  password: string,
  channel: "Email" | "SMS",
  registeredEmail?: string
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
      registered_email: registeredEmail?.trim() || undefined,
    });

    if (!ok || data.success === false) {
      return {
        success: false,
        error:
          (data.message as string) ||
          "Couldn't reach the portal. Check your staff code and password, then try again.",
      };
    }

    // Remember the staff code (and registered email, for auto-OTP's `to:`
    // filter) so we can prefill both next time. Never store the password.
    await prisma.dealerAccount.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, staffCode, registeredEmail: registeredEmail?.trim() || null },
      update: { staffCode, registeredEmail: registeredEmail?.trim() || null },
    });

    return {
      success: true,
      pendingId: data.pending_id as string,
      expiresIn: (data.expires_in as number) ?? 240,
      // true for every Email-channel login — the server always attempts to
      // read the OTP from Gmail, but only succeeds if it actually lands in
      // the mailbox the server has access to; otherwise it times out and
      // falls back to the manual flow below. See
      // context/features/gmail-otp-auto-read-spec.md.
      autoOtp: data.auto_otp === true,
    };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the order service. Is it running?",
    };
  }
}

async function markDealerConnected(userId: string) {
  const now = new Date();
  await prisma.dealerAccount.upsert({
    where: { userId },
    create: {
      userId,
      staffCode: "",
      lastConnectedAt: now,
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
    update: {
      lastConnectedAt: now,
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });
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

    await markDealerConnected(session.user.id);
    return { success: true };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the order service. Is it running?",
    };
  }
}

export type DealerOtpAutoStatus = {
  status: "pending" | "completed" | "timeout" | "error" | "not_applicable" | "not_found";
  message?: string;
};

// Poll target for the auto-read path (see requestDealerOtp's `autoOtp` flag).
// Only meaningful when that flag came back true — callers should skip polling
// entirely for "not_applicable" logins and show the manual OTP form right away.
export async function checkDealerOtpAutoStatus(
  pendingId: string
): Promise<{ success: boolean; data?: DealerOtpAutoStatus; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  if (!pendingId) return { success: false, error: "Missing pending login." };

  try {
    const { ok, data } = await callScraper("/dealer/login/auto-status", {
      pending_id: pendingId,
      user_key: session.user.id,
    });

    if (!ok || data.success === false) {
      return { success: false, error: (data.message as string) || "Status check failed." };
    }

    const status = data.status as DealerOtpAutoStatus["status"];
    if (status === "completed") {
      await markDealerConnected(session.user.id);
    }

    return {
      success: true,
      data: { status, message: data.message as string | undefined },
    };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the order service. Is it running?",
    };
  }
}

// One-shot manual retry: check the shared inbox right now instead of waiting
// out the rest of the auto-read window or typing the code by hand. Same
// success shape as submitDealerOtp; error === "not_found" means "nothing yet,
// try again shortly" rather than a hard failure — surface that as a gentle
// message, not a scary error toast.
export async function checkDealerOtpNow(pendingId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  if (!pendingId) return { success: false, error: "Missing pending login." };

  try {
    const { ok, data } = await callScraper("/dealer/login/check-now", {
      pending_id: pendingId,
      user_key: session.user.id,
    });

    if (!ok || data.success === false) {
      return {
        success: false,
        notFound: data.error === "not_found",
        // Not a failure — the code was already found and the login is
        // completing right now; the auto-status poll will report success.
        connecting: data.error === "connecting",
        error: (data.message as string) || "Couldn't check for the OTP right now.",
      };
    }

    await markDealerConnected(session.user.id);
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

// Ends the connected Unifi dealer portal session — distinct from the
// BizzFlow account itself (that's the sidebar's own Logout). Best-effort on
// the scraper call (drops the saved session file server-side) but always
// clears the local "connected" state so the UI reflects it either way.
export async function disconnectDealerAccount() {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  try {
    await callScraper("/dealer/login/logout", { user_key: session.user.id });
  } catch {
    // best-effort — still clear local state below even if unreachable.
  }

  // updateMany (not update) so this doesn't throw if there's nothing to
  // disconnect — same best-effort spirit as the scraper call above.
  await prisma.dealerAccount.updateMany({
    where: { userId: session.user.id },
    data: { sessionExpiresAt: null, lastConnectedAt: null },
  });

  return { success: true };
}

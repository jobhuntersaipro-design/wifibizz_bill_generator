import { formatDuration } from "@/lib/order-types";

/**
 * Whether an agent's dealer portal session is good enough to submit with.
 *
 * Read from the STORED expiry, exactly as `dealerSessionLive()` in
 * `order-start.ts` does when it decides whether to start a run. Same column,
 * same rule — so what admin sees and what the submit actually does cannot
 * disagree. Deliberately no droplet call: this renders for every agent on a
 * table, and a per-row portal check would be both slow and pointless, since the
 * submit re-reads the same value anyway.
 *
 * **A green row means "should be able to submit", not a guarantee.** The portal
 * can invalidate a session early — a password change, a login elsewhere — and
 * the app only learns that when a run fails.
 */

export type ConnectionState = "connected" | "expiring" | "expired" | "never";

export interface ConnectionView {
  state: ConnectionState;
  label: string;
  /** How to colour it. Kept beside the words so the two cannot drift apart. */
  tone: "good" | "warn" | "muted";
}

/**
 * A session with less than this left is called out.
 *
 * A submit takes minutes and the portal drops you mid-run when the session
 * lapses — which strands an order the portal has already numbered. So "expires
 * in 12 minutes" is a warning, not a green light.
 */
export const EXPIRING_SOON_MS = 30 * 60 * 1000;

export const DEALER_SESSION_EXPIRED_COPY = {
  title: "Dealer session expired",
  body: "Reconnect to submit orders",
  cta: "Reconnect",
} as const;

export const DEALER_SESSION_RECONNECT_HREF = "/dashboard/order-entry";

/** Staff QA hook. `?forceDealerExpired=1` shows the expired banner without writing `session_expires_at`. */
export function forceDealerExpiredFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("forceDealerExpired") === "1";
}

/**
 * Chrome banner only. A live or never-connected session is silent.
 * Same stored expiry `describeConnection` and the submit gate already share.
 */
export function shouldShowDealerSessionBanner(
  input: {
    orderEntryEnabled: boolean;
    sessionExpiresAt?: Date | string | null;
  },
  now?: Date,
): boolean {
  if (!input.orderEntryEnabled) return false;
  return describeConnection(input, now).state === "expired";
}

export function describeConnection(
  dealer: { sessionExpiresAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): ConnectionView {
  const raw = dealer?.sessionExpiresAt;
  if (!raw) return { state: "never", label: "Never connected", tone: "muted" };

  const expires = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(expires.getTime())) {
    // An unreadable timestamp is not evidence of a live session, and claiming
    // one would send an admin to look somewhere else when a run fails.
    return { state: "never", label: "Never connected", tone: "muted" };
  }

  const ms = expires.getTime() - now.getTime();
  if (ms <= 0) return { state: "expired", label: `Expired ${formatDuration(-ms)} ago`, tone: "warn" };
  if (ms <= EXPIRING_SOON_MS) {
    return { state: "expiring", label: `Connected · expires in ${formatDuration(ms)}`, tone: "warn" };
  }
  return { state: "connected", label: `Connected · expires in ${formatDuration(ms)}`, tone: "good" };
}

/** Can this agent start a submit right now? The same test `dealerSessionLive` applies. */
export function isConnected(view: ConnectionView): boolean {
  return view.state === "connected" || view.state === "expiring";
}

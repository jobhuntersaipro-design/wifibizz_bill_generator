/**
 * Whether an agent can submit, as admin sees it.
 *
 * The rule has to match `dealerSessionLive()` in order-start.ts, which decides
 * whether a run may start: if admin's badge and the submit gate disagreed, a
 * green row would sit next to an agent whose every submit fails, and the page
 * would send you looking in the wrong place.
 */
import { describe, it, expect } from "vitest";
import {
  describeConnection,
  isConnected,
  EXPIRING_SOON_MS,
  shouldShowDealerSessionBanner,
  DEALER_SESSION_EXPIRED_COPY,
  forceDealerExpiredFromSearch,
  forceExpiredFromParam,
  orderEntryLandingPath,
  withForceDealerExpiredQuery,
} from "@/lib/agent-connection";

const NOW = new Date("2026-08-30T12:00:00Z");
const inMs = (ms: number) => ({ sessionExpiresAt: new Date(NOW.getTime() + ms) });

describe("describeConnection", () => {
  it("reports a live session with how long is left", () => {
    const v = describeConnection(inMs(4 * 3600_000 + 12 * 60_000), NOW);
    expect(v.state).toBe("connected");
    expect(v.label).toBe("Connected · expires in 4h 12m");
    expect(v.tone).toBe("good");
  });

  it("warns when a session will not outlive a submit", () => {
    // A run takes minutes and the portal drops you mid-flight when the session
    // lapses — which strands an order the portal has already numbered.
    const v = describeConnection(inMs(12 * 60_000), NOW);
    expect(v.state).toBe("expiring");
    expect(v.tone).toBe("warn");
    expect(v.label).toBe("Connected · expires in 12m 0s");
  });

  it("puts the warning boundary exactly at the threshold", () => {
    expect(describeConnection(inMs(EXPIRING_SOON_MS), NOW).state).toBe("expiring");
    expect(describeConnection(inMs(EXPIRING_SOON_MS + 1000), NOW).state).toBe("connected");
  });

  it("reports an expired session with how long ago", () => {
    const v = describeConnection(inMs(-2 * 24 * 3600_000), NOW);
    expect(v.state).toBe("expired");
    expect(v.label).toBe("Expired 48h 0m ago");
    expect(v.tone).toBe("warn");
  });

  it("treats the moment of expiry as expired, not connected", () => {
    expect(describeConnection(inMs(0), NOW).state).toBe("expired");
  });

  it("says never connected when there is no dealer account at all", () => {
    expect(describeConnection(null, NOW).state).toBe("never");
    expect(describeConnection(undefined, NOW).state).toBe("never");
    expect(describeConnection({ sessionExpiresAt: null }, NOW).state).toBe("never");
  });

  it("never claims a session from an unreadable timestamp", () => {
    // Claiming one would send an admin looking elsewhere when the run fails.
    const v = describeConnection({ sessionExpiresAt: "not-a-date" }, NOW);
    expect(v.state).toBe("never");
  });

  it("accepts an ISO string as well as a Date", () => {
    // Server components serialise Dates to strings on the way to the client.
    const v = describeConnection(
      { sessionExpiresAt: new Date(NOW.getTime() + 3600_000).toISOString() }, NOW,
    );
    expect(v.state).toBe("connected");
  });
});

describe("shouldShowDealerSessionBanner", () => {
  it("shows only for an expired session the agent is allowed to reconnect", () => {
    expect(
      shouldShowDealerSessionBanner({ orderEntryEnabled: true, ...inMs(-1000) }, NOW),
    ).toBe(true);
  });

  it("stays hidden while the session can still submit", () => {
    expect(
      shouldShowDealerSessionBanner({ orderEntryEnabled: true, ...inMs(60_000) }, NOW),
    ).toBe(false);
    expect(
      shouldShowDealerSessionBanner({ orderEntryEnabled: true, ...inMs(4 * 3600_000) }, NOW),
    ).toBe(false);
  });

  it("stays hidden when Order Entry is off or the agent never connected", () => {
    expect(
      shouldShowDealerSessionBanner({ orderEntryEnabled: false, ...inMs(-1000) }, NOW),
    ).toBe(false);
    expect(
      shouldShowDealerSessionBanner({ orderEntryEnabled: true, sessionExpiresAt: null }, NOW),
    ).toBe(false);
  });

  it("uses the unified expired-session copy", () => {
    expect(DEALER_SESSION_EXPIRED_COPY).toEqual({
      title: "Dealer session expired",
      body: "Reconnect to submit orders",
      cta: "Reconnect",
    });
  });
});

describe("forceDealerExpiredFromSearch", () => {
  it("is true for forceDealerExpired=1 when NEXT_PUBLIC_VERCEL_ENV is production", () => {
    const prev = process.env.NEXT_PUBLIC_VERCEL_ENV;
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    try {
      expect(forceDealerExpiredFromSearch("?forceDealerExpired=1")).toBe(true);
    } finally {
      process.env.NEXT_PUBLIC_VERCEL_ENV = prev;
    }
  });

  it("is false without the query", () => {
    expect(forceDealerExpiredFromSearch("")).toBe(false);
    expect(forceDealerExpiredFromSearch("?forceDealerExpired=0")).toBe(false);
  });
});

describe("forceExpiredFromParam", () => {
  it("reads the page searchParams shape", () => {
    expect(forceExpiredFromParam("1")).toBe(true);
    expect(forceExpiredFromParam(["1"])).toBe(true);
    expect(forceExpiredFromParam("0")).toBe(false);
    expect(forceExpiredFromParam(undefined)).toBe(false);
  });
});

describe("orderEntryLandingPath", () => {
  it("sends an expired session to reconnect, not new-order", () => {
    expect(
      orderEntryLandingPath({ forceExpired: false, ...inMs(-1000) }),
    ).toBe("/dashboard/order-entry/reconnect");
  });

  it("sends a prior connection that is no longer live to reconnect", () => {
    expect(
      orderEntryLandingPath({
        forceExpired: false,
        connected: false,
        lastConnectedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toBe("/dashboard/order-entry/reconnect");
  });

  it("keeps a live session on new-order", () => {
    expect(
      orderEntryLandingPath({
        forceExpired: false,
        connected: true,
        lastConnectedAt: "2026-08-01T00:00:00.000Z",
        ...inMs(60_000),
      }),
    ).toBe("/dashboard/order-entry/new-order");
  });

  it("keeps a first-time agent on new-order", () => {
    expect(
      orderEntryLandingPath({ forceExpired: false, connected: false }),
    ).toBe("/dashboard/order-entry/new-order");
  });

  it("forces reconnect IA even when the stored session is still live", () => {
    expect(
      orderEntryLandingPath({
        forceExpired: true,
        connected: true,
        ...inMs(60_000),
      }),
    ).toBe("/dashboard/order-entry/reconnect");
  });
});

describe("withForceDealerExpiredQuery", () => {
  it("keeps the QA flag on the landing URL", () => {
    expect(
      withForceDealerExpiredQuery("/dashboard/order-entry/reconnect", true),
    ).toBe("/dashboard/order-entry/reconnect?forceDealerExpired=1");
    expect(
      withForceDealerExpiredQuery("/dashboard/order-entry/new-order", false),
    ).toBe("/dashboard/order-entry/new-order");
  });
});

describe("isConnected", () => {
  it("counts a soon-to-expire session as still able to submit", () => {
    // It is a warning, not a block — the submit itself would be allowed.
    expect(isConnected(describeConnection(inMs(60_000), NOW))).toBe(true);
    expect(isConnected(describeConnection(inMs(4 * 3600_000), NOW))).toBe(true);
  });

  it("does not count expired or absent sessions", () => {
    expect(isConnected(describeConnection(inMs(-1000), NOW))).toBe(false);
    expect(isConnected(describeConnection(null, NOW))).toBe(false);
  });
});

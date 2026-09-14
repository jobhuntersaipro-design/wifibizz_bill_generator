import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A submit the droplet refused because its slots were full.
 *
 * Live incident (2026-08-31): account 2 pressed Submit while account 1's run
 * held the single slot; the droplet answered 409 SERVER_AT_CAPACITY and the
 * order landed as a bare Failed — "unclassified failure, tell your admin" —
 * with nothing ever coming back for it. A busy refusal is the box, not the
 * order, so the same start that files it as failed must also leave a due date
 * for the retry sweep, exactly as the automatic-retry path already does.
 */

const orderUpdate = vi.fn();
const dealerFindUnique = vi.fn();
const recordEvent = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { update: (...a: unknown[]) => orderUpdate(...a) },
    dealerAccount: { findUnique: (...a: unknown[]) => dealerFindUnique(...a) },
  },
}));
vi.mock("@/lib/order-history", () => ({
  recordEvent: (...a: unknown[]) => recordEvent(...a),
}));
vi.mock("@/actions/plans", () => ({
  mandatoryGroupsFor: vi.fn().mockResolvedValue({ all: [], devices: [] }),
}));

vi.stubGlobal("fetch", fetchMock);
process.env.ORDER_ENTRY_API_TOKEN = "test-token";

const { startSubmitRun } = await import("@/lib/order-start");
const { retryVerdict } = await import("@/lib/retry-policy");

const ORDER = {
  id: "ord_1",
  userId: "user_1",
  attempt: 0,
  autoRetries: 0,
  appointmentLeadHours: null,
  offerName: "Some Plan",
  documents: [],
} as never;

/** The last order.update call's data payload. */
const lastUpdateData = () =>
  orderUpdate.mock.calls[orderUpdate.mock.calls.length - 1][0].data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  // A live dealer session, so the start reaches the droplet.
  dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3600_000) });
});

describe("startSubmitRun when the droplet is busy", () => {
  it("files a 409 SERVER_AT_CAPACITY as failed WITH a retry due date, in the same write", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "SERVER_AT_CAPACITY",
        message: "All 1 submit slots are busy. Your turn shortly.",
      }),
    });
    const res = await startSubmitRun(ORDER, { userKey: "user_1" });
    expect(res).toMatchObject({ ok: false, busy: true });
    const data = lastUpdateData();
    expect(data.status).toBe("failed");
    // The load-bearing part: the due date rides in the SAME update as the
    // status, so there is no window where the row is failed with nothing owed.
    expect(data.autoRetryAt).toBeInstanceOf(Date);
    expect((data.autoRetryAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("an unreachable droplet defers too — a dead box is not this order's fault", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await startSubmitRun(ORDER, { userKey: "user_1" });
    expect(res).toMatchObject({ ok: false, busy: true });
    expect(lastUpdateData().autoRetryAt).toBeInstanceOf(Date);
  });

  it("a real refusal (non-busy) stays a plain failure with nothing owed", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Bad order payload." }),
    });
    const res = await startSubmitRun(ORDER, { userKey: "user_1" });
    expect(res).toMatchObject({ ok: false, busy: false });
    expect(lastUpdateData().autoRetryAt).toBeUndefined();
  });

  it("the droplet's busy sentence passes the retry policy, so the sweep will really run it", () => {
    expect(
      retryVerdict({
        status: "failed",
        errorCode: null,
        errorMessage: "All 1 submit slots are busy. Your turn shortly.",
        autoRetries: 0,
        attempt: 1,
      }).retry,
    ).toBe(true);
  });
});

describe("startSubmitRun records the submitting staff code", () => {
  it("stamps the SUBMITTER's staff code onto the order in the attempt write", async () => {
    dealerFindUnique.mockResolvedValue({
      staffCode: " TMRS00517 ",
      sessionExpiresAt: new Date(Date.now() + 3600_000),
    });
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await startSubmitRun(ORDER, { userKey: "admin_1" });
    const attemptWrite = orderUpdate.mock.calls[0][0];
    expect(attemptWrite.data.submittedStaffCode).toBe("TMRS00517");
    // Looked up by whoever pressed Submit, not by the draft's owner.
    expect(dealerFindUnique.mock.calls[0][0].where).toEqual({ userId: "admin_1" });
  });

  it("leaves an earlier record alone when the submitter has no code", async () => {
    dealerFindUnique.mockResolvedValue(null);
    await startSubmitRun(ORDER, { userKey: "user_1" });
    expect("submittedStaffCode" in orderUpdate.mock.calls[0][0].data).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting a failed submit again — the side-effecting half.
 *
 * What matters here is not "does it retry" (that is `retry-policy.test.ts`,
 * pure) but that it retries exactly ONCE. Two runs mean two real orders at
 * Unifi, each with its own advance payment, so the claim has to survive the
 * webhook and a page load racing each other.
 */

const orderFindUnique = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdateMany = vi.fn();
const orderUpdate = vi.fn();
const orderFindMany = vi.fn();
const recordEvent = vi.fn();
const startSubmitRun = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: (...a: unknown[]) => orderFindUnique(...a),
      // maybeAutoRetry resolves the order with findFirst, not findUnique, so it
      // can carry the ACTIVE_ORDER filter — a deleted order must never retry.
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
      findMany: (...a: unknown[]) => orderFindMany(...a),
    },
  },
}));
vi.mock("@/lib/order-history", () => ({
  recordEvent: (...a: unknown[]) => recordEvent(...a),
}));
vi.mock("@/lib/order-start", () => ({
  startSubmitRun: (...a: unknown[]) => startSubmitRun(...a),
  // The busy-deferral delay really lives in order-start (startSubmitRun stamps
  // it too); the mock must carry it or the deferral date computes from NaN.
  BUSY_RETRY_DELAY_MS: 2 * 60 * 1000,
}));

const { maybeAutoRetry, sweepPendingRetries } = await import("@/lib/order-retry");

/** A run that died on a timeout, with nothing else wrong. */
const ORDER = {
  id: "ord_1",
  userId: "user_1",
  lastSubmitUserId: "boss_1",
  status: "failed",
  errorCode: null,
  errorMessage: "Timeout 30000ms exceeded.",
  orderId: null as string | null,
  autoRetries: 0,
  attempt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  orderFindFirst.mockResolvedValue({ ...ORDER });
  orderUpdateMany.mockResolvedValue({ count: 1 });
  orderUpdate.mockResolvedValue({});
  startSubmitRun.mockResolvedValue({ ok: true, jobId: "job_2", attempt: 2 });
});

describe("maybeAutoRetry", () => {
  it("starts one run and reports it, so the caller withholds the email", async () => {
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("retried");
    expect(startSubmitRun).toHaveBeenCalledTimes(1);
  });

  it("runs under the session that ran the last submit, not the draft's owner", async () => {
    // A superadmin submits another agent's draft under their OWN portal session.
    // Retrying as `userId` would run as an agent who may have no session at all.
    await maybeAutoRetry("ord_1");
    expect(startSubmitRun.mock.calls[0][1]).toMatchObject({ userKey: "boss_1", auto: true });
  });

  it("falls back to the owner when no submitting session was recorded", async () => {
    orderFindFirst.mockResolvedValue({ ...ORDER, lastSubmitUserId: null });
    await maybeAutoRetry("ord_1");
    expect(startSubmitRun.mock.calls[0][1]).toMatchObject({ userKey: "user_1" });
  });

  it("claims the try against the count it read, so a race starts one run", async () => {
    await maybeAutoRetry("ord_1");
    const where = orderUpdateMany.mock.calls[0][0].where;
    // The equality on autoRetries IS the lock: a second caller reading the same
    // value writes second, matches nothing, and gives up.
    expect(where).toMatchObject({ id: "ord_1", autoRetries: 0, status: "failed" });
    expect(orderUpdateMany.mock.calls[0][0].data).toMatchObject({ autoRetries: 1 });
  });

  it("does not start anything when another caller won the claim", async () => {
    orderUpdateMany.mockResolvedValue({ count: 0 });
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("no");
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("refuses a terminal failure and says so in the history", async () => {
    orderFindFirst.mockResolvedValue({ ...ORDER, errorCode: "device_out_of_stock" });
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("no");
    expect(startSubmitRun).not.toHaveBeenCalled();
    expect(recordEvent.mock.calls[0][0].message).toContain("No automatic retry");
  });

  it("says nothing at all about an order that succeeded", async () => {
    orderFindFirst.mockResolvedValue({ ...ORDER, status: "submitted" });
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("no");
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("does not startSubmit after next_click_failed when a portal order exists", async () => {
    orderFindFirst.mockResolvedValue({
      ...ORDER,
      status: "warning",
      errorCode: "next_click_failed",
      errorMessage: "nonext",
      orderId: "2609000125814861",
    });
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("no");
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("names the stranded portal order before the next run overwrites it", async () => {
    // The number is only reachable from the row until the retry replaces it, and
    // it is what someone needs in order to void the duplicate.
    orderFindFirst.mockResolvedValue({
      ...ORDER,
      status: "warning",
      orderId: "2608000122816567",
    });
    await maybeAutoRetry("ord_1");
    const messages = recordEvent.mock.calls.map((c) => c[0].message as string);
    const named = messages.find((m) => m.includes("2608000122816567"));
    expect(named).toBeTruthy();
    expect(named).toContain("void");
    // Written before the run that replaces it, not after.
    expect(recordEvent).toHaveBeenCalledBefore(startSubmitRun);
  });

  describe("when the droplet is busy with someone else's job", () => {
    beforeEach(() => {
      startSubmitRun.mockResolvedValue({ ok: false, busy: true, error: "JOB_IN_PROGRESS" });
    });

    it("gives the try back — a held lock is not this order's failure", async () => {
      await expect(maybeAutoRetry("ord_1")).resolves.toBe("deferred");
      expect(orderUpdate.mock.calls[0][0].data.autoRetries).toBe(ORDER.autoRetries);
    });

    it("leaves a due date so the sweep comes back for it", async () => {
      await maybeAutoRetry("ord_1");
      expect(orderUpdate.mock.calls[0][0].data.autoRetryAt).toBeInstanceOf(Date);
    });
  });

  it("reports a real refusal as finished, so the email goes out", async () => {
    // An expired session is not something a retry fixes, and the agent has to be
    // told rather than left waiting for a run that will not happen.
    startSubmitRun.mockResolvedValue({ ok: false, busy: false, error: "session expired" });
    await expect(maybeAutoRetry("ord_1")).resolves.toBe("no");
  });
});

describe("sweepPendingRetries", () => {
  it("claims each due row before acting, so two sweepers cannot double-start", async () => {
    orderFindMany.mockResolvedValue([{ id: "ord_1" }]);
    await sweepPendingRetries();
    // The first write clears the due date conditionally; that is the claim.
    expect(orderUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "ord_1", autoRetryAt: { not: null } },
      data: { autoRetryAt: null },
    });
  });

  it("skips a row another sweeper already took", async () => {
    orderFindMany.mockResolvedValue([{ id: "ord_1" }]);
    orderUpdateMany.mockResolvedValue({ count: 0 });
    await expect(sweepPendingRetries()).resolves.toBe(0);
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("only looks at rows that still have budget", async () => {
    orderFindMany.mockResolvedValue([]);
    await sweepPendingRetries();
    expect(orderFindMany.mock.calls[0][0].where).toMatchObject({
      autoRetries: { lt: 3 },
      status: { in: ["failed", "warning"] },
    });
  });
});

describe("a deleted order must never be retried", () => {
  /**
   * The expensive failure this guards.
   *
   * The portal mints its order number EARLY, so a retry on an order the agent
   * deleted creates a real, billable order at Unifi — and there is no row in
   * the agent's list to show it happened. Deleting clears `autoRetryAt`, but the
   * sweep must refuse it independently: one write elsewhere is not enough to
   * rest an outcome like that on.
   */
  it("is not selected by the sweep", async () => {
    orderFindMany.mockResolvedValue([]);
    await sweepPendingRetries();
    const where = orderFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
  });

  it("is refused even if the sweep somehow hands it over", async () => {
    // findFirst carries the filter, so a deleted row resolves to null and the
    // retry stops at "no" rather than starting a run.
    orderFindFirst.mockResolvedValue(null);
    await expect(maybeAutoRetry("ord_deleted")).resolves.toBe("no");
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("looks the order up with the deleted filter, not by bare id", async () => {
    orderFindFirst.mockResolvedValue(null);
    await maybeAutoRetry("ord_1");
    expect(orderFindFirst.mock.calls[0][0].where).toMatchObject({
      id: "ord_1",
      deletedAt: null,
    });
  });
});

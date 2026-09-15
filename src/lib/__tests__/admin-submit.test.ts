import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * adminSubmitOrder: every refusal leaves the order untouched; a good call sets
 * autoRetryDisabled, maps Stop before Pay to doPay:false, asks for the live
 * view, audits, and returns a token bound to the job.
 */
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const userFindUnique = vi.fn();
const dealerFindMany = vi.fn();
const startSubmitRun = vi.fn();
const dealerSessionLive = vi.fn();
const recordAudit = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: (...a: unknown[]) => orderFindFirst(...a), update: (...a: unknown[]) => orderUpdate(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a), findMany: (...a: unknown[]) => dealerFindMany(...a) },
  },
}));
vi.mock("@/lib/admin-gate", () => ({ requireAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/order-start", () => ({
  startSubmitRun: (...a: unknown[]) => startSubmitRun(...a),
  dealerSessionLive: (...a: unknown[]) => dealerSessionLive(...a),
  SCRAPER_API_URL: "http://droplet",
  ORDER_TOKEN: "test-token",
}));
vi.mock("@/lib/audit", () => ({ ADMIN_ACTOR: "admin", recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.stubGlobal("fetch", fetchMock);
process.env.ORDER_ENTRY_API_TOKEN = "test-token";

const { adminSubmitOrder, adminLiveViewToken, adminStopJob, adminSubmitTargets } = await import("@/actions/admin-submit");
const { verifyLiveViewToken } = await import("@/lib/live-view-token");

const base = { id: "ord_1", reference: "ORD-0001", status: "failed", autoRetries: 0, autoRetryAt: null, jobId: null, deletedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({ id: "u2", email: "b@x", orderEntryEnabled: true, dealerAccount: { staffCode: "TMRS00517" } });
  dealerSessionLive.mockResolvedValue(true);
  startSubmitRun.mockResolvedValue({ ok: true, jobId: "job_9" });
});

describe("adminSubmitOrder refusals leave the order untouched", () => {
  it.each([
    ["submitting", "A run is already in flight"],
    ["submitted", "already been submitted"],
    ["cancelled", "cancelled"],
  ])("status %s", async (status, words) => {
    orderFindFirst.mockResolvedValue({ ...base, status });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toContain(words);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(startSubmitRun).not.toHaveBeenCalled();
  });

  it("a pending automatic retry", async () => {
    orderFindFirst.mockResolvedValue({ ...base, autoRetryAt: new Date(), autoRetries: 1 });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("a deleted or unknown order", async () => {
    orderFindFirst.mockResolvedValue(null);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "Order not found." });
  });

  it("a target without Order Entry access", async () => {
    orderFindFirst.mockResolvedValue(base);
    userFindUnique.mockResolvedValue({ id: "u2", email: "b@x", orderEntryEnabled: false, dealerAccount: null });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res.success).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("a dead dealer session, before any write", async () => {
    orderFindFirst.mockResolvedValue(base);
    dealerSessionLive.mockResolvedValue(false);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "That account's dealer session has expired — reconnect it from Order Entry first." });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(startSubmitRun).not.toHaveBeenCalled();
  });
});

describe("adminSubmitOrder happy path", () => {
  it("disables auto retry, starts under the target with live view, audits, returns a token", async () => {
    orderFindFirst.mockResolvedValue(base);
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: "ord_1" }, data: { autoRetryDisabled: true } });
    expect(startSubmitRun).toHaveBeenCalledWith(base, { userKey: "u2", doPay: true, liveView: true, startedBy: "admin" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: "admin", action: "order_admin_submitted", targetOrder: "ord_1",
      detail: "Submitted ORD-0001 as b@x (TMRS00517) — job job_9.",
    }));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.jobId).toBe("job_9");
      expect(verifyLiveViewToken(res.viewerToken, "job_9", "test-token")).toBe(true);
      expect(res.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("Stop before Pay sends doPay:false and says so in the audit", async () => {
    orderFindFirst.mockResolvedValue(base);
    await adminSubmitOrder("ord_1", "u2", { stopBeforePay: true });
    expect(startSubmitRun).toHaveBeenCalledWith(base, { userKey: "u2", doPay: false, liveView: true, startedBy: "admin" });
    expect(recordAudit.mock.calls[0][0].detail).toBe("Submitted ORD-0001 as b@x (TMRS00517), stopping before Pay — job job_9.");
  });

  it("a refused start is reported and not audited as submitted", async () => {
    orderFindFirst.mockResolvedValue(base);
    startSubmitRun.mockResolvedValue({ ok: false, busy: true, error: "All 4 submit slots are busy." });
    const res = await adminSubmitOrder("ord_1", "u2", { stopBeforePay: false });
    expect(res).toEqual({ success: false, error: "All 4 submit slots are busy." });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("adminLiveViewToken", () => {
  it("mints for the order's current job and refuses when there is none", async () => {
    orderFindFirst.mockResolvedValue({ ...base, jobId: "job_5" });
    const ok = await adminLiveViewToken("ord_1");
    expect(ok.success).toBe(true);
    if (ok.success) expect(verifyLiveViewToken(ok.viewerToken, "job_5", "test-token")).toBe(true);
    orderFindFirst.mockResolvedValue({ ...base, jobId: null });
    expect(await adminLiveViewToken("ord_1")).toEqual({ success: false, error: "This order has no run in flight." });
  });
});

describe("adminStopJob", () => {
  it("asks the droplet to cancel the order's job and audits it", async () => {
    orderFindFirst.mockResolvedValue({ ...base, status: "submitting", jobId: "job_5" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const res = await adminStopJob("ord_1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://droplet/jobs/job_5/cancel");
    expect(res.success).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "job_released", targetOrder: "ord_1" }));
  });

  it("reports the droplet's refusal", async () => {
    orderFindFirst.mockResolvedValue({ ...base, status: "submitting", jobId: "job_5" });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "not_cancellable", message: "The run cannot be cancelled." }) });
    expect(await adminStopJob("ord_1")).toEqual({ success: false, error: "The run cannot be cancelled." });
  });
});

describe("adminSubmitTargets", () => {
  it("returns order-entry users with their connection state, superadmins first", async () => {
    dealerFindMany.mockResolvedValue([
      { id: "u1", email: "a@x", name: null, isSuperAdmin: false, dealerAccount: { staffCode: "T1", sessionExpiresAt: new Date(Date.now() + 3600_000) } },
      { id: "u2", email: "b@x", name: null, isSuperAdmin: true, dealerAccount: null },
    ]);
    const res = await adminSubmitTargets();
    expect(res.success).toBe(true);
    expect(res.data.map((t) => [t.id, t.staffCode, t.connection.state])).toEqual([["u1", "T1", "connected"], ["u2", null, "never"]]);
    expect(dealerFindMany.mock.calls[0][0].where).toEqual({ orderEntryEnabled: true });
    expect(dealerFindMany.mock.calls[0][0].orderBy).toEqual([{ isSuperAdmin: "desc" }, { email: "asc" }]);
  });
});

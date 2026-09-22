import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a SINGLE-order submit writes before the droplet is called.
 *
 * The rule worth a test here is the notification guard. `notifiedAt` is an
 * exactly-once claim: `claimOrder` only matches rows where it is null. So an
 * order that has already been emailed about stays silent on every later attempt
 * unless the start path releases the claim — and the failure is invisible, because
 * the webhook still arrives and still answers 200 while the send is skipped.
 *
 * The batch path has always cleared it (`batch-start.test.ts`). The single path
 * did not, which meant "resubmit a failed order, get no email" — the exact
 * report this test exists to prevent regressing.
 */

const findFirst = vi.fn();
const orderUpdate = vi.fn();
const dealerFindUnique = vi.fn();
const userFindUnique = vi.fn();
const auth = vi.fn();

vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    batchRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    dealerAccount: { findUnique: (...a: unknown[]) => dealerFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    orderStatusEvent: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/order-history", () => ({
  recordEvent: vi.fn(),
  nextOrderReference: vi.fn(),
  groupByAttempt: vi.fn(),
}));
vi.mock("@/lib/order-submit", () => ({ reconcileStaleSubmits: vi.fn() }));
vi.mock("@/lib/batch-submit", () => ({
  reconcileBatch: vi.fn(),
  finishBatch: vi.fn(),
  batchOrderIds: (v: unknown) => (Array.isArray(v) ? v : []),
}));
vi.mock("@/actions/plans", () => ({ mandatoryGroupsFor: vi.fn().mockResolvedValue({ all: [], devices: [] }) }));
vi.mock("@/actions/admin-settings", () => ({
  getAppointmentPolicy: vi.fn().mockResolvedValue({ mode: "first_available" }),
}));

process.env.ORDER_ENTRY_API_TOKEN = "token";
const { startSubmit } = await import("@/actions/order");

const draft = (over: Record<string, unknown> = {}) => ({
  id: "ord_1",
  userId: "user_1",
  attempt: 0,
  status: "draft",
  orderId: null,
  fullName: "NAME",
  offerName: "Unifi Home 500Mbps",
  documents: null,
  ...over,
});

/** The update that carries `status: "submitting"` — the pre-flight write. */
const submittingWrite = () =>
  orderUpdate.mock.calls.map((c) => c[0].data).find((d) => d.status === "submitting");

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "user_1" } });
  userFindUnique.mockResolvedValue({ isSuperAdmin: false });
  dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3_600_000) });
  orderUpdate.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ job_id: "job_1" }) })),
  );
});

describe("startSubmit", () => {
  it("clears notifiedAt so a resubmitted order gets its own email", async () => {
    // The regression: an order notified once would otherwise never be notified
    // again, silently, for the rest of its life.
    //
    // Asserted across every write rather than on the `submitting` one: the
    // clear moved to the first update, ahead of the session check and the
    // droplet refusal, which both return before `submitting` is ever written.
    // order-start-busy.test.ts pins that ordering.
    findFirst.mockResolvedValue(draft({ attempt: 2, notifiedAt: new Date() }));
    await startSubmit("ord_1");
    const datas = orderUpdate.mock.calls.map((c) => c[0].data as Record<string, unknown>);
    expect(datas.some((d) => d.notifiedAt === null)).toBe(true);
  });

  it("clears the previous attempt's error code as well as its message", async () => {
    // A stale errorCode outlives the failure it described and would be rendered
    // against the new attempt.
    findFirst.mockResolvedValue(draft({ attempt: 1, errorCode: "DEVICE_OUT_OF_STOCK" }));
    await startSubmit("ord_1");
    expect(submittingWrite()).toMatchObject({ errorCode: null, errorMessage: null });
  });

  it("counts the attempt up before starting", async () => {
    findFirst.mockResolvedValue(draft({ attempt: 3 }));
    await startSubmit("ord_1");
    expect(orderUpdate.mock.calls[0][0].data).toMatchObject({ attempt: 4 });
  });
});

describe("the unseen-outcome marker", () => {
  it("is cleared by every start, so a new run always produces a fresh outcome", async () => {
    // The badge counts terminal orders with outcomeSeenAt NULL. A resubmit that
    // left the old "seen" standing would finish invisibly — the exact gap the
    // in-app notifications exist to close.
    findFirst.mockResolvedValue(draft({ attempt: 2, outcomeSeenAt: new Date() }));
    await startSubmit("ord_1");
    const attemptWrite = orderUpdate.mock.calls
      .map((c) => c[0].data)
      .find((d) => "attempt" in d);
    expect(attemptWrite?.outcomeSeenAt).toBeNull();
  });
});

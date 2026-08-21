import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a batch actually submits, and in what order.
 *
 * Two rules here are worth real money. A stranded order must never be swept
 * into a batch — a second run against an un-voided portal order creates a
 * genuine chargeable duplicate — and the run order must be by age, not by
 * whatever the filtered table happened to be showing, so the same selection
 * runs the same way twice.
 */

const findMany = vi.fn();
const orderUpdate = vi.fn();
const orderUpdateMany = vi.fn();
const batchCreate = vi.fn();
const batchUpdate = vi.fn();
const dealerFindUnique = vi.fn();
const userFindUnique = vi.fn();
const auth = vi.fn();

vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    batchRun: {
      create: (...a: unknown[]) => batchCreate(...a),
      update: (...a: unknown[]) => batchUpdate(...a),
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
vi.mock("@/actions/plans", () => ({ mandatoryGroupsFor: vi.fn().mockResolvedValue([]) }));
vi.mock("@/actions/admin-settings", () => ({
  getAppointmentPolicy: vi.fn().mockResolvedValue({ mode: "first_available" }),
}));

process.env.ORDER_ENTRY_API_TOKEN = "token";
const { startBatchSubmit } = await import("@/actions/order");

const draft = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: "user_1",
  attempt: 0,
  status: "draft",
  orderId: null,
  fullName: `NAME ${id}`,
  offerName: "Unifi Home 500Mbps",
  documents: null,
  ...over,
});

let posted: { url: string; body: Record<string, unknown> } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  posted = null;
  auth.mockResolvedValue({ user: { id: "user_1" } });
  userFindUnique.mockResolvedValue({ isSuperAdmin: false });
  dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3_600_000) });
  batchCreate.mockResolvedValue({ id: "batch_1" });
  orderUpdate.mockResolvedValue({});
  batchUpdate.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    posted = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ batch_job_id: "job_batch" }) };
  }));
});

describe("startBatchSubmit", () => {
  it("asks the database for the selection oldest-created first", async () => {
    findMany.mockResolvedValue([draft("a"), draft("b")]);
    await startBatchSubmit(["a", "b"]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ orderBy: { createdAt: "asc" } });
  });

  it("preserves that order when handing the jobs over", async () => {
    findMany.mockResolvedValue([draft("oldest"), draft("middle"), draft("newest")]);
    await startBatchSubmit(["newest", "oldest", "middle"]);
    expect(posted!.body.jobs).toHaveLength(3);
    expect((posted!.body.jobs as { order: { id: string } }[]).map((j) => j.order.id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("drops a stranded order the selection tried to include", async () => {
    // The portal already minted a number for this one. Running it again without
    // a per-order confirmation is how a real duplicate gets created.
    findMany.mockResolvedValue([
      draft("clean"),
      draft("stranded", { status: "warning", orderId: "2608000121428560" }),
    ]);
    const res = await startBatchSubmit(["clean", "stranded"]);
    expect(res.success).toBe(true);
    expect((posted!.body.jobs as { order: { id: string } }[]).map((j) => j.order.id)).toEqual(["clean"]);
    expect(batchCreate.mock.calls[0][0].data.orderIds).toEqual(["clean"]);
  });

  it("refuses when nothing in the selection is submittable", async () => {
    findMany.mockResolvedValue([draft("s", { status: "submitted", orderId: "111" })]);
    const res = await startBatchSubmit(["s"]);
    expect(res.success).toBe(false);
    expect(batchCreate).not.toHaveBeenCalled();
    expect(posted).toBeNull();
  });

  it("gives each order its own job id and writes it before starting", async () => {
    // This is the seam that lets every existing per-order path work on a batch
    // member unchanged: Order.jobId is set BEFORE the droplet is called.
    findMany.mockResolvedValue([draft("a"), draft("b")]);
    await startBatchSubmit(["a", "b"]);
    const jobIds = (posted!.body.jobs as { jobId: string }[]).map((j) => j.jobId);
    expect(new Set(jobIds).size).toBe(2);
    for (const id of jobIds) expect(id).toMatch(/^[0-9a-f]{32}$/);
    const written = orderUpdate.mock.calls.map((c) => c[0].data.jobId);
    expect(written).toEqual(jobIds);
  });

  it("clears notifiedAt so each attempt gets its own email", async () => {
    findMany.mockResolvedValue([draft("a", { attempt: 3 })]);
    await startBatchSubmit(["a"]);
    expect(orderUpdate.mock.calls[0][0].data).toMatchObject({ attempt: 4, notifiedAt: null });
  });

  it("checks the dealer session once, before creating anything", async () => {
    dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() - 1000) });
    findMany.mockResolvedValue([draft("a"), draft("b")]);
    const res = await startBatchSubmit(["a", "b"]);
    expect(res.success).toBe(false);
    expect(dealerFindUnique).toHaveBeenCalledOnce();
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it("puts every order back and closes the batch out when the droplet refuses", async () => {
    findMany.mockResolvedValue([draft("a"), draft("b")]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: async () => ({ message: "The server can only run one browser job at a time." }),
    })));
    const res = await startBatchSubmit(["a", "b"]);
    expect(res.success).toBe(false);
    // Both rows left `submitting` would sit there forever with no job to poll.
    const reverted = orderUpdate.mock.calls.filter((c) => c[0].data.status === "failed");
    expect(reverted).toHaveLength(2);
    for (const call of reverted) expect(call[0].data.jobId).toBeNull();
    expect(batchUpdate.mock.calls[0][0].data).toMatchObject({ status: "finished" });
  });

  it("refuses an empty selection outright", async () => {
    const res = await startBatchSubmit([]);
    expect(res.success).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    auth.mockResolvedValue(null);
    const res = await startBatchSubmit(["a"]);
    expect(res.success).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the caller unless they are a superadmin", async () => {
    findMany.mockResolvedValue([draft("a")]);
    await startBatchSubmit(["a"]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ userId: "user_1" });

    vi.clearAllMocks();
    userFindUnique.mockResolvedValue({ isSuperAdmin: true });
    dealerFindUnique.mockResolvedValue({ sessionExpiresAt: new Date(Date.now() + 3_600_000) });
    batchCreate.mockResolvedValue({ id: "batch_1" });
    findMany.mockResolvedValue([draft("a")]);
    await startBatchSubmit(["a"]);
    expect(findMany.mock.calls[0][0].where.userId).toBeUndefined();
  });
});

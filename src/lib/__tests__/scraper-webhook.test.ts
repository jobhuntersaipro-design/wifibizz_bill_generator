import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook's front door.
 *
 * This route reconciles real orders and sends real mail on behalf of a caller
 * that is a machine, not a signed-in browser — so the bearer check is the ONLY
 * thing standing between the open internet and "reconcile and mail about this
 * order". It is tested here rather than assumed, including the case that is
 * easy to get backwards: an unconfigured secret must REFUSE, not allow.
 */

const findOrder = vi.fn();
const findBatch = vi.fn();
const pollOrderProgress = vi.fn();
const finishBatch = vi.fn();
const notifyOrderResult = vi.fn();
const notifyBatchResult = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: (...a: unknown[]) => findOrder(...a) },
    batchRun: { findUnique: (...a: unknown[]) => findBatch(...a) },
  },
}));
vi.mock("@/lib/order-submit", () => ({
  pollOrderProgress: (...a: unknown[]) => pollOrderProgress(...a),
}));
vi.mock("@/lib/batch-submit", () => ({
  finishBatch: (...a: unknown[]) => finishBatch(...a),
}));
vi.mock("@/lib/notifications/send", () => ({
  notifyOrderResult: (...a: unknown[]) => notifyOrderResult(...a),
  notifyBatchResult: (...a: unknown[]) => notifyBatchResult(...a),
}));

const SECRET = "s3cr3t";

/** Import the route fresh, so the module-level secret picks up the env. */
async function loadRoute(secret: string | undefined) {
  vi.resetModules();
  if (secret === undefined) delete process.env.SCRAPER_WEBHOOK_SECRET;
  else process.env.SCRAPER_WEBHOOK_SECRET = secret;
  return (await import("@/app/api/hooks/scraper/route")).POST;
}

const post = (body: unknown, auth?: string) =>
  new Request("http://localhost/api/hooks/scraper", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  findOrder.mockResolvedValue({ id: "ord_1" });
  findBatch.mockResolvedValue({ id: "batch_1" });
});

describe("authentication", () => {
  it("refuses a request with no Authorization header", async () => {
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", orderId: "ord_1" }));
    expect(res.status).toBe(401);
    expect(notifyOrderResult).not.toHaveBeenCalled();
  });

  it("refuses a wrong token", async () => {
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", orderId: "ord_1" }, "Bearer nope"));
    expect(res.status).toBe(401);
    expect(pollOrderProgress).not.toHaveBeenCalled();
  });

  it("refuses the raw secret without the Bearer scheme", async () => {
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", orderId: "ord_1" }, SECRET));
    expect(res.status).toBe(401);
  });

  it("refuses EVERYTHING when no secret is configured", async () => {
    // The dangerous reading of "not configured" is "no check needed". An
    // unauthenticated route here would let anyone trigger reconciliation and
    // mail on real, chargeable orders.
    const POST = await loadRoute(undefined);
    const res = await POST(post({ event: "order_finished", orderId: "ord_1" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(notifyOrderResult).not.toHaveBeenCalled();
  });

  it("accepts the right token", async () => {
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", orderId: "ord_1" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
  });
});

describe("order_finished", () => {
  it("reconciles the order, then notifies — in that order", async () => {
    // Reconciling first is what makes the email describe the order's FINAL
    // state; notifying first would mail whatever the row happened to say.
    const calls: string[] = [];
    pollOrderProgress.mockImplementation(async () => void calls.push("poll"));
    notifyOrderResult.mockImplementation(async () => void calls.push("notify"));
    const POST = await loadRoute(SECRET);
    await POST(post({ event: "order_finished", orderId: "ord_1" }, `Bearer ${SECRET}`));
    expect(calls).toEqual(["poll", "notify"]);
  });

  it("needs an orderId — the job id alone is not enough", async () => {
    // A browser poll that finalized the run first has already cleared
    // Order.jobId, so an event keyed on the job id would match nothing.
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", jobId: "abc" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });

  it("acknowledges an order it has never heard of instead of retrying forever", async () => {
    findOrder.mockResolvedValue(null);
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "order_finished", orderId: "gone" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "unknown_order" });
  });
});

describe("batch_finished", () => {
  it("closes the batch out, then sends the one summary", async () => {
    const calls: string[] = [];
    finishBatch.mockImplementation(async () => void calls.push("finish"));
    notifyBatchResult.mockImplementation(async () => void calls.push("notify"));
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "batch_finished", batchId: "batch_1" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(calls).toEqual(["finish", "notify"]);
  });

  it("requires a batchId", async () => {
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "batch_finished" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });
});

describe("malformed events", () => {
  it("rejects a body with no event", async () => {
    const POST = await loadRoute(SECRET);
    expect((await POST(post({}, `Bearer ${SECRET}`))).status).toBe(400);
  });

  it("rejects an event it does not implement", async () => {
    const POST = await loadRoute(SECRET);
    expect((await POST(post({ event: "nope" }, `Bearer ${SECRET}`))).status).toBe(400);
  });

  it("asks for a redelivery when processing genuinely fails", async () => {
    // 500 makes the droplet retry, which is right: the reconcile is idempotent
    // and the notify guard is exactly-once, so a retry recovers a batch whose
    // results were never written and costs nothing if they were.
    finishBatch.mockRejectedValue(new Error("db down"));
    const POST = await loadRoute(SECRET);
    const res = await POST(post({ event: "batch_finished", batchId: "batch_1" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });
});

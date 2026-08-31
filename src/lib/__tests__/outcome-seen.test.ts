/**
 * When an outcome counts as SEEN.
 *
 * The rule with teeth is the progress route's stamp: the watcher's own browser
 * delivering the terminal state is the seeing. Stamped too early (a live run)
 * and the badge never fires for anyone; never stamped and the badge nags an
 * agent about a run they sat and watched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const findUnique = vi.fn();
const updateMany = vi.fn();
const userFindUnique = vi.fn();
const auth = vi.fn();
const poll = vi.fn();

vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));
vi.mock("@/lib/order-submit", () => ({ pollOrderProgress: (...a: unknown[]) => poll(...a) }));

const { GET } = await import("@/app/api/orders/[id]/progress/route");

const req = () => new Request("http://localhost/api/orders/ord_1/progress");
const params = { params: Promise.resolve({ id: "ord_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "agent_1" } });
  userFindUnique.mockResolvedValue({ isSuperAdmin: false });
  findFirst.mockResolvedValue({ id: "ord_1" });
  findUnique.mockResolvedValue({ autoRetries: 0, autoRetryAt: null });
});

describe("the progress route's seen stamp", () => {
  it("stamps when it delivers a terminal state — watching IS seeing", async () => {
    poll.mockResolvedValue({ status: "failed", stage: "pay" });
    await GET(req(), params);
    const stamp = updateMany.mock.calls.map((c) => c[0])
      .find((a) => a?.data && "outcomeSeenAt" in a.data);
    expect(stamp).toBeDefined();
    // Conditional on NULL, so a later poll cannot move the timestamp.
    expect(stamp.where).toMatchObject({ id: "ord_1", outcomeSeenAt: null });
  });

  it("stamps submitted and warning too", async () => {
    for (const status of ["submitted", "warning"]) {
      updateMany.mockClear();
      poll.mockResolvedValue({ status });
      await GET(req(), params);
      expect(updateMany.mock.calls.some((c) => c[0]?.data && "outcomeSeenAt" in c[0].data)).toBe(true);
    }
  });

  it("never stamps an in-flight run — it has no outcome to have seen", async () => {
    poll.mockResolvedValue({ status: "submitting", stage: "selecting_device" });
    await GET(req(), params);
    expect(updateMany.mock.calls.some((c) => c[0]?.data && "outcomeSeenAt" in c[0].data)).toBe(false);
  });
});

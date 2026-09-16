import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three opts the admin live submit adds to startSubmitRun. The first test
 * is the load-bearing one: with none of them passed, the request body is what
 * every agent-side caller has always sent.
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
vi.mock("@/lib/order-history", () => ({ recordEvent: (...a: unknown[]) => recordEvent(...a) }));
vi.mock("@/actions/plans", () => ({
  mandatoryGroupsFor: vi.fn().mockResolvedValue({ all: [], devices: [] }),
}));

vi.stubGlobal("fetch", fetchMock);
process.env.ORDER_ENTRY_API_TOKEN = "test-token";
process.env.ORDER_ENTRY_DO_PAY = "true";

const { startSubmitRun } = await import("@/lib/order-start");

const ORDER = {
  id: "ord_1",
  userId: "user_1",
  attempt: 0,
  autoRetries: 0,
  appointmentLeadHours: null,
  offerName: "Some Plan",
  documents: [],
} as never;

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  dealerFindUnique.mockResolvedValue({
    sessionExpiresAt: new Date(Date.now() + 3600_000),
    staffCode: "TMRS00517",
  });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 202,
    json: async () => ({ job_id: "job_1" }),
  });
});

describe("startSubmitRun opts", () => {
  it("sends the existing body when no new opt is passed", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1" });
    expect(sentBody()).toMatchObject({
      user_key: "user_1",
      full_order: true,
      dry_run: false,
      do_pay: true,
      live_view: false,
    });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started.");
  });

  it("doPay: false overrides the env var; live_view rides along", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1", doPay: false, liveView: true });
    expect(sentBody()).toMatchObject({ do_pay: false, live_view: true });
  });

  it("startedBy admin changes only the history message", async () => {
    await startSubmitRun(ORDER, { userKey: "user_1", startedBy: "admin" });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started by admin under TMRS00517.");
    expect(sentBody()).toMatchObject({ do_pay: true, live_view: false });
  });

  it("startedBy admin with no staff code on the account still names admin", async () => {
    dealerFindUnique.mockResolvedValue({
      sessionExpiresAt: new Date(Date.now() + 3600_000),
      staffCode: null,
    });
    await startSubmitRun(ORDER, { userKey: "user_1", startedBy: "admin" });
    const started = recordEvent.mock.calls.find((c) => c[0].status === "submitting");
    expect(started?.[0].message).toBe("Submit started by admin.");
  });
});

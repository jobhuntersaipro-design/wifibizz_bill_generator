import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sending each notification exactly once — and only when it really went out.
 *
 * The droplet retries a webhook up to three times, so "send this email" has to
 * survive being asked twice. The guard is a conditional claim
 * (`WHERE notified_at IS NULL`) taken BEFORE the send, and released again if the
 * send fails — that second half is what keeps `notified_at IS NULL` meaning
 * "nobody has been told", which is the only signal a lost email leaves behind.
 */

const orderUpdateMany = vi.fn();
const orderFindUnique = vi.fn();
const batchUpdateMany = vi.fn();
const batchFindUnique = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
      findUnique: (...a: unknown[]) => orderFindUnique(...a),
    },
    batchRun: {
      updateMany: (...a: unknown[]) => batchUpdateMany(...a),
      findUnique: (...a: unknown[]) => batchFindUnique(...a),
    },
  },
}));
vi.mock("@/lib/notifications/resend", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

const { notifyOrderResult, notifyBatchResult } = await import("@/lib/notifications/send");

const ORDER = {
  id: "ord_1",
  reference: "ORD-0042",
  fullName: "AISYAH BINTI RAHIM",
  status: "submitted",
  orderId: "2608000121625616",
  errorCode: null,
  errorMessage: null,
  user: { email: "login@example.com", notificationEmail: "ops@example.com" },
};

const BATCH = {
  id: "batch_1",
  status: "finished",
  startedAt: new Date("2026-08-21T01:00:00Z"),
  finishedAt: new Date("2026-08-21T01:10:00Z"),
  results: [
    { orderId: "a", reference: "ORD-1", fullName: "FIRST", status: "submitted", portalOrderNo: "1", errorCode: null, errorMessage: null },
  ],
  user: { email: "login@example.com", notificationEmail: null },
};

/** The `where` of the claim update, so the guard itself can be inspected. */
const claimWhere = (fn: typeof orderUpdateMany) =>
  (fn.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined)?.where;

beforeEach(() => {
  vi.clearAllMocks();
  orderFindUnique.mockResolvedValue(ORDER);
  batchFindUnique.mockResolvedValue(BATCH);
  orderUpdateMany.mockResolvedValue({ count: 1 });
  batchUpdateMany.mockResolvedValue({ count: 1 });
  sendEmail.mockResolvedValue({ sent: true });
});

describe("notifyOrderResult", () => {
  it("claims with a conditional update before sending", async () => {
    await notifyOrderResult("ord_1");
    expect(claimWhere(orderUpdateMany)).toEqual({ id: "ord_1", notifiedAt: null });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("sends nothing when another delivery already claimed it", async () => {
    orderUpdateMany.mockResolvedValue({ count: 0 });
    await notifyOrderResult("ord_1");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends to the notification address, not the login address", async () => {
    await notifyOrderResult("ord_1");
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "ops@example.com" });
  });

  it("releases the claim when the send fails", async () => {
    // Otherwise the row claims an email that never went out — exactly the state
    // the "delivered but email lost" check reads as healthy.
    sendEmail.mockResolvedValue({ sent: false, reason: "nope" });
    await notifyOrderResult("ord_1");
    const release = orderUpdateMany.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(release.data).toEqual({ notifiedAt: null });
  });

  it("keeps the claim when the send succeeded", async () => {
    await notifyOrderResult("ord_1");
    expect(orderUpdateMany).toHaveBeenCalledOnce();
  });

  it("says nothing about a run that is still in flight", async () => {
    orderFindUnique.mockResolvedValue({ ...ORDER, status: "submitting" });
    await notifyOrderResult("ord_1");
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not burn the claim when there is nowhere to send", async () => {
    // Claiming first would permanently mark an email as sent that never could
    // be — so once an address exists, the order would never be mailed about.
    orderFindUnique.mockResolvedValue({
      ...ORDER,
      user: { email: null, notificationEmail: null },
    });
    await notifyOrderResult("ord_1");
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });
});

describe("notifyBatchResult", () => {
  it("claims the summary conditionally and sends one email", async () => {
    await notifyBatchResult("batch_1");
    expect(claimWhere(batchUpdateMany)).toEqual({ id: "batch_1", notifiedAt: null });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("sends nothing on a redelivery that lost the claim", async () => {
    batchUpdateMany.mockResolvedValue({ count: 0 });
    await notifyBatchResult("batch_1");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falls back to the login email when no notification address is set", async () => {
    await notifyBatchResult("batch_1");
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "login@example.com" });
  });

  it("waits for a batch that has not finished", async () => {
    batchFindUnique.mockResolvedValue({ ...BATCH, status: "running" });
    await notifyBatchResult("batch_1");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a batch that ran no orders", async () => {
    batchFindUnique.mockResolvedValue({ ...BATCH, results: [] });
    await notifyBatchResult("batch_1");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails", async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: "nope" });
    await notifyBatchResult("batch_1");
    const release = batchUpdateMany.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(release.data).toEqual({ notifiedAt: null });
  });
});

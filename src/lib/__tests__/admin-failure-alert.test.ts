import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Copying an admin address in on every failed submit.
 *
 * Two things are load-bearing and neither is visible from the happy path:
 *
 *  - the notify hangs off `recordEvent`, not off the droplet webhook. Five other
 *    code paths write a failure — a refused start, an expired dealer session, a
 *    lost job, a failed batch start, a manual stop — and before this none of
 *    them emailed anyone, the agent included. A test driving `recordEvent`
 *    directly is what pins that.
 *  - an order with `autoRetryAt` set is NOT news. Without that gate an order
 *    that fails twice and then submits sends two false alarms, which is how a
 *    monitoring address gets muted.
 */

const orderFindUnique = vi.fn();
const orderUpdateMany = vi.fn();
const eventCreate = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: (...a: unknown[]) => orderFindUnique(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
    },
    batchRun: { findUnique: vi.fn(), updateMany: vi.fn() },
    orderStatusEvent: { create: (...a: unknown[]) => eventCreate(...a) },
  },
}));
vi.mock("@/lib/notifications/resend", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

const { recordEvent } = await import("@/lib/order-history");

const FAILED_ORDER = {
  id: "ord_1",
  reference: "ORD-0042",
  fullName: "AISYAH BINTI RAHIM",
  status: "failed",
  orderId: null,
  errorCode: "device_out_of_stock",
  errorMessage: 'Sorry, the SAMSUNG TV 55" is currently out of stock.',
  idType: "mykad",
  idNumber: "940811034224",
  mobilePrefix: "60",
  mobile: "137089093",
  email: "customer@example.com",
  street: "12 JALAN BESAR, 42610 JENJAROM, SELANGOR",
  offerName: "Unifi Home 300Mbps",
  deviceName: "SAMSUNG TV 55",
  installationDate: null,
  attempt: 3,
  autoRetryAt: null,
  user: { email: "agent@example.com", notificationEmail: null },
};

const sent = () => sendEmail.mock.calls[0]?.[0] as
  | { to: string; cc?: string; subject: string; html: string }
  | undefined;

const failedEvent = { orderId: "ord_1", attempt: 3, status: "failed" as const };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  process.env.BIZZFLOW_APP_URL = "https://bizzflow.top";
  orderFindUnique.mockResolvedValue(FAILED_ORDER);
  orderUpdateMany.mockResolvedValue({ count: 1 });
  eventCreate.mockResolvedValue({});
  sendEmail.mockResolvedValue({ sent: true });
});

afterEach(() => {
  delete process.env.ADMIN_ALERT_EMAIL;
  delete process.env.BIZZFLOW_APP_URL;
});

describe("admin copy on a failed submit", () => {
  it("emails the agent and copies the admin, in one send", async () => {
    await recordEvent(failedEvent);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent()?.to).toBe("agent@example.com");
    expect(sent()?.cc).toBe("admin@example.com");
  });

  it("carries the order detail and a link to the order", async () => {
    await recordEvent(failedEvent);
    const html = sent()?.html ?? "";
    expect(html).toContain("https://bizzflow.top/order-entry/orders/ord_1");
    expect(html).toContain("ORD-0042");
    expect(html).toContain("Unifi Home 300Mbps");
    expect(html).toContain("out of stock");
  });

  it("stays silent while an automatic retry is owed", async () => {
    // The false-alarm case: the row reads `failed` right now but the sweep is
    // going to run it again, so the outcome is not settled.
    orderFindUnique.mockResolvedValue({ ...FAILED_ORDER, autoRetryAt: new Date() });
    await recordEvent(failedEvent);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("copies the admin on a warning too — a stranded portal order is the worst case", async () => {
    orderFindUnique.mockResolvedValue({
      ...FAILED_ORDER,
      status: "warning",
      orderId: "2608000121625616",
    });
    await recordEvent({ ...failedEvent, status: "warning" });
    expect(sent()?.cc).toBe("admin@example.com");
    expect(sent()?.html).toContain("2608000121625616");
  });

  it("does NOT copy the admin on a success", async () => {
    // The ask is failures. Copying every submit is how the address gets filtered.
    orderFindUnique.mockResolvedValue({
      ...FAILED_ORDER,
      status: "submitted",
      orderId: "2608000121625616",
      errorCode: null,
      errorMessage: null,
    });
    const { notifyOrderResult } = await import("@/lib/notifications/send");
    await notifyOrderResult("ord_1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent()?.cc).toBeUndefined();
  });

  it("never reads the order for a stage milestone", async () => {
    // Every step of every run comes through recordEvent. The in-memory status
    // check has to come first or the trail costs a database read per stage.
    await recordEvent({ orderId: "ord_1", attempt: 3, status: "submitting", stage: "creating_customer" });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends once when the webhook and the trail both notify", async () => {
    // Both fire for a webhook-reported failure. The `notified_at` claim is what
    // makes that safe; without it the pair would send two copies of one failure.
    const { notifyOrderResult } = await import("@/lib/notifications/send");
    orderUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await recordEvent(failedEvent);
    await notifyOrderResult("ord_1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends with no copy when ADMIN_ALERT_EMAIL is unset", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    await recordEvent(failedEvent);
    expect(sent()?.to).toBe("agent@example.com");
    expect(sent()?.cc).toBeUndefined();
  });

  it("still writes the trail when notifying throws", async () => {
    // The notify hangs off a diagnostic. It must not be able to take down the
    // status trail, let alone the submit the trail describes.
    orderFindUnique.mockRejectedValue(new Error("db gone"));
    await expect(recordEvent(failedEvent)).resolves.toBeUndefined();
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });
});

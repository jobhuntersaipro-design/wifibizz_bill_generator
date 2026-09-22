import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Alerting an admin that a submit ended un-submitted.
 *
 * Two things are load-bearing and neither is visible from the happy path:
 *
 *  - the alert hangs off `recordEvent`, not off the droplet webhook, because
 *    five other code paths write a failure and none of them notifies. A test
 *    driving `recordEvent` directly is what pins that.
 *  - an order with `autoRetryAt` set is NOT news. Without that gate an order
 *    that fails twice and then submits sends two false alarms, which is how a
 *    monitoring address gets muted.
 */

const orderFindUnique = vi.fn();
const eventCreate = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: (...a: unknown[]) => orderFindUnique(...a), updateMany: vi.fn() },
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
  errorMessage: "Sorry, the SAMSUNG TV 55\" is currently out of stock.",
  idType: "mykad",
  idNumber: "940811034224",
  mobilePrefix: "60",
  mobile: "123456789",
  email: "customer@example.com",
  street: "12 JALAN BESAR, 42610 JENJAROM, SELANGOR",
  offerName: "Unifi Home 300Mbps",
  deviceName: "SAMSUNG TV 55",
  installationDate: null,
  attempt: 3,
  autoRetryAt: null,
};

/** The single argument `sendEmail` was called with, if it was. */
const sent = () => sendEmail.mock.calls[0]?.[0] as
  | { to: string; subject: string; html: string }
  | undefined;

const failedEvent = { orderId: "ord_1", attempt: 3, status: "failed" as const };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_ALERT_EMAIL = "admin@example.com";
  process.env.BIZZFLOW_APP_URL = "https://bizzflow.top";
  orderFindUnique.mockResolvedValue(FAILED_ORDER);
  eventCreate.mockResolvedValue({});
  sendEmail.mockResolvedValue({ sent: true });
});

afterEach(() => {
  delete process.env.ADMIN_ALERT_EMAIL;
  delete process.env.BIZZFLOW_APP_URL;
});

describe("admin failure alert", () => {
  it("emails the admin address when a failure is recorded", async () => {
    await recordEvent(failedEvent);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent()?.to).toBe("admin@example.com");
    expect(sent()?.subject).toContain("AISYAH BINTI RAHIM");
  });

  it("carries the order detail and a link to the order", async () => {
    await recordEvent(failedEvent);
    const html = sent()?.html ?? "";
    expect(html).toContain("https://bizzflow.top/admin/orders/ord_1");
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

  it("alerts on a warning too — a stranded portal order is the worst case", async () => {
    orderFindUnique.mockResolvedValue({
      ...FAILED_ORDER,
      status: "warning",
      orderId: "2608000121625616",
    });
    await recordEvent({ ...failedEvent, status: "warning" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent()?.html).toContain("2608000121625616");
  });

  it("never reads the order for a stage milestone", async () => {
    // Every step of every run comes through recordEvent. The in-memory status
    // check has to come first or the trail costs a database read per stage.
    await recordEvent({ orderId: "ord_1", attempt: 3, status: "submitting", stage: "creating_customer" });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing on a success", async () => {
    await recordEvent({ orderId: "ord_1", attempt: 3, status: "submitted" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("is off, not broken, when ADMIN_ALERT_EMAIL is unset", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    await expect(recordEvent(failedEvent)).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the admin link out of the agent's own email", async () => {
    // `singleResultEmail` is shared by both copies of one failure. The admin
    // route is behind the separate admin JWT, so an agent following this link
    // lands on a login they cannot pass — a door offered and not openable.
    const { singleResultEmail } = await import("@/lib/notifications/templates");
    const outcome = {
      orderId: "ord_1", reference: "ORD-0042", fullName: "AISYAH BINTI RAHIM",
      status: "failed", portalOrderNo: null, errorCode: "device_out_of_stock",
      errorMessage: "out of stock", details: [], tries: 3,
    };
    const agent = singleResultEmail(outcome).html;
    const admin = singleResultEmail(outcome, { adminLink: true }).html;
    expect(agent).not.toContain("/admin/orders/");
    expect(admin).toContain("/admin/orders/");
    // The footer says why you got it, and the two readers got it for different
    // reasons. Pointing the admin at Settings sends them to a page that cannot
    // change ADMIN_ALERT_EMAIL.
    expect(agent).toContain("Change the destination address in Settings");
    expect(admin).toContain("ADMIN_ALERT_EMAIL");
    expect(admin).not.toContain("Change the destination address in Settings");
  });

  it("still writes the trail when the alert throws", async () => {
    // The alert is a diagnostic hanging off a diagnostic. It must not be able to
    // take down the status trail, let alone the submit the trail describes.
    orderFindUnique.mockRejectedValue(new Error("db gone"));
    await expect(recordEvent(failedEvent)).resolves.toBeUndefined();
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });
});

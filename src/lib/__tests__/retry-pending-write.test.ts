import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The window between a run ending and its retry starting.
 *
 * `applyResult` writes the outcome; `maybeAutoRetry` starts the next run. In
 * between, the row used to read Failed with a live Submit button — and pressing
 * it starts a SECOND portal run against a draft that was already going to be
 * run again. The fix is that the outcome and the "another run is owed" mark are
 * written TOGETHER, in one update, which is what these pin.
 *
 * Also pinned here: a run somebody STOPPED is filed as stopped, not as a
 * failure. Filing it as a failure would hand it straight back to the automatic
 * retry, which would undo the one thing the agent asked for.
 */

const orderFindUnique = vi.fn();
const orderUpdate = vi.fn();
const recordEvent = vi.fn();
const attachStageDetail = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: (...a: unknown[]) => orderFindUnique(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));
vi.mock("@/lib/order-history", () => ({
  recordEvent: (...a: unknown[]) => recordEvent(...a),
  attachStageDetail: (...a: unknown[]) => attachStageDetail(...a),
}));

vi.stubGlobal("fetch", fetchMock);

const { pollOrderProgress } = await import("@/lib/order-submit");

/** An order in flight, with a full retry budget. */
const IN_FLIGHT = {
  id: "ord_1",
  status: "submitting",
  jobId: "job_1",
  stage: "creating_customer",
  attempt: 1,
  autoRetries: 0,
  orderId: null as string | null,
  errorMessage: null as string | null,
  screenshotUrl: null,
};

/** What the scraper's /jobs/<id> answered. */
function jobAnswers(body: Record<string, unknown>) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

/** The `data` of the update that finalized the order. */
function finalWrite() {
  const call = orderUpdate.mock.calls.find(
    (c) => (c[0] as { data?: { status?: string } }).data?.status,
  );
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  orderFindUnique.mockResolvedValue({ ...IN_FLIGHT });
  orderUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...IN_FLIGHT,
    ...args.data,
  }));
});

describe("a failure that will be retried is marked in the same write", () => {
  it("stamps autoRetryAt on an unclassified failure", async () => {
    jobAnswers({ status: "error", error: "Timeout 30000ms exceeded." });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("failed");
    // A separate write would leave the exact window this closes.
    expect(data.autoRetryAt).toBeInstanceOf(Date);
  });

  it("leaves no claim on a failure a retry cannot fix", async () => {
    jobAnswers({
      status: "done",
      result: {
        status: "error",
        error: "device_out_of_stock",
        message: "Sorry, the SAMSUNG TV is currently out of stock.",
      },
    });
    await pollOrderProgress("ord_1");
    expect(finalWrite().autoRetryAt).toBeNull();
  });

  it("clears any claim when the run actually succeeded", async () => {
    jobAnswers({
      status: "done",
      result: { status: "submitted", order_id: "2608000122816567", erf_key: "k.pdf" },
    });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("submitted");
    expect(data.autoRetryAt).toBeNull();
  });
});

describe("a run somebody stopped", () => {
  beforeEach(() => {
    jobAnswers({
      status: "error",
      error_kind: "cancelled",
      error: "Stopped by the agent while it was running.",
    });
  });

  it("is filed as stopped, not as a portal failure", async () => {
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("failed");
    expect(data.errorCode).toBe("submit_stopped");
  });

  it("is never handed back to the automatic retry", async () => {
    // The whole point: a retry here would undo a deliberate decision, and would
    // do it by minting another real order at Unifi.
    await pollOrderProgress("ord_1");
    expect(finalWrite().autoRetryAt).toBeNull();
  });

  it("keeps the portal's own wording for a run that merely failed", async () => {
    jobAnswers({ status: "error", error: "The portal did not respond in time." });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.errorCode).toBeNull();
    expect(data.errorMessage).toBe("The portal did not respond in time.");
  });
});

describe("every failed attempt keeps the code it failed with", () => {
  // Verbatim from the droplet log for order 2609000125212018 (job 72a49792…),
  // which the admin page listed as Unclassified under `creating_customer`.
  const LIVE_NEXT_BLOCKED = {
    status: "error",
    stage: "customer_order_info",
    error: "next_blocked",
    message: "Please check the service number first.",
    order_id: "2609000125212018",
  };

  it("stores a scraper code this build has no copy for", async () => {
    jobAnswers({ status: "done", result: LIVE_NEXT_BLOCKED });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.errorCode).toBe("next_blocked");
    // No copy, so the message still explains the stranded order in full.
    expect(data.errorMessage).toBe(
      "Order 2609000125212018 was created but the flow didn't finish: " +
        "Please check the service number first.. Verify in the portal before retrying.",
    );
  });

  it("files the event under the stage the run died at, not the stale pointer", async () => {
    jobAnswers({ status: "done", result: LIVE_NEXT_BLOCKED });
    await pollOrderProgress("ord_1");
    const failed = recordEvent.mock.calls
      .map((c) => c[0] as { status: string; stage: string; errorCode: string })
      .find((e) => e.status === "warning");
    expect(failed?.stage).toBe("customer_order_info");
    expect(failed?.errorCode).toBe("next_blocked");
  });

  it("stores the job's error_kind when the run itself died", async () => {
    jobAnswers({ status: "error", error_kind: "portal_timeout", error: "Timed out." });
    await pollOrderProgress("ord_1");
    expect(finalWrite().errorCode).toBe("portal_timeout");
  });

  it("stores a code for a run the order service lost", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await pollOrderProgress("ord_1");
    expect(finalWrite().errorCode).toBe("job_lost");
  });

  it("does not mark pay_page_not_ready for retry once a portal order exists", async () => {
    jobAnswers({
      status: "done",
      result: {
        status: "error",
        error: "pay_page_not_ready",
        message: "The Pay page did not finish loading.",
        order_id: "2609000125814861",
        stage: "pay_tail",
      },
    });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.errorCode).toBe("pay_page_not_ready");
    expect(data.orderId).toBe("2609000125814861");
    expect(data.autoRetryAt).toBeNull();
  });

  it("does not mark next_click_failed for retry once a portal order exists", async () => {
    jobAnswers({
      status: "done",
      result: {
        status: "error",
        error: "next_click_failed",
        message: "nonext",
        order_id: "2609000125814861",
        stage: "pay_tail",
      },
    });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.errorCode).toBe("next_click_failed");
    expect(data.orderId).toBe("2609000125814861");
    expect(data.autoRetryAt).toBeNull();
    expect(String(data.errorMessage).toLowerCase()).not.toContain("nonext");
  });

  it("makes post_pay_not_confirmed terminal, as the policy always intended", async () => {
    // It had no copy, so it used to be stored as null — and null RETRIES, which
    // for a run that may already have charged the customer is the worst case.
    jobAnswers({
      status: "done",
      result: { status: "error", error: "post_pay_not_confirmed", message: "x", order_id: "1" },
    });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.errorCode).toBe("post_pay_not_confirmed");
    expect(data.autoRetryAt).toBeNull();
  });
});

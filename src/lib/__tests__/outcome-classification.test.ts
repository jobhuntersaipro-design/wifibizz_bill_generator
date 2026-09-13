import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every terminal outcome carries a stable class and the step it died on.
 *
 * Most failures used to reach the database with `errorCode: null`: a code was
 * kept only when copy existed for it, and a run that died outside the result
 * path had nowhere to put its kind at all. Nobody can work failures by class
 * when the class is missing, so these pin that each terminal writer persists
 * what the scraper said and files the event on the step the run reached.
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
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    orderStatusEvent: {
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

const IN_FLIGHT = {
  id: "ord_1",
  status: "submitting",
  jobId: "job_1",
  stage: "creating_customer",
  attempt: 3,
  autoRetries: 0,
  orderId: null as string | null,
  errorMessage: null as string | null,
  errorCode: null as string | null,
  screenshotUrl: null,
};

// The row as the database would hold it: every update merges into it, so a
// pointer moved by one write is what the next write reads back.
let row: Record<string, unknown>;

function jobAnswers(body: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

function jobIsGone() {
  fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
}

/** The `data` of the update that finalized the order. */
function finalWrite() {
  const call = orderUpdate.mock.calls.find(
    (c) => (c[0] as { data?: { status?: string } }).data?.status,
  );
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

/** The one event recorded with a terminal status. */
function terminalEvent() {
  return recordEvent.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .find((e) => e.status === "failed" || e.status === "warning" || e.status === "submitted");
}

beforeEach(() => {
  vi.clearAllMocks();
  row = { ...IN_FLIGHT };
  orderFindUnique.mockImplementation(async () => ({ ...row }));
  orderUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    row = { ...row, ...args.data };
    return { ...row };
  });
});

describe("a run that raised or was killed is classed by the scraper's kind", () => {
  it("files a portal timeout under portal_timeout", async () => {
    jobAnswers({ status: "error", error_kind: "portal_timeout", error: "Timeout 30000ms exceeded." });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("failed");
    expect(data.errorCode).toBe("portal_timeout");
    expect(data.errorMessage).toBe("Timeout 30000ms exceeded.");
    // Keeping the class changes nothing about the retry: an unknown code is
    // judged exactly like no code.
    expect(data.autoRetryAt).toBeInstanceOf(Date);
    expect(terminalEvent()).toMatchObject({ status: "failed", errorCode: "portal_timeout", attempt: 3 });
  });

  it("files an infra failure under infra", async () => {
    jobAnswers({ status: "error", error_kind: "infra", error: "Browser closed unexpectedly." });
    await pollOrderProgress("ord_1");
    expect(finalWrite().errorCode).toBe("infra");
  });

  it("files an abandoned run under abandoned", async () => {
    jobAnswers({ status: "error", error_kind: "abandoned", error: "Abandoned after 40 minutes." });
    await pollOrderProgress("ord_1");
    expect(finalWrite().errorCode).toBe("abandoned");
  });

  it("keeps null for an older droplet that sends no kind", async () => {
    jobAnswers({ status: "error", error: "The portal did not respond in time." });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.errorCode).toBeNull();
    expect(data.errorMessage).toBe("The portal did not respond in time.");
  });
});

describe("a step failure the copy table has never heard of", () => {
  const RESULT = {
    status: "error",
    error: "voice_no_free_numbers",
    message: "No free numbers were offered on the Voice tab",
    stage: "voice_number",
  };

  it("keeps the scraper's code and files the event on the sub-step it died on", async () => {
    jobAnswers({ status: "done", result: RESULT });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("failed");
    expect(data.errorCode).toBe("voice_no_free_numbers");
    expect(data.errorMessage).toBe("No free numbers were offered on the Voice tab");
    expect(terminalEvent()).toMatchObject({
      status: "failed",
      stage: "voice_number",
      errorCode: "voice_no_free_numbers",
      attempt: 3,
    });
  });

  it("still words a stranded order the way agents already read it", async () => {
    jobAnswers({ status: "done", result: { ...RESULT, order_id: "2608000122816567" } });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.orderId).toBe("2608000122816567");
    expect(data.errorCode).toBe("voice_no_free_numbers");
    expect(data.errorMessage).toBe(
      "Order 2608000122816567 was created but the flow didn't finish: " +
        "No free numbers were offered on the Voice tab. Verify in the portal before retrying.",
    );
  });
});

describe("a job the scraper has forgotten", () => {
  it("is classed job_lost on the row and in the trail", async () => {
    jobIsGone();
    const state = await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.errorCode).toBe("job_lost");
    expect(terminalEvent()).toMatchObject({ status: "warning", errorCode: "job_lost", attempt: 3 });
    expect(state?.errorCode).toBe("job_lost");
  });
});

describe("a run that finished between polls", () => {
  it("files its outcome on the last milestone in the history, not the last poll's stage", async () => {
    jobAnswers({
      status: "error",
      error_kind: "portal_timeout",
      error: "Timeout 30000ms exceeded.",
      stages: [{ name: "creating_customer" }, { name: "checking_address" }, { name: "capture_failure" }],
    });
    await pollOrderProgress("ord_1");
    const moved = orderUpdate.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.stage !== undefined);
    expect(moved?.stage).toBe("checking_address");
    expect(terminalEvent()).toMatchObject({ status: "failed", stage: "checking_address" });
  });

  it("does the same for a result that names no sub-step of its own", async () => {
    jobAnswers({
      status: "done",
      result: { status: "error", error: "exception", message: "boom" },
      stages: [{ name: "creating_customer" }, { name: "checking_address" }, { name: "capture_failure" }],
    });
    await pollOrderProgress("ord_1");
    expect(terminalEvent()).toMatchObject({
      status: "failed",
      stage: "checking_address",
      errorCode: "exception",
    });
  });
});

describe("the Unifi UI sentence is what the log records as the reason", () => {
  const UNIFI = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.';

  it("passes the portal sentence separately from our stranded-order wrapping", async () => {
    jobAnswers({
      status: "done",
      result: {
        status: "error",
        error: "device_out_of_stock",
        message: UNIFI,
        portal_message: UNIFI,
        dialog: { message: UNIFI },
        order_id: "2608000122816567",
      },
    });
    await pollOrderProgress("ord_1");
    const data = finalWrite();
    expect(data.status).toBe("warning");
    expect(data.errorMessage).toBe(UNIFI);
    expect(terminalEvent()).toMatchObject({
      errorCode: "device_out_of_stock",
      portalMessage: UNIFI,
    });
  });
});

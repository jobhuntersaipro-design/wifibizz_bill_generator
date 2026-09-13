import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trail's one funnel mirrors each attempt's terminal row into the sheet.
 *
 * `recordEvent` already promises never to throw, and every terminal writer
 * already goes through it, so the mirror hangs off it rather than off each
 * writer. These pin what reaches Google, and that Google being down cannot fail
 * the submit that was being described.
 */

const { eventCreate, eventFindMany, orderFindUnique, valuesGet, valuesAppend, googleAuthCtor, googleapisLoaded } =
  vi.hoisted(() => ({
    eventCreate: vi.fn(),
    eventFindMany: vi.fn(),
    orderFindUnique: vi.fn(),
    valuesGet: vi.fn(),
    valuesAppend: vi.fn(),
    googleAuthCtor: vi.fn(),
    googleapisLoaded: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orderStatusEvent: {
      create: (...a: unknown[]) => eventCreate(...a),
      findMany: (...a: unknown[]) => eventFindMany(...a),
    },
    order: { findUnique: (...a: unknown[]) => orderFindUnique(...a) },
  },
}));

vi.mock("googleapis", () => {
  googleapisLoaded();
  class GoogleAuth {
    constructor(opts: unknown) {
      googleAuthCtor(opts);
    }
  }
  return {
    google: {
      auth: { GoogleAuth },
      sheets: () => ({
        spreadsheets: {
          values: {
            get: (...a: unknown[]) => valuesGet(...a),
            append: (...a: unknown[]) => valuesAppend(...a),
          },
        },
      }),
    },
  };
});

const { recordEvent } = await import("@/lib/order-history");

const ORDER = {
  id: "ord_1",
  reference: "ORD-0042",
  addressFull: "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610 JENJAROM, SELANGOR",
  street: "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7",
  postcode: "42610",
  city: "JENJAROM",
  state: "SELANGOR",
  orderId: "2608000122816567",
  screenshotUrl: null,
  user: { email: "agent@bizz.example" },
};

const FAILED = {
  orderId: "ord_1",
  attempt: 2,
  status: "failed",
  stage: "selecting_device",
  message: '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.',
  errorCode: "device_out_of_stock",
};

const DETAIL = "https://bizzflow.example/dashboard/order-entry/orders/ord_1";
const FAILURE_KEY = "order-screenshots/u1/ord_1/submit-2-failure.jpg";

const ROW = [
  "2026-09-13T10:15:30.000Z",
  "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610 JENJAROM, SELANGOR",
  "selecting_device",
  "device_out_of_stock",
  '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.',
  DETAIL,
  "2608000122816567",
  "failed",
  "ORD-0042",
  "2",
  "40300338",
  "agent@bizz.example",
];

const HEADERS = [
  "timestamp", "address", "step", "error_class", "portal_message", "screenshot_or_log",
  "order_id", "outcome", "reference", "attempt", "portal_code", "agent",
];

/** A service account shaped like Google's, with nothing real in it. */
const FAKE_SERVICE_ACCOUNT = JSON.stringify({
  client_email: "outcome-log@example.iam.gserviceaccount.com",
  private_key: "not-a-key",
});

function sheetIsConfigured() {
  vi.stubEnv("ORDER_ENTRY_OUTCOME_SHEET_ID", "sheet_123");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", FAKE_SERVICE_ACCOUNT);
  vi.stubEnv("BIZZFLOW_APP_URL", "https://bizzflow.example");
}

function appendPayload() {
  return valuesAppend.mock.calls[0]?.[0] as {
    spreadsheetId: string;
    range: string;
    valueInputOption: string;
    requestBody: { values: string[][] };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-13T10:15:30.000Z"));
  eventCreate.mockResolvedValue({});
  eventFindMany.mockResolvedValue([]);
  orderFindUnique.mockResolvedValue({ ...ORDER });
  valuesGet.mockResolvedValue({ data: { values: [HEADERS] } });
  valuesAppend.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("without a sheet configured", () => {
  it("loads nothing and appends nothing, then does once a sheet is named", async () => {
    vi.stubEnv("ORDER_ENTRY_OUTCOME_SHEET_ID", "");
    await recordEvent(FAILED);
    expect(googleapisLoaded).not.toHaveBeenCalled();
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(valuesAppend).not.toHaveBeenCalled();
    expect(eventCreate.mock.calls[0][0]).toEqual({
      data: {
        orderId: "ord_1", attempt: 2, status: "failed", stage: "selecting_device",
        message: '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.',
        errorCode: "device_out_of_stock",
      },
    });

    sheetIsConfigured();
    await recordEvent(FAILED);
    expect(googleapisLoaded).toHaveBeenCalledTimes(1);
    expect(appendPayload().requestBody.values).toEqual([ROW]);
  });
});

describe("with a sheet configured", () => {
  beforeEach(sheetIsConfigured);

  it("appends one row per terminal event, laid out exactly as the headers say", async () => {
    await recordEvent(FAILED);
    expect(valuesAppend).toHaveBeenCalledTimes(1);
    expect(appendPayload()).toEqual({
      spreadsheetId: "sheet_123",
      range: "A:L",
      valueInputOption: "RAW",
      requestBody: { values: [ROW] },
    });
    expect(valuesAppend.mock.calls[0][1]).toEqual({ timeout: 8000 });
    expect(valuesGet.mock.calls[0][0]).toEqual({ spreadsheetId: "sheet_123", range: "A1:L1" });
    expect(googleAuthCtor.mock.calls[0][0]).toEqual({
      credentials: {
        client_email: "outcome-log@example.iam.gserviceaccount.com",
        private_key: "not-a-key",
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  });

  it("writes the header row first into an empty sheet", async () => {
    valuesGet.mockResolvedValue({ data: {} });
    await recordEvent(FAILED);
    expect(valuesAppend).toHaveBeenCalledTimes(1);
    expect(appendPayload().requestBody.values).toEqual([HEADERS, ROW]);
  });

  it("mirrors a clean submit as success on the step it finished on", async () => {
    await recordEvent({ orderId: "ord_1", attempt: 2, status: "submitted", stage: "submitted" });
    expect(appendPayload().requestBody.values[0]).toEqual([
      "2026-09-13T10:15:30.000Z",
      "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610 JENJAROM, SELANGOR",
      "submitted",
      "success",
      "",
      DETAIL,
      "2608000122816567",
      "submitted",
      "ORD-0042",
      "2",
      "",
      "agent@bizz.example",
    ]);
  });

  it("mirrors only the row that ends an attempt", async () => {
    await recordEvent({ orderId: "ord_1", attempt: 2, status: "submitting", stage: "checking_address" });
    await recordEvent({ orderId: "ord_1", attempt: 2, status: "info", message: "Device substituted." });
    expect(valuesAppend).not.toHaveBeenCalled();
    await recordEvent({ ...FAILED, status: "warning", orderId: "ord_1" });
    expect(appendPayload().requestBody.values[0][7]).toBe("warning");
  });

  it("never lets Google fail the submit it is describing", async () => {
    valuesAppend.mockRejectedValue(new Error("503 backend error"));
    await expect(recordEvent(FAILED)).resolves.toBeUndefined();
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("[outcome-log] failed (continuing):");
  });

  it("records the death screen from capture_failure, not page 1", async () => {
    eventFindMany.mockResolvedValue([
      { stage: "capture_page1", message: "order-screenshots/u1/ord_1/submit-2-page1.jpg" },
      { stage: "capture_failure", message: FAILURE_KEY },
    ]);
    await recordEvent(FAILED);
    expect(appendPayload().requestBody.values[0][5]).toBe(`${DETAIL} | ${FAILURE_KEY}`);
  });

  it("leaves portal_message empty when the only text is a BizzFlow class", async () => {
    await recordEvent({
      orderId: "ord_1", attempt: 2, status: "failed", stage: "checking_address",
      message: "The portal run failed.", errorCode: "portal_timeout",
    });
    const row = appendPayload().requestBody.values[0];
    expect(row[3]).toBe("portal_timeout");
    expect(row[4]).toBe("");
  });
});

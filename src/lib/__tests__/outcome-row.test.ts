import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OUTCOME_SHEET_HEADERS,
  deathScreenKey,
  outcomeFor,
  outcomeRow,
  portalUiText,
  type OutcomeOrder,
} from "@/lib/order-outcome-log";
import type { StatusEventInput } from "@/lib/order-history";

/**
 * One terminal outcome as one sheet row.
 *
 * The Unifi UI sentence is the reason. The class column is a grouping key and
 * must never be empty; it is not the why. When the portal showed nothing, the
 * death-screen frame is the evidence.
 */

const ORDER: OutcomeOrder = {
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

const AT = new Date("2026-09-13T10:15:30.000Z");
const UNIFI = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.';
const FAILURE_KEY = "order-screenshots/u1/ord_1/submit-4-failure.jpg";
const PAGE1_KEY = "order-screenshots/u1/ord_1/submit-4-page1.jpg";
const DETAIL = "https://bizzflow.example/dashboard/order-entry/orders/ord_1";

const event = (over: Partial<StatusEventInput>): StatusEventInput => ({
  orderId: "ord_1", attempt: 4, status: "failed", stage: "voice_number",
  message: null, errorCode: null, createdAt: AT, ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("portalUiText", () => {
  it("quotes the Unifi dialog in preference to our wrapping", () => {
    expect(portalUiText({
      portalMessage: UNIFI,
      message: `Order 2608000122816567 was created but the flow didn't finish: ${UNIFI}. Verify in the portal before retrying.`,
    })).toBe(UNIFI);
    expect(portalUiText({
      dialog: { message: UNIFI, title: "Error" },
      message: "device_out_of_stock",
    })).toBe(UNIFI);
  });

  it("extracts the Unifi sentence from a stranded-order wrap", () => {
    expect(portalUiText({
      message: `Order 2608000122816567 was created but the flow didn't finish: ${UNIFI}. Verify in the portal before retrying.`,
    })).toBe(UNIFI);
  });

  it("does not treat a BizzFlow class or slug as the reason", () => {
    expect(portalUiText({ message: "unclassified" })).toBe("");
    expect(portalUiText({ message: "job_lost" })).toBe("");
    expect(portalUiText({ message: "voice_no_free_numbers" })).toBe("");
    expect(portalUiText({ message: "The submit run was lost (the order service restarted). Check the portal." })).toBe("");
    expect(portalUiText({ message: "The portal run failed." })).toBe("");
    expect(portalUiText({ portalMessage: "exception" })).toBe("");
  });
});

describe("deathScreenKey", () => {
  it("prefers the failure frame over page 1", () => {
    expect(deathScreenKey([
      { stage: "capture_page1", message: PAGE1_KEY },
      { stage: "capture_failure", message: FAILURE_KEY },
    ])).toBe(FAILURE_KEY);
  });

  it("falls back to the last capture when the run never photographed a failure", () => {
    expect(deathScreenKey([
      { stage: "capture_page1", message: PAGE1_KEY },
      { stage: "capture_pay", message: "order-screenshots/u1/ord_1/submit-4-pay.jpg" },
    ])).toBe("order-screenshots/u1/ord_1/submit-4-pay.jpg");
  });
});

describe("outcomeFor", () => {
  it("classes a clean submit as success", () => {
    vi.stubEnv("BIZZFLOW_APP_URL", "https://bizzflow.example/");
    const o = outcomeFor(ORDER, event({ status: "submitted", stage: "submitted", errorCode: null }));
    expect(o).toEqual({
      timestamp: "2026-09-13T10:15:30.000Z",
      address: "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610 JENJAROM, SELANGOR",
      step: "submitted",
      errorClass: "success",
      portalMessage: "",
      screenshotOrLog: DETAIL,
      orderId: "2608000122816567",
      outcome: "submitted",
      reference: "ORD-0042",
      attempt: 4,
      portalCode: "",
      agent: "agent@bizz.example",
    });
  });

  it("uses the scraper's code as the class when there is one", () => {
    const o = outcomeFor(ORDER, event({ errorCode: "device_out_of_stock" }));
    expect(o.errorClass).toBe("device_out_of_stock");
    expect(o.outcome).toBe("failed");
    expect(o.portalMessage).toBe("");
  });

  it("classes a failure with no code as unclassified, never as blank", () => {
    expect(outcomeFor(ORDER, event({ status: "failed" })).errorClass).toBe("unclassified");
    expect(outcomeFor(ORDER, event({ status: "warning" })).errorClass).toBe("unclassified");
  });

  it("never puts unclassified into portal_message", () => {
    const o = outcomeFor(ORDER, event({ status: "failed", errorCode: null, message: "unclassified" }));
    expect(o.errorClass).toBe("unclassified");
    expect(o.portalMessage).toBe("");
  });

  it("classes a customer-only run as order_entered", () => {
    expect(outcomeFor(ORDER, event({ status: "order_entered" })).errorClass).toBe("order_entered");
  });

  it("pulls the portal's own code out of the Unifi sentence", () => {
    const o = outcomeFor(ORDER, event({
      errorCode: "device_out_of_stock",
      message: UNIFI,
    }));
    expect(o.portalCode).toBe("40300338");
    expect(o.portalMessage).toBe(UNIFI);
  });

  it("builds the address from its parts when the full one is missing", () => {
    const o = outcomeFor({ ...ORDER, addressFull: null, city: null }, event({}));
    expect(o.address).toBe("A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610, SELANGOR");
  });

  it("files a failure before any stage under start", () => {
    expect(outcomeFor(ORDER, event({ stage: null })).step).toBe("start");
  });

  it("falls back to the order's own id for the link and the reference", () => {
    vi.stubEnv("BIZZFLOW_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    const o = outcomeFor({ ...ORDER, reference: null, orderId: null, user: null }, event({}));
    expect(o.screenshotOrLog).toBe("ord_1");
    expect(o.reference).toBe("ord_1");
    expect(o.orderId).toBe("");
    expect(o.agent).toBe("");
  });

  it("records the death screen, not the page-1 stand-in", () => {
    vi.stubEnv("BIZZFLOW_APP_URL", "https://bizzflow.example");
    const o = outcomeFor(
      { ...ORDER, screenshotUrl: PAGE1_KEY },
      event({ deathScreenKey: FAILURE_KEY }),
    );
    expect(o.screenshotOrLog).toBe(`${DETAIL} | ${FAILURE_KEY}`);
  });

  it("does not treat the page-1 stand-in as the death screen", () => {
    vi.stubEnv("BIZZFLOW_APP_URL", "https://bizzflow.example");
    const o = outcomeFor({ ...ORDER, screenshotUrl: PAGE1_KEY }, event({}));
    expect(o.screenshotOrLog).toBe(DETAIL);
    expect(o.screenshotOrLog).not.toContain("page1");
  });

  it("stamps the moment of mirroring when the event carries no time of its own", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T11:00:00.000Z"));
    expect(outcomeFor(ORDER, event({ createdAt: undefined })).timestamp).toBe("2026-09-13T11:00:00.000Z");
  });
});

describe("outcomeRow", () => {
  it("lays the columns out in header order", () => {
    vi.stubEnv("BIZZFLOW_APP_URL", "https://bizzflow.example");
    const row = outcomeRow(outcomeFor(ORDER, event({
      errorCode: "device_out_of_stock",
      message: UNIFI,
      deathScreenKey: FAILURE_KEY,
    })));
    expect(row).toEqual([
      "2026-09-13T10:15:30.000Z",
      "A-07-15, PERSIARAN SAUJANA PUTRA UTAMA 7, 42610 JENJAROM, SELANGOR",
      "voice_number",
      "device_out_of_stock",
      UNIFI,
      `${DETAIL} | ${FAILURE_KEY}`,
      "2608000122816567",
      "failed",
      "ORD-0042",
      "4",
      "40300338",
      "agent@bizz.example",
    ]);
    expect(row).toHaveLength(OUTCOME_SHEET_HEADERS.length);
  });

  it("names the twelve columns the sheet is filtered on", () => {
    expect([...OUTCOME_SHEET_HEADERS]).toEqual([
      "timestamp", "address", "step", "error_class", "portal_message", "screenshot_or_log",
      "order_id", "outcome", "reference", "attempt", "portal_code", "agent",
    ]);
  });

  it("flattens tabs and newlines so a message can never break a row", () => {
    const row = outcomeRow(outcomeFor(ORDER, event({
      message: "Line one\n\tLine two\r\nLine three",
    })));
    expect(row[4]).toBe("Line one Line two Line three");
  });

  it("truncates a runaway portal message to 2000 characters", () => {
    const row = outcomeRow(outcomeFor(ORDER, event({ message: "x".repeat(2500) })));
    expect(row[4]).toBe("x".repeat(2000));
  });
});

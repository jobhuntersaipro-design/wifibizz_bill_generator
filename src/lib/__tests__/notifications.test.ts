import { describe, expect, it } from "vitest";
import { isValidEmail, resolveRecipient } from "@/lib/notifications/recipient";
import {
  bucketOf,
  describeOutcome,
  formatDuration,
  outcomeSubject,
  summarize,
  type OrderOutcome,
} from "@/lib/notifications/outcomes";
import { batchSummaryEmail, esc, singleResultEmail } from "@/lib/notifications/templates";

/**
 * What an email says, and who it says it to.
 *
 * These rules are the whole product of the feature: a row labelled "Submitted"
 * is one nobody chases, and a row labelled "Order Entered" sends someone into
 * the Unifi portal to void or finish a real, chargeable order. Getting either
 * wrong costs money, and neither is visible from reading a template.
 */

const outcome = (over: Partial<OrderOutcome> = {}): OrderOutcome => ({
  orderId: "ord_1",
  reference: "ORD-0042",
  fullName: "AISYAH BINTI RAHIM",
  status: "submitted",
  portalOrderNo: null,
  errorCode: null,
  errorMessage: null,
  ...over,
});

describe("resolveRecipient", () => {
  it("prefers the configured notification address", () => {
    expect(
      resolveRecipient({ notificationEmail: "ops@example.com", email: "login@example.com" }),
    ).toBe("ops@example.com");
  });

  it("falls back to the login email when the field is unset", () => {
    expect(resolveRecipient({ notificationEmail: null, email: "login@example.com" })).toBe(
      "login@example.com",
    );
  });

  it("treats a whitespace-only field as blank", () => {
    // A field holding only spaces is a blank field. Sending to it would turn
    // every notification into a provider error nobody sees.
    expect(resolveRecipient({ notificationEmail: "   ", email: "login@example.com" })).toBe(
      "login@example.com",
    );
  });

  it("returns null when there is nowhere to send", () => {
    expect(resolveRecipient({ notificationEmail: null, email: null })).toBeNull();
    expect(resolveRecipient({ notificationEmail: "  ", email: "  " })).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts an ordinary address and refuses obvious typos", () => {
    expect(isValidEmail("agent@bizzflow.top")).toBe(true);
    expect(isValidEmail(" agent@bizzflow.top ")).toBe(true);
    for (const bad of ["agent", "agent@", "@bizzflow.top", "agent@bizzflow", "a b@c.com"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe("bucketOf — what actually happened at the portal", () => {
  it("calls a paid run submitted", () => {
    expect(bucketOf({ status: "submitted", portalOrderNo: "2608000121625616" })).toBe("submitted");
  });

  it("calls a stranded warning an order entered, because a real order exists", () => {
    // This is the case that costs money if it is described as a plain failure:
    // the portal HAS an order and someone must void or finish it.
    expect(bucketOf({ status: "warning", portalOrderNo: "2608000121428560" })).toBe("order_entered");
  });

  it("calls a warning with no order number a failure", () => {
    // Nothing reached the portal, so nothing is owed. Reporting "order entered"
    // here would send an agent hunting for an order that does not exist.
    expect(bucketOf({ status: "warning", portalOrderNo: null })).toBe("failed");
  });

  it("keeps order_entered even without a number, for the customer-create-only stop", () => {
    expect(bucketOf({ status: "order_entered", portalOrderNo: null })).toBe("order_entered");
  });

  it("calls a plain failure a failure", () => {
    expect(bucketOf({ status: "failed", portalOrderNo: null })).toBe("failed");
  });
});

describe("describeOutcome", () => {
  it("tells a stranded order it needs a human in the portal", () => {
    const d = describeOutcome({ status: "warning", portalOrderNo: "2608000121428560" });
    expect(d.label).toBe("Order Entered");
    expect(d.detail).toMatch(/resubmit it or void it/i);
  });

  it("tells a plain failure the draft is safe to submit again", () => {
    const d = describeOutcome({ status: "failed", portalOrderNo: null });
    expect(d.detail).toMatch(/submitted again/i);
  });
});

describe("outcomeSubject", () => {
  it("leads with the outcome, not the customer", () => {
    expect(outcomeSubject({ status: "submitted", portalOrderNo: "1" }, "SITI")).toBe(
      "✅ Order submitted — SITI",
    );
    expect(outcomeSubject({ status: "warning", portalOrderNo: "1" }, "SITI")).toBe(
      "⚠️ Order entered but not completed — SITI",
    );
    expect(outcomeSubject({ status: "failed", portalOrderNo: null }, "SITI")).toBe(
      "❌ Order failed — SITI",
    );
  });
});

describe("summarize", () => {
  it("counts every order into exactly one bucket", () => {
    const t = summarize([
      outcome({ status: "submitted", portalOrderNo: "1" }),
      outcome({ status: "submitted", portalOrderNo: "2" }),
      outcome({ status: "warning", portalOrderNo: "3" }),
      outcome({ status: "order_entered", portalOrderNo: null }),
      outcome({ status: "failed", portalOrderNo: null }),
      outcome({ status: "warning", portalOrderNo: null }),
    ]);
    expect(t).toEqual({ total: 6, submitted: 2, orderEntered: 2, failed: 2 });
    expect(t.submitted + t.orderEntered + t.failed).toBe(t.total);
  });

  it("handles an empty run without inventing a total", () => {
    expect(summarize([])).toEqual({ total: 0, submitted: 0, orderEntered: 0, failed: 0 });
  });
});

describe("formatDuration", () => {
  it("reads in the largest useful unit", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(95_000)).toBe("1m 35s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("refuses to render nonsense as a real duration", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("esc", () => {
  it("escapes the characters that would truncate the email", () => {
    // An unescaped `<` in a customer name does not merely render oddly — it can
    // swallow the rest of the document, so the reader silently loses the results
    // listed below it.
    expect(esc('AB & <script>alert("x")</script>')).toBe(
      "AB &amp; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("renders a missing value as empty rather than the word undefined", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("singleResultEmail", () => {
  it("names the customer, reference and portal order number", () => {
    const { subject, html } = singleResultEmail(
      outcome({ status: "submitted", portalOrderNo: "2608000121625616" }),
    );
    expect(subject).toBe("✅ Order submitted — AISYAH BINTI RAHIM");
    expect(html).toContain("AISYAH BINTI RAHIM");
    expect(html).toContain("ORD-0042");
    expect(html).toContain("2608000121625616");
  });

  it("carries the portal's own sentence verbatim on a failure", () => {
    // That sentence is what an agent quotes at Unifi support. Paraphrasing it
    // makes it unquotable.
    const portalSays = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.';
    const { html } = singleResultEmail(
      outcome({
        status: "warning",
        portalOrderNo: "2608000121428560",
        errorCode: "device_out_of_stock",
        errorMessage: portalSays,
      }),
    );
    expect(html).toContain("[40300338]");
    expect(html).toContain("out of stock");
  });

  it("escapes a customer name containing markup", () => {
    const { html } = singleResultEmail(outcome({ fullName: "A & B <Ltd>" }));
    expect(html).toContain("A &amp; B &lt;Ltd&gt;");
    expect(html).not.toContain("<Ltd>");
  });
});

describe("batchSummaryEmail", () => {
  const results = [
    outcome({ orderId: "a", reference: "ORD-0001", fullName: "FIRST", status: "submitted", portalOrderNo: "111" }),
    outcome({ orderId: "b", reference: "ORD-0002", fullName: "SECOND", status: "failed", errorMessage: "no offers listed" }),
    outcome({ orderId: "c", reference: "ORD-0003", fullName: "THIRD", status: "warning", portalOrderNo: "333" }),
  ];

  it("leads the subject with how many actually went through", () => {
    const { subject } = batchSummaryEmail({
      results,
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:20:00Z"),
    });
    expect(subject).toBe("Batch submit finished: 1/3 submitted");
  });

  it("lists every order in run order, and says what needs a human", () => {
    const { html } = batchSummaryEmail({
      results,
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:20:00Z"),
    });
    for (const name of ["FIRST", "SECOND", "THIRD"]) expect(html).toContain(name);
    expect(html.indexOf("FIRST")).toBeLessThan(html.indexOf("SECOND"));
    expect(html.indexOf("SECOND")).toBeLessThan(html.indexOf("THIRD"));
    // The one stranded order must be called out, not just counted.
    expect(html).toMatch(/1 order reached the Unifi portal without finishing/);
    expect(html).toContain("20m 0s");
  });

  it("says nothing about needing attention when nothing does", () => {
    const { html } = batchSummaryEmail({
      results: [results[0]],
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:00:30Z"),
    });
    expect(html).not.toMatch(/without finishing/);
  });
});

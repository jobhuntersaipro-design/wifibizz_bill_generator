import { describe, expect, it } from "vitest";
import { isValidEmail, resolveRecipient } from "@/lib/notifications/recipient";
import {
  batchBucket,
  batchSubject,
  bucketOf,
  caseDetailsFrom,
  describeOutcome,
  formatDuration,
  maskIdNumber,
  outcomeSubject,
  shortErrorMessage,
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

describe("bucketOf — did the submit finish, or not", () => {
  it("calls a paid run submitted", () => {
    expect(bucketOf({ status: "submitted", portalOrderNo: "2608000121625616" })).toBe("submitted");
  });

  it("calls a stranded order a failure, however far it got", () => {
    // The portal HAS an order here, and the run still did not finish. Two
    // verdicts taught the reader to decide which one counted; one does not.
    expect(bucketOf({ status: "warning", portalOrderNo: "2608000121428560" })).toBe("failed");
    expect(bucketOf({ status: "order_entered", portalOrderNo: null })).toBe("failed");
  });

  it("calls a plain failure a failure", () => {
    expect(bucketOf({ status: "failed", portalOrderNo: null })).toBe("failed");
    expect(bucketOf({ status: "warning", portalOrderNo: null })).toBe("failed");
  });

  it("never calls anything but a finished submit a success", () => {
    // The rule is one-sided on purpose: a new status nobody mapped comes out as
    // a failure, which is the safe direction to be wrong in.
    for (const status of ["draft", "submitting", "cancelled", "something_new"]) {
      expect(bucketOf({ status, portalOrderNo: "111" })).toBe("failed");
    }
  });
});

describe("describeOutcome", () => {
  it("does not tell a stranded order its draft is untouched", () => {
    // It is not: the portal already holds an order for this customer, and
    // "submit it again" would be an instruction to create a second one.
    const d = describeOutcome({ status: "warning", portalOrderNo: "2608000121428560" });
    expect(d.label).toBe("Failed");
    expect(d.detail).not.toMatch(/submitted again/i);
    expect(d.detail).toMatch(/did not finish/i);
  });

  it("tells a plain failure the draft is safe to submit again", () => {
    const d = describeOutcome({ status: "failed", portalOrderNo: null });
    expect(d.label).toBe("Failed");
    expect(d.detail).toMatch(/submitted again/i);
  });
});

describe("outcomeSubject", () => {
  it("leads with the mark and the verdict, not the customer", () => {
    expect(outcomeSubject({ status: "submitted", portalOrderNo: "1" }, "SITI")).toBe(
      "✅ Order submitted — SITI",
    );
    expect(outcomeSubject({ status: "warning", portalOrderNo: "1" }, "SITI")).toBe(
      "❌ Order failed — SITI",
    );
    expect(outcomeSubject({ status: "failed", portalOrderNo: null }, "SITI")).toBe(
      "❌ Order failed — SITI",
    );
  });
});

describe("summarize", () => {
  it("counts every order as submitted or failed, nothing else", () => {
    const t = summarize([
      outcome({ status: "submitted", portalOrderNo: "1" }),
      outcome({ status: "submitted", portalOrderNo: "2" }),
      outcome({ status: "warning", portalOrderNo: "3" }),
      outcome({ status: "order_entered", portalOrderNo: null }),
      outcome({ status: "failed", portalOrderNo: null }),
      outcome({ status: "warning", portalOrderNo: null }),
    ]);
    expect(t).toEqual({ total: 6, submitted: 2, failed: 4 });
    expect(t.submitted + t.failed).toBe(t.total);
  });

  it("handles an empty run without inventing a total", () => {
    expect(summarize([])).toEqual({ total: 0, submitted: 0, failed: 0 });
  });
});

describe("batchBucket and batchSubject", () => {
  it("marks a batch green only when every order went through", () => {
    expect(batchBucket({ total: 3, submitted: 3, failed: 0 })).toBe("submitted");
    // One failure in ten is still a run somebody has to open.
    expect(batchBucket({ total: 10, submitted: 9, failed: 1 })).toBe("failed");
  });

  it("refuses to call an empty batch a success", () => {
    expect(batchBucket({ total: 0, submitted: 0, failed: 0 })).toBe("failed");
  });

  it("puts the mark and the count in the subject", () => {
    expect(batchSubject({ total: 3, submitted: 3, failed: 0 })).toBe(
      "✅ Batch submit finished — 3 of 3 submitted",
    );
    expect(batchSubject({ total: 3, submitted: 1, failed: 2 })).toBe(
      "❌ Batch submit finished — 1 of 3 submitted",
    );
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
    expect(subject).toBe("❌ Batch submit finished — 1 of 3 submitted");
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
    // The stranded order is a failure like any other now — no separate block,
    // but its portal order number is still on the card as a fact.
    expect(html).not.toMatch(/reached the Unifi portal without finishing/);
    expect(html).toContain("333");
    expect(html).toContain("20m 0s");
  });

  it("marks an all-clear batch with the tick, in the subject and the heading", () => {
    const { subject, html } = batchSummaryEmail({
      results: [results[0]],
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:00:30Z"),
    });
    expect(subject).toBe("✅ Batch submit finished — 1 of 1 submitted");
    expect(html).toContain("✅");
    expect(html).not.toContain("❌");
  });

  it("marks a batch with any failure in it with the cross", () => {
    const { html } = batchSummaryEmail({
      results,
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:20:00Z"),
    });
    expect(html).toContain("❌");
  });
});

describe("maskIdNumber", () => {
  it("keeps a MyKad recognisable while hiding all but the last four", () => {
    // Email is forwarded, indexed and kept — the last four are all a reader
    // needs to tell two customers apart, and the app holds the rest.
    expect(maskIdNumber("920505034434")).toBe("••••••-••-4434");
    expect(maskIdNumber("920505-03-4434")).toBe("••••••-••-4434");
  });

  it("masks a passport-shaped ID too, and never invents digits", () => {
    expect(maskIdNumber("A1234567")).toBe("••••4567");
    expect(maskIdNumber("")).toBe("");
    expect(maskIdNumber(null)).toBe("");
  });
});

describe("caseDetailsFrom", () => {
  it("builds the phone from the prefix the order carries", () => {
    const d = caseDetailsFrom({ mobilePrefix: "60", mobile: "148893212" });
    expect(d.mobile).toBe("+60148893212");
  });

  it("reports a missing phone as absent rather than as a bare country code", () => {
    // "+60" in an email reads as a phone number that is wrong, not as one that
    // was never captured.
    expect(caseDetailsFrom({ mobilePrefix: "60", mobile: null }).mobile).toBeNull();
  });
});

describe("case details in the emails", () => {
  const details = {
    idType: "MyKad",
    idNumber: "920505034434",
    mobile: "+60148893212",
    email: "jjllac213@gmail.com",
    address: "C-30-11 JALAN ECO MAJESTIC SEMENYIH SELANGOR 43500",
    offerName: "Unifi Home 500Mbps Premium Value With Device (36M)",
    deviceName: "Apple 11-inch iPad Wi-Fi 256GB",
    installationDate: "2026-08-25 09:30-12:00",
  };

  it("repeats the case back, with the ID masked", () => {
    const { html } = singleResultEmail(outcome({ details }));
    expect(html).toContain("MyKad");
    expect(html).toContain("••••••-••-4434");
    expect(html).not.toContain("920505034434");
    expect(html).toContain("+60148893212");
    expect(html).toContain("ECO MAJESTIC");
    expect(html).toContain("500Mbps");
    expect(html).toContain("2026-08-25 09:30-12:00");
  });

  it("shows the details on every row of a batch", () => {
    const { html } = batchSummaryEmail({
      results: [outcome({ details }), outcome({ orderId: "b", fullName: "SECOND", details })],
      startedAt: new Date("2026-08-21T01:00:00Z"),
      finishedAt: new Date("2026-08-21T01:10:00Z"),
    });
    expect(html.match(/••••••-••-4434/g)).toHaveLength(2);
  });

  it("omits a field it has no value for, rather than printing a dash", () => {
    // A dash reads as "this order has no package". These blocks also render for
    // runs recorded before the details existed, where that would be a lie.
    const { html } = singleResultEmail(outcome({ details: { offerName: "Unifi Home 100Mbps" } }));
    expect(html).toContain("Unifi Home 100Mbps");
    expect(html).not.toContain("Address");
    expect(html).not.toContain("Phone");
  });

  it("still renders a result recorded before details existed", () => {
    const { html } = singleResultEmail(outcome({ details: undefined }));
    expect(html).toContain("AISYAH BINTI RAHIM");
    expect(html).not.toContain("Case details");
  });
});

describe("shortErrorMessage", () => {
  it("leaves a portal sentence alone", () => {
    const portalSays = '[40300338]: Sorry, the SAMSUNG TV 55" is currently out of stock.';
    expect(shortErrorMessage(portalSays)).toBe(portalSays);
  });

  it("cuts a locator dump down and says that it did", () => {
    // A real failure produced a 2,000-character Playwright dump that filled the
    // whole email and buried the other orders' results beneath it.
    const dump = "Timeout 6000ms exceeded. Call log: " + "- waiting for locator ".repeat(200);
    const out = shortErrorMessage(dump)!;
    expect(out.length).toBeLessThan(420);
    expect(out).toContain("Timeout 6000ms exceeded");
    expect(out).toContain("truncated");
  });

  it("collapses the whitespace a dump is padded with", () => {
    expect(shortErrorMessage("a\n\n   b")).toBe("a b");
    expect(shortErrorMessage("   ")).toBeNull();
    expect(shortErrorMessage(null)).toBeNull();
  });
});

describe("email encoding", () => {
  it("declares utf-8, so the masked ID and the em dash are not mojibake", () => {
    // Rendered without this, "••••••-••-4434" arrives as "â€¢â€¢…" in any client
    // that guesses the encoding.
    const { html } = singleResultEmail(outcome({ details: { idNumber: "920505034434" } }));
    expect(html).toContain('<meta charset="utf-8"/>');
  });
});

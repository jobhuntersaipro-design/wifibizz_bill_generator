import { describe, expect, it } from "vitest";
import {
  CAPTURE_EXPIRY_WARN_DAYS,
  LEGACY_PAGE1_CAPTURE_STAGE,
  captureLabel,
  captureSlot,
  daysUntilExpiry,
  expiryLabel,
  isCaptureStage,
  isPdfCapture,
  isScreenshotKey,
  mergeTimeline,
  partitionCaptures,
  stepIndexForStage,
  type TimelineEvent,
} from "@/lib/order-types";

/**
 * The capture trail: nine frames per attempt instead of one.
 *
 * Two things here are load-bearing and neither is visible in a screenshot of the
 * panel: that captures are partitioned OUT of the step checklist (a row reading
 * out a raw R2 key is a leak, not information), and that a frame's countdown
 * describes the retention policy honestly at every edge.
 */

let n = 0;
const ev = (stage: string | null, message: string | null, at: string): TimelineEvent => ({
  id: `e${++n}`,
  stage,
  message,
  createdAt: at,
});

const key = (slot: string) => `order-screenshots/u1/o1/submit-1-${slot}.jpg`;

describe("capture stage recognition", () => {
  it("matches by prefix, so a slot this build has never seen still counts", () => {
    // The scraper (droplet) deploys separately from BizzFlow (Vercel) and WILL
    // emit slots added after this build shipped.
    expect(isCaptureStage("capture_broadband")).toBe(true);
    expect(isCaptureStage("capture_something_new")).toBe(true);
    expect(isCaptureStage("winback_tagging")).toBe(false);
    expect(isCaptureStage(null)).toBe(false);
  });

  it("still recognises the single Phase-1 capture stage", () => {
    // Rows written before Phase 3 are still in the database.
    expect(isCaptureStage(LEGACY_PAGE1_CAPTURE_STAGE)).toBe(true);
    expect(captureSlot(LEGACY_PAGE1_CAPTURE_STAGE)).toBe("page1");
  });

  it("humanises an unknown slot rather than dropping the frame", () => {
    expect(captureLabel("broadband")).toBe("Broadband tab");
    expect(captureLabel("some_new_tab")).toBe("Some new tab");
  });

  it("names the failure and form frames instead of falling back", () => {
    // The failure frame is the one the agent opens first on a red attempt —
    // it must read as what it is, not as a humanised slug.
    expect(captureLabel("failure")).toBe("At the moment of failure");
    expect(captureLabel("customer_form")).toBe("Customer profile form");
    expect(captureLabel("offer_grid")).toBe("Offer grid");
  });

  it("is never mistaken for a step in the checklist", () => {
    expect(stepIndexForStage("capture_pay")).toBe(-1);
  });

  it("accepts a legacy PNG key as well as a JPEG one", () => {
    // Every frame captured before Phase 3 is a PNG and those objects still exist.
    expect(isScreenshotKey("order-screenshots/u/o/submit-1-page1.png")).toBe(true);
    expect(isScreenshotKey(key("pay"))).toBe(true);
    // A failed capture records its REASON in the same field.
    expect(isScreenshotKey("Screenshot not stored")).toBe(false);
    expect(isScreenshotKey("orders/u/id-copy.jpg")).toBe(false);
  });

  it("accepts the e-RF PDF, which travels the same capture path", () => {
    const erf = "order-screenshots/u/o/2608000121575083_erf.pdf";
    // Rejecting it here would render the R2 key as a failure REASON in a text
    // row — the exact leak partitionCaptures exists to prevent.
    expect(isScreenshotKey(erf)).toBe(true);
    expect(isPdfCapture(erf)).toBe(true);
    // …and every image renderer has to be able to tell the two apart, because
    // an <img> pointed at a PDF fails silently rather than visibly.
    expect(isPdfCapture(key("pay"))).toBe(false);
    expect(isPdfCapture("order-screenshots/u/o/submit-1-page1.png")).toBe(false);
    expect(isPdfCapture("e-RF not stored")).toBe(false);
    expect(isPdfCapture(null)).toBe(false);
    // The prefix rule still binds: a PDF outside the capture namespace is not
    // a capture, whatever it is called.
    expect(isScreenshotKey("orders/u/o/2608000121575083_erf.pdf")).toBe(false);
  });

  it("labels and captions the post-payment slots", () => {
    expect(captureLabel("erf")).toBe("e-RF (Registration Form)");
    expect(captureLabel("erf_page")).toBe("Order confirmation");
    expect(stepIndexForStage("capture_erf")).toBe(-1);
  });
});

describe("partitionCaptures", () => {
  it("pulls captured frames out of the step list", () => {
    const { steps, captures } = partitionCaptures([
      ev("winback_tagging", "New", "2026-08-16T01:00:00.000Z"),
      ev("capture_page1", key("page1"), "2026-08-16T01:00:01.000Z"),
      ev("selecting_device", "Samsung TV 55inch", "2026-08-16T01:00:02.000Z"),
      ev("capture_broadband", key("broadband"), "2026-08-16T01:00:03.000Z"),
    ]);
    expect(steps.map((s) => s.stage)).toEqual(["winback_tagging", "selecting_device"]);
    expect(captures.map((c) => c.slot)).toEqual(["page1", "broadband"]);
    expect(captures[0].key).toBe(key("page1"));
  });

  it("keeps a FAILED capture as a step row so the slot says why", () => {
    // Dropping it would make a failed capture indistinguishable from a slot the
    // offer never had.
    const { steps, captures } = partitionCaptures([
      ev("capture_voice", "Screenshot not stored", "2026-08-16T01:00:00.000Z"),
    ]);
    expect(captures).toEqual([]);
    expect(steps).toHaveLength(1);
  });

  it("leaves an attempt with no captures untouched", () => {
    const events = [ev("checking_address", "A-07-15", "2026-08-16T01:00:00.000Z")];
    const { steps, captures } = partitionCaptures(events);
    expect(steps).toEqual(events);
    expect(captures).toEqual([]);
  });
});

describe("mergeTimeline", () => {
  it("puts each frame at the moment it was taken, not at the end", () => {
    const events = [
      ev("winback_tagging", null, "2026-08-16T01:00:00.000Z"),
      ev("selecting_device", null, "2026-08-16T01:00:10.000Z"),
    ];
    const captures = [
      { id: "c1", slot: "page1", key: key("page1"), at: "2026-08-16T01:00:05.000Z" },
      { id: "c2", slot: "pay", key: key("pay"), at: "2026-08-16T01:00:20.000Z" },
    ];
    expect(mergeTimeline(events, captures).map((r) => r.kind)).toEqual([
      "step", "shot", "step", "shot",
    ]);
  });

  it("puts the step first when a frame lands in the same second", () => {
    // A capture is always taken AFTER the step it documents.
    const at = "2026-08-16T01:00:00.000Z";
    const rows = mergeTimeline(
      [ev("winback_tagging", null, at)],
      [{ id: "c1", slot: "page1", key: key("page1"), at }],
    );
    expect(rows.map((r) => r.kind)).toEqual(["step", "shot"]);
  });
});

describe("retention countdown", () => {
  const at = "2026-08-16T00:00:00.000Z";
  const now = (days: number) => new Date(at).getTime() + days * 86_400_000;

  it("reads full retention the moment it is taken", () => {
    expect(daysUntilExpiry(at, 90, now(0))).toBe(90);
    expect(expiryLabel(90)).toBe("Expires in 90 days");
  });

  it("counts down", () => {
    expect(daysUntilExpiry(at, 90, now(3))).toBe(87);
    expect(expiryLabel(87)).toBe("Expires in 87 days");
  });

  it("goes amber under a fortnight", () => {
    const days = daysUntilExpiry(at, 90, now(77));
    expect(days).toBe(13);
    expect(days).toBeLessThan(CAPTURE_EXPIRY_WARN_DAYS);
  });

  it("reads Expired at the retention boundary, not a day late", () => {
    // At exactly 90 days the lifecycle rule has deleted the object, so the
    // thumbnail must be replaced rather than left to 404.
    expect(daysUntilExpiry(at, 90, now(90))).toBe(0);
    expect(expiryLabel(0)).toBe("Expired");
  });

  it("stays Expired past the boundary rather than going negative in the copy", () => {
    expect(daysUntilExpiry(at, 90, now(200))).toBe(-110);
    expect(expiryLabel(-110)).toBe("Expired");
  });

  it("falls back to full retention on an unparseable timestamp", () => {
    expect(daysUntilExpiry("not-a-date", 90, now(0))).toBe(90);
  });
});

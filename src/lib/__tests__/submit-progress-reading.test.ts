/**
 * The live submit checklist: which stages move the pointer, and what the panel
 * reads when a stage resolves to no step.
 *
 * Reported live (2026-08-26): a run sitting on "Creating customer profile"
 * flipped to "Step 1 of 17" with an empty bar and every tick reset, then jumped
 * forward again — repeatedly, and for the best part of a minute at a time.
 *
 * Nothing was restarting. The scraper reports captures and page breaks down the
 * same channel as milestones, `pollOrderProgress` copied whichever arrived last
 * into `Order.stage`, and the panel turned an unrecognised key into a position
 * with `Math.max(index, 0) + 1` — which is 1. Two independent defects, either
 * of which reproduces the symptom on its own, so both are pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  PAGE_BREAK_STAGE,
  LEGACY_PAGE1_CAPTURE_STAGE,
  SUBMIT_STEPS,
  movesStagePointer,
  progressReading,
} from "@/lib/order-types";

const TOTAL = SUBMIT_STEPS.length;

describe("movesStagePointer", () => {
  it("lets real milestones through", () => {
    for (const s of ["validating_draft", "creating_customer", "uploading_attachments",
                     "appointment", "pay", "submitted"]) {
      expect(movesStagePointer(s), s).toBe(true);
    }
  });

  it("blocks captures — the frame that caused the report", () => {
    // capture_customer_form is emitted DURING "Creating customer profile",
    // which is why the jump was seen at step 3 specifically.
    expect(movesStagePointer("capture_customer_form")).toBe(false);
    expect(movesStagePointer("capture_broadband")).toBe(false);
    // A slot added by a scraper newer than this build must block too — the
    // prefix is the rule, not a list of known slots.
    expect(movesStagePointer("capture_some_future_slot")).toBe(false);
    expect(movesStagePointer(LEGACY_PAGE1_CAPTURE_STAGE)).toBe(false);
  });

  it("blocks page breaks", () => {
    expect(movesStagePointer(PAGE_BREAK_STAGE)).toBe(false);
  });

  it("blocks nothing-at-all", () => {
    expect(movesStagePointer(null)).toBe(false);
    expect(movesStagePointer(undefined)).toBe(false);
    expect(movesStagePointer("")).toBe(false);
  });
});

describe("progressReading", () => {
  it("reads a real stage as its own step", () => {
    const r = progressReading("creating_customer", "submitting");
    expect(r.heading).toBe(`Step 3 of ${TOTAL}`);
    expect(r.current).toBe(2);
    expect(r.unknownStage).toBe(false);
  });

  it("an unknown stage NEVER reads as step 1", () => {
    // The regression, stated as the symptom: this is what the panel showed.
    const r = progressReading("capture_customer_form", "submitting",
                              ["validating_draft", "creating_customer"]);
    expect(r.heading).not.toBe(`Step 1 of ${TOTAL}`);
    expect(r.heading).toBe(`Step 3 of ${TOTAL}`);
  });

  it("an unknown stage does not empty the bar", () => {
    // `done` counts steps FULLY completed, so being on step 3 reads "2/17" —
    // the pairing the panel has always shown. What matters here is that it is
    // not 0, which is what the bar collapsed to.
    const r = progressReading("capture_customer_form", "submitting",
                              ["validating_draft", "creating_customer"]);
    expect(r.done).toBe(2);
    expect(r.pct).toBeGreaterThan(0);
  });

  it("holds at the furthest step observed, not the last one reported", () => {
    // Out-of-order and repeated keys must not drag the reading backwards —
    // furthest wins, the same rule finished attempts already followed.
    const r = progressReading(PAGE_BREAK_STAGE, "submitting",
                              ["creating_customer", "uploading_attachments",
                               "validating_draft"]);
    expect(r.heading).toBe(`Step 13 of ${TOTAL}`);
  });

  it("says it is working when nothing has been observed yet", () => {
    // No floor and an unrecognised stage: there is no honest step number, so it
    // must not invent one. This is the case a scraper deployed ahead of Vercel
    // produces (it happened once with `erf`).
    const r = progressReading("a_stage_from_a_newer_scraper", "submitting");
    expect(r.heading).toBe("Working…");
    expect(r.unknownStage).toBe(true);
    expect(r.current).toBe(-1);
  });

  it("a finished run still reports complete", () => {
    const r = progressReading("submitted", "submitted");
    expect(r.heading).toBe(`All ${TOTAL} steps complete`);
    expect(r.done).toBe(TOTAL);
    expect(r.pct).toBe(100);
  });

  it("a failure holds the step it stopped on", () => {
    const r = progressReading("selecting_device", "failed");
    expect(r.heading).toBe(`Step 12 of ${TOTAL}`);
    expect(r.unknownStage).toBe(false);
  });

  it("never runs past the end of the checklist", () => {
    const r = progressReading("submitted", "submitting",
                              SUBMIT_STEPS.map((s) => s.key));
    expect(r.done).toBeLessThanOrEqual(TOTAL);
    expect(r.pct).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from "vitest";
import {
  CAPTURE_EXPIRY_WARN_DAYS,
  CAPTURE_RETENTION_DAYS,
  captureExpiry,
} from "@/lib/order-types";

/**
 * The shared retention verdict.
 *
 * The timeline row and the carousel both decide whether to render an `<img>` or
 * a "this has been deleted" note. Two independent copies of that boundary is
 * exactly how one of them ends up showing a broken frame for an object R2 has
 * already removed — so both read this one function, and its edges are pinned.
 */

const DAY = 86_400_000;
const AT = "2026-01-01T00:00:00.000Z";
const t0 = new Date(AT).getTime();
/** `d` days after the capture was taken. */
const after = (d: number) => t0 + d * DAY;

describe("captureExpiry", () => {
  it("returns null while no retention policy is configured", () => {
    // The countdown is deliberately opt-in: it describes an R2 lifecycle rule
    // applied by hand, and rendering one before that rule exists would assert a
    // policy that does not. This is the state the app currently ships in.
    if (CAPTURE_RETENTION_DAYS === null) {
      expect(captureExpiry(AT, after(1))).toBeNull();
    }
  });

  // Everything below describes the behaviour once the rule IS live. Skipped
  // wholesale rather than faked, because CAPTURE_RETENTION_DAYS is read from
  // the environment at module load and cannot be reassigned per-test.
  const live = CAPTURE_RETENTION_DAYS !== null;
  const R = CAPTURE_RETENTION_DAYS ?? 90;

  it.skipIf(!live)("counts a fresh frame as having the full window", () => {
    const e = captureExpiry(AT, after(0))!;
    expect(e.days).toBe(R);
    expect(e.expired).toBe(false);
    expect(e.soon).toBe(false);
  });

  it.skipIf(!live)("is not yet 'soon' on the day the warning window opens", () => {
    const e = captureExpiry(AT, after(R - CAPTURE_EXPIRY_WARN_DAYS))!;
    expect(e.days).toBe(CAPTURE_EXPIRY_WARN_DAYS);
    expect(e.soon).toBe(false); // strictly less-than, so the boundary day is calm
  });

  it.skipIf(!live)("is 'soon' one day inside the warning window", () => {
    const e = captureExpiry(AT, after(R - CAPTURE_EXPIRY_WARN_DAYS + 1))!;
    expect(e.soon).toBe(true);
    expect(e.expired).toBe(false);
  });

  it.skipIf(!live)("expires exactly at the retention boundary, not after it", () => {
    // Zero days left means the object is gone from R2 — the caller must render
    // a note, because the <img> would 404 into a broken frame.
    const e = captureExpiry(AT, after(R))!;
    expect(e.days).toBe(0);
    expect(e.expired).toBe(true);
    expect(e.soon).toBe(false); // expired is not "soon" — it is already over
    expect(e.label).toBe("Expired");
  });

  it.skipIf(!live)("stays expired long past the boundary", () => {
    const e = captureExpiry(AT, after(R + 110))!;
    expect(e.expired).toBe(true);
    expect(e.label).toBe("Expired");
  });

  it.skipIf(!live)("treats an unparseable timestamp as a full window", () => {
    // Better to show a frame that may be gone than to declare a frame deleted
    // on the strength of a malformed date.
    const e = captureExpiry("not a date", after(0))!;
    expect(e.expired).toBe(false);
  });
});

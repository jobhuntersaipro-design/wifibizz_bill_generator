/**
 * The top-of-scroll test behind pull-to-refresh.
 *
 * Reported 2026-08-27: the gesture did nothing on a real iPhone, on the very
 * page it had been verified working on in a desktop Chromium at iPhone 13
 * dimensions, driven by real touch events. The difference is not the gesture —
 * it is the arm condition. A scroll container at rest reports an integer 0 in
 * Chromium, but on a device with a fractional device pixel ratio iOS parks it
 * on a sub-pixel value, and the original `scrollTop <= 0` is false at the top
 * of the list. It never armed, so nothing happened, every time.
 */
import { describe, it, expect } from "vitest";
import { isAtTop } from "@/components/ui/pull-to-refresh";

describe("isAtTop", () => {
  it("accepts a genuine top", () => {
    expect(isAtTop(0)).toBe(true);
  });

  it("accepts the sub-pixel offsets iOS parks a rested scroller on", () => {
    // The reported failure: each of these is "the top" to the user, and each
    // was refused before.
    for (const value of [0.25, 0.33, 0.5, 0.66, 1, 1.5, 2]) {
      expect(isAtTop(value)).toBe(true);
    }
  });

  it("accepts a negative offset — iOS reports one mid rubber-band", () => {
    expect(isAtTop(-8)).toBe(true);
  });

  it("still refuses a list that is actually scrolled", () => {
    // The slop must stay far below anything a finger could aim at, or a pull
    // inside a scrolled list would reload the page instead of scrolling it.
    expect(isAtTop(3)).toBe(false);
    expect(isAtTop(40)).toBe(false);
    expect(isAtTop(300)).toBe(false);
  });
});

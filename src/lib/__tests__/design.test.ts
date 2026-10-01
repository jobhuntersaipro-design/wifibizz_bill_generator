import { describe, expect, it } from "vitest";
import { DESIGN_INIT_SCRIPT, isArcAccent, isDesign } from "../design";

/** Runs the pre-paint script against a fake <html> and storage, the way the browser would. */
function runInit(stored: Record<string, string>, opts: { storageThrows?: boolean } = {}) {
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
  const localStorage = {
    getItem: (k: string) => {
      if (opts.storageThrows) throw new Error("blocked");
      return stored[k] ?? null;
    },
  };
  new Function("document", "localStorage", DESIGN_INIT_SCRIPT)(document, localStorage);
  return attrs;
}

describe("design preference", () => {
  it("leaves the classic design alone when nothing is stored", () => {
    expect(runInit({})).toEqual({});
  });

  it("applies Arc with the stored accent", () => {
    expect(runInit({ "bf-design": "arc", "bf-arc-accent": "violet" })).toEqual({ "data-design": "arc", "data-accent": "violet" });
  });

  it("falls back to the neutral accent for an unknown or illegible one", () => {
    expect(runInit({ "bf-design": "arc", "bf-arc-accent": "amber" })).toEqual({ "data-design": "arc", "data-accent": "neutral" });
  });

  it("ignores a stored value that is not a design", () => {
    expect(runInit({ "bf-design": "neon" })).toEqual({});
  });

  it("never throws when storage is blocked", () => {
    expect(runInit({}, { storageThrows: true })).toEqual({});
  });

  it("validates designs and accents", () => {
    expect(isDesign("arc")).toBe(true);
    expect(isDesign("Arc")).toBe(false);
    expect(isArcAccent("blue")).toBe(true);
    expect(isArcAccent("rose")).toBe(false);
  });
});

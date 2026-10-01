import { describe, expect, it } from "vitest";
import { DESIGN_INIT_SCRIPT, isArcAccent, isDesign } from "../design";

/** Runs the pre-paint script against a fake <html> and storage, the way the browser would. */
function runInit(stored: Record<string, string>, opts: { storageThrows?: boolean } = {}) {
  // The server renders <html data-design="arc" data-accent="neutral">.
  const attrs: Record<string, string> = { "data-design": "arc", "data-accent": "neutral" };
  const document = {
    documentElement: {
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      removeAttribute: (k: string) => { delete attrs[k]; },
    },
  };
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
  it("keeps Arc, the default, when nothing is stored", () => {
    expect(runInit({})).toEqual({ "data-design": "arc", "data-accent": "neutral" });
  });

  it("removes Arc for a viewer who chose Classic", () => {
    expect(runInit({ "bf-design": "classic", "bf-arc-accent": "violet" })).toEqual({});
  });

  it("applies Arc with the stored accent", () => {
    expect(runInit({ "bf-design": "arc", "bf-arc-accent": "violet" })).toEqual({ "data-design": "arc", "data-accent": "violet" });
  });

  it("falls back to the neutral accent for an unknown or illegible one", () => {
    expect(runInit({ "bf-design": "arc", "bf-arc-accent": "amber" })).toEqual({ "data-design": "arc", "data-accent": "neutral" });
  });

  it("treats a stored value that is not a design as the default", () => {
    expect(runInit({ "bf-design": "neon" })).toEqual({ "data-design": "arc", "data-accent": "neutral" });
  });

  it("never throws when storage is blocked, and leaves the server's Arc in place", () => {
    expect(runInit({}, { storageThrows: true })).toEqual({ "data-design": "arc", "data-accent": "neutral" });
  });

  it("validates designs and accents", () => {
    expect(isDesign("arc")).toBe(true);
    expect(isDesign("Arc")).toBe(false);
    expect(isArcAccent("blue")).toBe(true);
    expect(isArcAccent("rose")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { classifyPortalMessage, PORTAL_ERROR_RULES, resolveErrorCode } from "@/lib/portal-error-rules";
import { retryVerdict } from "@/lib/retry-policy";

// Live 2026-09-28, ORD-0275: filed as `portal_error` and auto-retried three times.
const LIVE = "This address already has TM services installed, please try a different address.";

/** `_RULES` from scraper/oe_errors.py, resolved to code strings. */
function pythonRules(): [string, string][] {
  const src = readFileSync(path.join(process.cwd(), "scraper/oe_errors.py"), "utf8");
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/^([A-Z_]+) = "([a-z_]+)"$/gm)) consts.set(m[1], m[2]);
  const body = src.slice(src.indexOf("_RULES"), src.indexOf("def map_error"));
  return [...body.matchAll(/\(\s*"([^"]+)",\s*([A-Z_]+)\s*\)/g)].map(
    (m) => [m[1], consts.get(m[2]) ?? `?${m[2]}`] as [string, string],
  );
}

describe("portal error rules", () => {
  it("mirror the scraper's table exactly, in the same order", () => {
    const py = pythonRules();
    expect(py.length).toBeGreaterThan(20);
    expect(PORTAL_ERROR_RULES.map(([n, c]) => [n, c])).toEqual(py);
  });

  it("classify the live ORD-0275 sentence", () => {
    expect(classifyPortalMessage(LIVE)).toBe("address_already_has_service");
  });

  it("reclassify a generic code from the message", () => {
    expect(resolveErrorCode("portal_error", LIVE)).toBe("address_already_has_service");
    expect(resolveErrorCode("unknown_error", LIVE)).toBe("address_already_has_service");
    expect(resolveErrorCode(undefined, LIVE)).toBe("address_already_has_service");
  });

  it("leave a specific code alone, even when the message says something else", () => {
    expect(resolveErrorCode("voice_no_numbers", LIVE)).toBe("voice_no_numbers");
  });

  it("keep a generic code when the message names nothing", () => {
    expect(resolveErrorCode("portal_error", "Something new.")).toBe("portal_error");
    expect(resolveErrorCode("portal_error", null)).toBe("portal_error");
  });

  it("make the reclassified failure terminal, so it is not auto-retried", () => {
    expect(retryVerdict({ status: "failed", errorCode: "portal_error", errorMessage: null, autoRetries: 0, attempt: 1 }).retry).toBe(true);
    expect(retryVerdict({ status: "failed", errorCode: resolveErrorCode("portal_error", LIVE) ?? null, errorMessage: null, autoRetries: 0, attempt: 1 }).retry).toBe(false);
  });
});

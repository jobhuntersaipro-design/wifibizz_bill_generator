import { describe, expect, it } from "vitest";
import {
  LIVE_VIEW_TOKEN_TTL_MS,
  mintLiveViewToken,
  verifyLiveViewToken,
} from "@/lib/live-view-token";

/**
 * The same rule lives in scraper/live_view.py. The vector below is asserted
 * on BOTH sides, so a drift shows up as a failing test, not as a 401 that an
 * admin meets on a live run.
 */
const SECRET = "test-token";
const VECTOR = "job123.1900000000.d8641c3f0304468c252c6e01993ba5060b8659a626391acbb7b40f6020e2845b";

describe("live view token", () => {
  it("mints the shared vector", () => {
    const { token, expiresAt } = mintLiveViewToken("job123", SECRET, 1900000000 * 1000 - LIVE_VIEW_TOKEN_TTL_MS);
    expect(token).toBe(VECTOR);
    expect(expiresAt).toBe(1900000000 * 1000);
  });

  it("verifies its own tokens and the vector", () => {
    expect(verifyLiveViewToken(VECTOR, "job123", SECRET, 1899999000 * 1000)).toBe(true);
    const { token } = mintLiveViewToken("jobX", SECRET);
    expect(verifyLiveViewToken(token, "jobX", SECRET)).toBe(true);
  });

  it("refuses expired, wrong-job, tampered and malformed tokens", () => {
    expect(verifyLiveViewToken(VECTOR, "job123", SECRET, 1900000001 * 1000)).toBe(false);
    expect(verifyLiveViewToken(VECTOR, "job999", SECRET, 1899999000 * 1000)).toBe(false);
    expect(verifyLiveViewToken(VECTOR.slice(0, -1) + "0", "job123", SECRET, 1899999000 * 1000)).toBe(false);
    expect(verifyLiveViewToken("job123.abc.def", "job123", SECRET)).toBe(false);
    expect(verifyLiveViewToken("", "job123", SECRET)).toBe(false);
    expect(verifyLiveViewToken(VECTOR, "job123", "", 1899999000 * 1000)).toBe(false);
  });
});

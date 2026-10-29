import { describe, expect, it } from "vitest";
import { parseWebhook } from "@/lib/whatsapp-store";
import { avatarTone, historyLoading, HISTORY_STALE_MS } from "@/lib/whatsapp-inbox";

const body = (history: unknown[]) => ({ entry: [{ id: "w", changes: [{ field: "history", value: { history } }] }] });

describe("history import progress", () => {
  it("reads Meta's chunk progress, highest wins", () => {
    expect(parseWebhook(body([{ metadata: { phase: 0, chunk_order: 1, progress: 40 }, threads: [] }, { metadata: { progress: 55 } }])).historyProgress).toBe(55);
  });
  it("a declined share counts as done", () => {
    expect(parseWebhook(body([{ errors: [{ code: 2593109 }] }])).historyProgress).toBe(100);
  });
  it("a body with no history carries none", () => {
    expect(parseWebhook(body([])).historyProgress).toBeNull();
  });
  it("loading only while under 100 and recent", () => {
    const now = Date.parse("2026-10-29T10:00:00Z");
    const at = new Date(now - 60_000).toISOString();
    expect(historyLoading({ progress: 60, at }, now)).toBe(true);
    expect(historyLoading({ progress: 100, at }, now)).toBe(false);
    expect(historyLoading({ progress: 60, at: new Date(now - HISTORY_STALE_MS - 1).toISOString() }, now)).toBe(false);
    expect(historyLoading(null, now)).toBe(false);
  });
  it("avatar tone is stable and in range", () => {
    expect(avatarTone("60123209859")).toBe(avatarTone("60123209859"));
    expect(avatarTone("60123209859")).toBeGreaterThanOrEqual(0);
    expect(avatarTone("60123209859")).toBeLessThan(6);
  });
});

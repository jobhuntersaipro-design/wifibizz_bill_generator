import { afterEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible } from "@/lib/poll";

const listeners = new Set<() => void>();
const doc = {
  hidden: false,
  addEventListener: (_: string, f: () => void) => listeners.add(f),
  removeEventListener: (_: string, f: () => void) => listeners.delete(f),
};
vi.stubGlobal("document", doc);

afterEach(() => {
  vi.useRealTimers();
  listeners.clear();
  doc.hidden = false;
});

describe("pollWhileVisible", () => {
  it("polls while visible, skips while hidden, refreshes once on return", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);

    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);

    doc.hidden = true;
    listeners.forEach((f) => f());
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(2); // a hidden tab never queries

    doc.hidden = false;
    listeners.forEach((f) => f());
    expect(fn).toHaveBeenCalledTimes(3); // fresh data the moment it is seen

    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(listeners.size).toBe(0);
  });
});

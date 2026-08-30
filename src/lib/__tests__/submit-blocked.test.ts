/**
 * Why a submit button is unavailable, and the words shown on hover.
 *
 * The droplet drives ONE browser: api_server.py rejects any job while another
 * is queued or running, with "The server can only run one browser job at a
 * time." The lock is GLOBAL — another agent's submit, or one started in a
 * different tab, rejects yours exactly as your own does — so this is decided on
 * the server's busy state, not on what the page happens to have started.
 */
import { describe, it, expect } from "vitest";
import { submitBlockedReason } from "@/lib/order-types";

describe("submitBlockedReason", () => {
  it("allows a submit when nothing is running", () => {
    expect(submitBlockedReason({})).toBeNull();
    expect(
      submitBlockedReason({ rowBusy: false, batchRunning: false, serverBusy: false }),
    ).toBeNull();
  });

  it("blocks on a job started by someone else entirely", () => {
    // The case the whole feature exists for: nothing on THIS page is running.
    const reason = submitBlockedReason({ serverBusy: true });
    expect(reason).toBe(
      "A task is already running on the server. Please wait until it finishes.",
    );
  });

  it("names the batch when a batch is what is running", () => {
    expect(submitBlockedReason({ batchRunning: true })).toMatch(/batch/i);
  });

  it("says nothing extra for the row that is itself busy", () => {
    // That button already reads "Submitting…" — a tooltip repeating it is noise,
    // and the row's own state must win over the server's.
    expect(submitBlockedReason({ rowBusy: true, serverBusy: true })).toBe(
      "This order is being worked on.",
    );
  });

  it("says how long the server has been busy", () => {
    // "Please wait" with no horizon is what left agents staring at a greyed-out
    // button for six hours on 2026-08-29.
    expect(
      submitBlockedReason({ serverBusy: true, serverBusyAgeS: 245, serverMaxRuntimeS: 1800 }),
    ).toBe("A task has been running on the server for 4m 5s. Please wait until it finishes.");
  });

  it("calls a job past the server's own cap stuck, not something to wait for", () => {
    const reason = submitBlockedReason({
      serverBusy: true,
      serverBusyAgeS: 6 * 3600,
      serverMaxRuntimeS: 1800,
    });
    expect(reason).toMatch(/stuck/i);
    expect(reason).toMatch(/clear itself/i);
    // Must NOT tell them to keep waiting — the whole point is that this one
    // will not finish on its own schedule.
    expect(reason).not.toMatch(/wait until it finishes/i);
  });

  it("keeps the original sentence when the droplet reports no age", () => {
    // A build from before /health carried an age. Falling back beats printing
    // "for 0s", which would read as a run that just started.
    expect(submitBlockedReason({ serverBusy: true, serverBusyAgeS: null })).toBe(
      "A task is already running on the server. Please wait until it finishes.",
    );
    expect(submitBlockedReason({ serverBusy: true, serverBusyAgeS: -1 })).toBe(
      "A task is already running on the server. Please wait until it finishes.",
    );
  });

  it("does not call a job stuck without a cap to judge it against", () => {
    // No max_job_runtime_s means we cannot know what is too long. Reporting the
    // elapsed time is honest; calling it stuck would be a guess.
    const reason = submitBlockedReason({ serverBusy: true, serverBusyAgeS: 6 * 3600 });
    expect(reason).toMatch(/6h 0m/);
    expect(reason).not.toMatch(/stuck/i);
  });

  it("names the running order rather than asserting who started it", () => {
    // On a shared BizzFlow login "you already have a submit running" is false
    // for whoever pressed nothing. Naming the order is true either way.
    const reason = submitBlockedReason({
      serverBusy: true,
      serverBusyIsMine: true,
      serverBusyOrderLabel: "ORD-0042 (MUHAMMAD SAHINU)",
      serverBusyAgeS: 260,
      serverMaxRuntimeS: 1800,
    });
    expect(reason).toBe(
      "A submit is already running on this account — ORD-0042 (MUHAMMAD SAHINU), started 4m 20s ago.",
    );
    expect(reason).not.toMatch(/\byou\b/i);
  });

  it("still says something useful when the order cannot be named", () => {
    expect(
      submitBlockedReason({
        serverBusy: true, serverBusyIsMine: true, serverBusyOrderLabel: null,
        serverBusyAgeS: 60, serverMaxRuntimeS: 1800,
      }),
    ).toBe("A submit is already running on this account, started 1m 0s ago.");
  });

  it("separates capacity from your own run", () => {
    // Different facts: one clears when YOUR run ends, the other when a queue
    // drains. Collapsing them puts the old vague message back.
    const reason = submitBlockedReason({
      serverBusy: true, serverBusyIsMine: false,
      serverSlots: 3, serverCapacity: 4, serverBusyAgeS: 120, serverMaxRuntimeS: 1800,
    });
    expect(reason).toBe("All 4 submit slots are busy (3 of 4) — your turn shortly.");
  });

  it("does not talk about slots at capacity 1", () => {
    // "1 of 1 slots" says less than naming the wait does.
    const reason = submitBlockedReason({
      serverBusy: true, serverBusyIsMine: false,
      serverSlots: 1, serverCapacity: 1, serverBusyAgeS: 120, serverMaxRuntimeS: 1800,
    });
    expect(reason).toMatch(/running on the server for 2m 0s/);
    expect(reason).not.toMatch(/slot/i);
  });

  it("calls your own stuck run stuck rather than describing it as in progress", () => {
    // Past the cap it is not a run to wait for, whoever owns it.
    const reason = submitBlockedReason({
      serverBusy: true, serverBusyIsMine: true,
      serverBusyOrderLabel: "ORD-0042 (NAME)",
      serverBusyAgeS: 6 * 3600, serverMaxRuntimeS: 1800,
    });
    expect(reason).toMatch(/stuck/i);
  });

  it("gives a reason whenever it blocks", () => {
    // A greyed-out button with no explanation is worse than one that errors, so
    // every blocking combination must produce text.
    for (const state of [
      { rowBusy: true },
      { batchRunning: true },
      { serverBusy: true },
      { serverBusy: true, serverBusyAgeS: 30, serverMaxRuntimeS: 1800 },
      { serverBusy: true, serverBusyAgeS: 99999, serverMaxRuntimeS: 1800 },
      { serverBusy: true, serverBusyIsMine: true, serverBusyAgeS: 30, serverMaxRuntimeS: 1800 },
      { serverBusy: true, serverSlots: 4, serverCapacity: 4, serverBusyAgeS: 30, serverMaxRuntimeS: 1800 },
      { rowBusy: true, batchRunning: true, serverBusy: true },
    ]) {
      expect(submitBlockedReason(state)).toBeTruthy();
    }
  });
});

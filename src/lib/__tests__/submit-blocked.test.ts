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

  it("gives a reason whenever it blocks", () => {
    // A greyed-out button with no explanation is worse than one that errors, so
    // every blocking combination must produce text.
    for (const state of [
      { rowBusy: true },
      { batchRunning: true },
      { serverBusy: true },
      { rowBusy: true, batchRunning: true, serverBusy: true },
    ]) {
      expect(submitBlockedReason(state)).toBeTruthy();
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  MAX_AUTO_RETRIES,
  MAX_TOTAL_ATTEMPTS,
  TERMINAL_ERROR_CODES,
  retryVerdict,
  triesSuffix,
  type RetryInput,
} from "@/lib/retry-policy";

/** A failed run with nothing else wrong — the network-blip shape. */
const failed = (over: Partial<RetryInput> = {}): RetryInput => ({
  status: "failed",
  errorCode: null,
  errorMessage: "Timeout 30000ms exceeded.",
  autoRetries: 0,
  attempt: 1,
  ...over,
});

describe("retryVerdict — what retries", () => {
  it("retries a failure with no code, which is the case the feature exists for", () => {
    // Every network blip arrives here: a job-level error, a lost job and any
    // unmapped portal complaint all reach the app with errorCode null.
    expect(retryVerdict(failed()).retry).toBe(true);
  });

  it("retries an error code we have never seen", () => {
    // Pins the deny-list decision. An allow-list would refuse this, and most
    // real codes are not in the 8 that have copy.
    expect(retryVerdict(failed({ errorCode: "some_new_portal_code" })).retry).toBe(true);
  });

  it("retries a warning, which is how a post-mint failure is stored", () => {
    // The reported order (2608000122816567) landed as a warning, not a failure —
    // failed-only would never have covered it.
    expect(
      retryVerdict(
        failed({
          status: "warning",
          errorMessage:
            "Order 2608000122816567 was created but the flow didn't finish: nonext.",
        }),
      ).retry,
    ).toBe(true);
  });

  it("retries the codes whose own advice is to run it again", () => {
    for (const code of ["appointment_slot_taken", "voice_number_taken", "pay_page_not_ready"]) {
      expect(retryVerdict(failed({ errorCode: code })).retry, code).toBe(true);
    }
  });
});

describe("retryVerdict — what stops", () => {
  it("refuses every terminal code", () => {
    for (const code of TERMINAL_ERROR_CODES) {
      const v = retryVerdict(failed({ errorCode: code }));
      expect(v.retry, code).toBe(false);
      expect(v.reason, code).toContain(code);
    }
  });

  it("refuses erf_not_downloaded even though the run may look finished", () => {
    // The landmine: with ORDER_ENTRY_DO_PAY unset, EVERY successful run lands
    // here as a warning. Retrying it would mint duplicates for orders that
    // actually went through.
    const v = retryVerdict(
      failed({ status: "warning", errorCode: "erf_not_downloaded", errorMessage: "no e-RF" }),
    );
    expect(v.retry).toBe(false);
  });

  it("refuses an expired dealer session, which carries no code", () => {
    const v = retryVerdict(
      failed({
        errorCode: null,
        errorMessage:
          "Your dealer session has expired. Reconnect on the Order Entry page, then submit again.",
      }),
    );
    expect(v.retry).toBe(false);
  });

  it("refuses a misconfigured service", () => {
    expect(
      retryVerdict(failed({ errorMessage: "Order service is not configured." })).retry,
    ).toBe(false);
  });

  it("refuses anything that is not a finished failure", () => {
    for (const status of ["submitted", "submitting", "draft", "cancelled", "order_entered"]) {
      expect(retryVerdict(failed({ status })).retry, status).toBe(false);
    }
  });
});

describe("retryVerdict — the budget", () => {
  it("allows every retry up to the cap and refuses the one after", () => {
    for (let spent = 0; spent < MAX_AUTO_RETRIES; spent++) {
      expect(retryVerdict(failed({ autoRetries: spent })).retry, `spent ${spent}`).toBe(true);
    }
    const spent = retryVerdict(failed({ autoRetries: MAX_AUTO_RETRIES }));
    expect(spent.retry).toBe(false);
    expect(spent.reason).toContain("automatic retries");
  });

  it("reports the budget before the error code, so a spent order says why", () => {
    // Ordering is the contract: an order that ran out of tries must not report
    // whichever code the last attempt happened to carry.
    const v = retryVerdict(failed({ autoRetries: MAX_AUTO_RETRIES, errorCode: "anything" }));
    expect(v.reason).toContain("automatic retries");
  });

  it("stops at the total-attempt backstop even with budget left", () => {
    const v = retryVerdict(failed({ autoRetries: 0, attempt: MAX_TOTAL_ATTEMPTS }));
    expect(v.retry).toBe(false);
    expect(v.reason).toContain(String(MAX_TOTAL_ATTEMPTS));
  });
});

describe("triesSuffix", () => {
  it("says nothing for a first attempt", () => {
    expect(triesSuffix({ status: "failed", attempt: 0 })).toBe("");
    expect(triesSuffix({ status: "failed", attempt: 1 })).toBe("");
  });

  it("appends the count once a failure has been run more than once", () => {
    expect(triesSuffix({ status: "failed", attempt: 2 })).toBe(" · 2 tries");
    expect(triesSuffix({ status: "warning", attempt: 3 })).toBe(" · 3 tries");
  });

  it("says nothing on an order that succeeded, however many tries it took", () => {
    // "Submitted · 3 tries" sends a reader looking for a problem in an order
    // that is finished. The trail of what happened lives in its history.
    expect(triesSuffix({ status: "submitted", attempt: 3 })).toBe("");
    expect(triesSuffix({ status: "cancelled", attempt: 4 })).toBe("");
  });

  it("says nothing while a run is still going, since the count is still moving", () => {
    expect(triesSuffix({ status: "submitting", attempt: 3 })).toBe("");
  });
});

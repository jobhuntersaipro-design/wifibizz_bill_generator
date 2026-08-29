import { describe, it, expect } from "vitest";
import {
  MAX_AUTO_RETRIES,
  MAX_TOTAL_ATTEMPTS,
  TERMINAL_ERROR_CODES,
  isRetryPending,
  retryPendingAt,
  retryPillLabel,
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

  it("refuses appointment_not_booked, which the run already retried three times", () => {
    // The scraper rebooks up to 3 times before reporting this, and its copy
    // tells the agent to add the appointment by hand. A whole resubmit on top
    // would mint a duplicate order and hit the same wall.
    expect(
      retryVerdict(failed({ status: "warning", errorCode: "appointment_not_booked" })).retry,
    ).toBe(false);
  });

  it("still retries appointment_slot_taken, which is genuine contention", () => {
    // The two must not be conflated: a slot another dealer took is worth
    // trying again for; a booking that never landed is not.
    expect(retryVerdict(failed({ errorCode: "appointment_slot_taken" })).retry).toBe(true);
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

/* ── The retry-pending window ───────────────────────────────────────────────
 *
 * `applyResult` writes `failed`/`warning` a beat before `maybeAutoRetry` flips
 * the order back to `submitting`. In that window the row used to read Failed
 * with a live Submit button — which is an invitation to start a SECOND run
 * against an order that is already going to be run again. These pin the rule
 * that closes it.
 */
describe("isRetryPending / retryPillLabel", () => {
  const owed = {
    status: "failed",
    autoRetries: 1,
    autoRetryAt: new Date("2026-08-30T10:00:00Z"),
  };

  it("reads a failure with a claim on it as still in flight", () => {
    expect(isRetryPending(owed)).toBe(true);
    // The try being ANNOUNCED is the next one: the counter only moves when
    // maybeAutoRetry actually claims it.
    expect(retryPillLabel(owed)).toBe("Retrying · 2 of 3");
  });

  it("covers a stranded order too, not only a clean failure", () => {
    expect(isRetryPending({ ...owed, status: "warning" })).toBe(true);
  });

  it("is false with no claim — a plain finished failure", () => {
    expect(isRetryPending({ ...owed, autoRetryAt: null })).toBe(false);
    expect(retryPillLabel({ ...owed, autoRetryAt: null })).toBeNull();
  });

  it("re-checks the budget rather than trusting the timestamp", () => {
    // A claim left behind by a bug must read as finished, not as a row that
    // says "Retrying" forever for a run nothing is coming back for.
    expect(isRetryPending({ ...owed, autoRetries: MAX_AUTO_RETRIES })).toBe(false);
  });

  it("never claims a running or a submitted order is retrying", () => {
    expect(isRetryPending({ ...owed, status: "submitting" })).toBe(false);
    expect(isRetryPending({ ...owed, status: "submitted" })).toBe(false);
  });

  it("accepts an ISO string, which is what the row carries", () => {
    // OrderListItem serialises the date for the client; the pill reads the
    // same rule as the server.
    expect(isRetryPending({ ...owed, autoRetryAt: "2026-08-30T10:00:00.000Z" })).toBe(true);
  });

  it("hands the count to the pill instead of doubling it", () => {
    // "Retrying · 2 of 3 · 2 tries" says the same thing twice, in two
    // vocabularies.
    expect(triesSuffix({ ...owed, attempt: 2 })).toBe("");
    expect(triesSuffix({ ...owed, attempt: 2, autoRetryAt: null })).toBe(" · 2 tries");
  });
});

describe("retryPendingAt", () => {
  const NOW = new Date("2026-08-30T10:00:00Z");

  it("stamps a retryable failure, so the row is marked in the same write", () => {
    expect(
      retryPendingAt(
        { status: "failed", errorCode: null, errorMessage: "Timeout", autoRetries: 0, attempt: 1 },
        NOW,
      ),
    ).toEqual(NOW);
  });

  it("clears the claim on a success", () => {
    expect(
      retryPendingAt(
        { status: "submitted", errorCode: null, errorMessage: null, autoRetries: 0, attempt: 2 },
        NOW,
      ),
    ).toBeNull();
  });

  it("leaves a stopped run alone — a stop is not something to undo", () => {
    expect(
      retryPendingAt(
        {
          status: "failed",
          errorCode: "submit_stopped",
          errorMessage: "Stopped by the agent",
          autoRetries: 0,
          attempt: 1,
        },
        NOW,
      ),
    ).toBeNull();
  });
});

/**
 * Whether a finished submit is worth running again, and how many times.
 *
 * Pure — no Prisma, no `next/*` — so the one decision that can create duplicate
 * real orders at Unifi is testable directly, without a database or a portal.
 *
 * The motivating failure was a network blip: a run that died on a timeout with
 * nothing wrong with the order. Those cost an agent a manual Resubmit they had
 * to notice first, which is what this removes.
 */

/** Automatic retries allowed per manual submit. A human pressing Submit is a
 *  new decision and hands back a fresh budget. */
export const MAX_AUTO_RETRIES = 3;

/**
 * A hard stop independent of the budget.
 *
 * If a bug ever re-armed the counter, nothing else here would notice: the
 * budget check would pass every time and one draft could drive the portal
 * forever. This is the backstop that makes that finite.
 */
export const MAX_TOTAL_ATTEMPTS = 20;

/**
 * Failures a retry cannot fix — the order needs a person.
 *
 * A DENY-list, not an allow-list, and that is the load-bearing decision here.
 * Only 8 of the scraper's ~55 error codes have copy in `SUBMIT_ERROR_CODES`,
 * and `applyResult` keeps a code ONLY when copy exists for it — so a plain
 * network timeout, an `InfraError`, a lost job and every unmapped portal
 * complaint all arrive with `errorCode: null`. An allow-list would therefore
 * refuse to retry precisely the case this feature was built for.
 *
 * The terminal set can be written down (it is what `scraper/oe_errors.py`
 * classifies, plus two BizzFlow-raised codes); the transient set cannot.
 */
export const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
  // The address is the problem, and it is the same address next time.
  "address_no_tm_service",
  "address_already_has_service",
  "address_not_found",
  // Needs a different device chosen by a human.
  "device_out_of_stock",
  // The portal disagrees with the customer's own details.
  "customer_ic_name_mismatch",
  // Unifi has blacklisted this customer. The same IC gets the same answer on
  // every try, and the refusal lands before the order number is minted, so a
  // retry costs a whole run to be told the same thing.
  "blacklisted_ic",
  // Account/approval limits — a human process, not a flaky one.
  "msr_customer_id_limit",
  "msr_offline_approval",
  // Login id needs editing, and the scraper already re-rolled it 3 times.
  "login_id_invalid",
  "login_id_taken",
  // The voice number pool is dry; running again finds it dry.
  "vobb_unavailable",
  // The order reached Pay with no appointment, AFTER the run already tried
  // three times to book one. Its own advice is to add the appointment in the
  // portal by hand — a whole resubmit would mint a duplicate order and then
  // most likely fail the same way.
  "appointment_not_booked",
  // Money may already have moved. Retrying could charge a customer twice, and
  // the app's own copy for these says to confirm in the portal FIRST.
  "pay_click_did_not_take",
  "post_pay_not_confirmed",
  // The run may have COMPLETED — `applyResult` files a submit with no e-RF as a
  // warning, and its comment notes that with ORDER_ENTRY_DO_PAY unset that is
  // EVERY successful run. Retrying this would mint a duplicate for orders that
  // actually went through, which is the worst outcome this feature could have.
  "erf_not_downloaded",
  // A person stopped this run on purpose. Retrying it automatically would undo
  // the one thing they asked for.
  "submit_stopped",
]);

/** Statuses that represent a finished, unsuccessful run. Nothing else retries —
 *  notably `submitted` (done) and `submitting` (still going). */
const RETRYABLE_STATUSES: ReadonlySet<string> = new Set(["failed", "warning"]);

/**
 * Message fragments that mean "a person has to do something first", on failures
 * that carry no code at all. Matched case-insensitively on the message.
 */
const TERMINAL_MESSAGE_FRAGMENTS: readonly string[] = [
  // The dealer session expired — reconnecting is a human step, and three
  // retries would fail identically while burning the budget.
  "dealer session has expired",
  // Misconfiguration. Retrying a missing env var does not supply it.
  "is not configured",
];

export interface RetryInput {
  /** Order status after `applyResult` finished the run. */
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  /** Automatic retries already spent since the last manual submit. */
  autoRetries: number;
  /** Total submit runs this draft has had, manual ones included. */
  attempt: number;
}

export interface RetryVerdict {
  retry: boolean;
  /** Why — written into the order's history so a run that did NOT retry says so. */
  reason: string;
}

/**
 * Decide whether to run this order again.
 *
 * Rules are ordered and first-match-wins; the order is part of the contract, so
 * a spent budget reports "budget" rather than whichever code it happened to
 * carry.
 */
export function retryVerdict(input: RetryInput): RetryVerdict {
  if (!RETRYABLE_STATUSES.has(input.status)) {
    return { retry: false, reason: `status is ${input.status}, not a failure` };
  }
  if (input.autoRetries >= MAX_AUTO_RETRIES) {
    return { retry: false, reason: `all ${MAX_AUTO_RETRIES} automatic retries have been used` };
  }
  if (input.attempt >= MAX_TOTAL_ATTEMPTS) {
    return { retry: false, reason: `this draft has already been run ${input.attempt} times` };
  }

  const message = (input.errorMessage ?? "").toLowerCase();
  const stopper = TERMINAL_MESSAGE_FRAGMENTS.find((f) => message.includes(f));
  if (stopper) {
    return { retry: false, reason: "it needs someone to fix the setup first" };
  }

  if (input.errorCode && TERMINAL_ERROR_CODES.has(input.errorCode)) {
    return { retry: false, reason: `${input.errorCode} will not fix itself` };
  }

  // Unrecognised, or a known-transient code. Retry: see TERMINAL_ERROR_CODES.
  return {
    retry: true,
    reason: input.errorCode ? `${input.errorCode} may be temporary` : "the failure looks temporary",
  };
}

/**
 * The try count for the Orders table's status pill.
 *
 * It belongs ON the pill rather than in a column of its own: the table already
 * scrolls horizontally at 1280px, and the number only means anything next to
 * the outcome it describes.
 *
 * Shown only on an unsuccessful, finished run. "Submitted · 3 tries" invites a
 * reader to go looking for a problem in an order that is done, and a count on
 * `submitting` is still moving as they read it. Total attempts rather than the
 * auto-retry counter: "3 tries" to an agent means the order was run three
 * times, whoever started each run.
 */
export function triesSuffix(o: {
  status: string;
  attempt: number;
  autoRetries?: number;
  autoRetryAt?: Date | string | null;
}): string {
  if (o.status !== "failed" && o.status !== "warning") return "";
  // A row that is about to run again is not reporting a finished outcome, and
  // its pill already carries a count — "Retrying · 2 of 3 · 2 tries" says the
  // same thing twice in two different vocabularies.
  if (isRetryPending(o)) return "";
  if (o.attempt <= 1) return "";
  return ` · ${o.attempt} tries`;
}

/**
 * Is a retry OWED on this order right now?
 *
 * `autoRetryAt` is the claim: `applyResult` stamps it the moment a failure is
 * judged retryable, and `maybeAutoRetry` clears it when it takes the try (or
 * when it decides not to). So a row carrying it is one where the next thing to
 * happen is another run — whether that run starts in a second (the webhook) or
 * in a couple of minutes (the droplet was busy, and the sweeper will come back).
 *
 * This is what stops the window between "the run failed" and "the retry
 * started" from rendering as Failed with a live Submit button, which is an
 * invitation to start a SECOND run against an order that is already going to be
 * run again.
 *
 * The budget is re-checked here rather than trusted: a spent order whose
 * timestamp was never cleared must read as finished, not as forever-retrying.
 */
export function isRetryPending(o: {
  status: string;
  autoRetries?: number;
  autoRetryAt?: Date | string | null;
}): boolean {
  if (o.status !== "failed" && o.status !== "warning") return false;
  if (!o.autoRetryAt) return false;
  return (o.autoRetries ?? 0) < MAX_AUTO_RETRIES;
}

/**
 * The pill's text while a retry is owed — "Retrying · 2 of 3" — or null.
 *
 * The try being ANNOUNCED is the next one, `autoRetries + 1`: the counter is
 * only incremented when `maybeAutoRetry` actually claims the try, so at the
 * moment this is read it still holds the number of retries already spent.
 */
export function retryPillLabel(o: {
  status: string;
  autoRetries?: number;
  autoRetryAt?: Date | string | null;
}): string | null {
  if (!isRetryPending(o)) return null;
  return `Retrying · ${(o.autoRetries ?? 0) + 1} of ${MAX_AUTO_RETRIES}`;
}

/**
 * When a finished run is judged retryable, the timestamp that says so — else
 * null, which CLEARS any claim left by an earlier attempt.
 *
 * Returned rather than written so the caller folds it into the same update that
 * writes the outcome: a separate write would leave a window in which the row is
 * finished but not yet marked as retrying, which is the exact window this
 * whole thing exists to remove.
 *
 * "Now" rather than a delay because retries are immediate by design. It also
 * makes the row visible to `sweepPendingRetries`, so a retry still happens when
 * the webhook never arrives.
 */
export function retryPendingAt(input: RetryInput, now: Date = new Date()): Date | null {
  return retryVerdict(input).retry ? now : null;
}

import { STATUS_LABELS } from "@/lib/order-types";

/**
 * What an email says happened to one order, and how a batch adds up.
 *
 * Pure — no Prisma, no Resend — because these are the rules a reader will act
 * on: a row labelled "Submitted" is one nobody chases, and a row labelled
 * "Order Entered" sends someone into the Unifi portal to void or finish it.
 * Getting either wrong costs real money, so they are unit-tested rather than
 * inferred from a template.
 */

/** One order's result, as the emails and the BatchRun record describe it. */
export interface OrderOutcome {
  /** BizzFlow's own id. */
  orderId: string;
  /** ORD-0042 — what an agent quotes internally. */
  reference: string | null;
  fullName: string;
  /** The order's status after the run: submitted | warning | order_entered | failed | … */
  status: string;
  /** The portal's Customer Order Number, when one exists. */
  portalOrderNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** The customer and package this run was for. Absent on pre-existing rows. */
  details?: OrderCaseDetails;
}

/**
 * The case details an email repeats back, frozen at the moment the run finished.
 *
 * Every field is optional because a BatchRun written before these existed still
 * has to render: a summary that threw on an old row would lose the results it
 * was sent to report. The template omits what it doesn't have rather than
 * printing a dash per missing field, which would read as "this order has no
 * package" instead of "this run predates the detail."
 */
export interface OrderCaseDetails {
  idType?: string | null;
  /** RAW id — masked at render time, never stored masked (see maskIdNumber). */
  idNumber?: string | null;
  /** Display form including the country code, e.g. +60148893212. */
  mobile?: string | null;
  email?: string | null;
  /** The installation address as the portal will read it. */
  address?: string | null;
  offerName?: string | null;
  deviceName?: string | null;
  /** Verbatim from the e-RF: a date plus a two-ended window, not an instant. */
  installationDate?: string | null;
}

/**
 * An ID with everything but its last four digits hidden.
 *
 * Email is not a private channel — it sits in an inbox, gets forwarded, and is
 * indexed by the provider. The last four digits are enough for the reader to
 * tell two customers apart, which is the only thing the number is doing in a
 * notification; the full MyKad is in the app, behind a login, for anyone who
 * genuinely needs it.
 */
export function maskIdNumber(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!raw) return "";
  if (raw.length <= 4) return raw;
  const tail = raw.slice(-4);
  // A 12-digit MyKad keeps its familiar shape, so a reader recognises it as an
  // IC rather than as a truncated something-else.
  if (raw.length === 12) return `••••••-••-${tail}`;
  return `${"•".repeat(raw.length - 4)}${tail}`;
}

/**
 * Build the frozen detail block from an Order row.
 *
 * One function for both emails so a single submit and a batch member can never
 * describe the same order differently — and pure, so it belongs beside the
 * rules rather than in either caller.
 */
export function caseDetailsFrom(o: {
  idType?: string | null;
  idNumber?: string | null;
  mobilePrefix?: string | null;
  mobile?: string | null;
  email?: string | null;
  street?: string | null;
  offerName?: string | null;
  deviceName?: string | null;
  installationDate?: string | null;
}): OrderCaseDetails {
  return {
    idType: o.idType ?? null,
    idNumber: o.idNumber ?? null,
    mobile: o.mobile ? `+${o.mobilePrefix ?? "60"}${o.mobile}` : null,
    email: o.email ?? null,
    address: o.street ?? null,
    offerName: o.offerName ?? null,
    deviceName: o.deviceName ?? null,
    installationDate: o.installationDate ?? null,
  };
}

/**
 * How much of a failure message an email carries.
 *
 * The portal's own sentence is short. A Playwright timeout is not: one real
 * failure produced a 2,000-character locator dump that filled the entire email
 * and buried the other two orders' results under it. The opening of the message
 * is the part that names the order and the cause, so it is the part kept.
 */
export const MAX_ERROR_CHARS = 320;

/**
 * A failure message trimmed to something a reader will actually read.
 *
 * Whitespace runs are collapsed first — the dumps arrive full of newlines and
 * indentation, which spend the budget on nothing. Truncation is MARKED, because
 * a sentence cut mid-word with no ellipsis reads as the portal having stopped
 * mid-sentence, which is a different and more alarming claim.
 */
export function shortErrorMessage(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= MAX_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_CHARS).trimEnd()}… (truncated — the full message is on the order's history)`;
}

/**
 * The three buckets the summary counts in.
 *
 * `order_entered` covers BOTH the app's `order_entered` status and a `warning`
 * that carries a portal order number, because to the reader they are the same
 * situation and the same next action: Unifi has a real order that this run did
 * not finish. The distinguishing fact is the number, not the status name.
 */
export type OutcomeBucket = "submitted" | "order_entered" | "failed";

export function bucketOf(o: Pick<OrderOutcome, "status" | "portalOrderNo">): OutcomeBucket {
  if (o.status === "submitted") return "submitted";
  if (o.portalOrderNo || o.status === "order_entered") return "order_entered";
  return "failed";
}

/**
 * The heading and the one-line explanation for a single order.
 *
 * `label` reuses STATUS_LABELS so an email and the Orders table can never
 * disagree about what a status is called; `detail` says what it means for the
 * person reading, including — for a stranded order — that something is owed.
 */
export function describeOutcome(o: Pick<OrderOutcome, "status" | "portalOrderNo">): {
  label: string;
  detail: string;
} {
  const bucket = bucketOf(o);
  if (bucket === "submitted") {
    return {
      label: STATUS_LABELS.submitted,
      detail: "Paid and the registration form (e-RF) was captured. Nothing further to do.",
    };
  }
  if (bucket === "order_entered") {
    return {
      label: STATUS_LABELS.order_entered,
      detail: o.portalOrderNo
        ? "The portal created this order but the run didn't finish it. Check it in the Unifi portal — resubmit it or void it."
        : "A customer profile was created but no order number came back. Check the portal before submitting again.",
    };
  }
  return {
    label: STATUS_LABELS.failed,
    detail: "No portal order was created. The draft is unchanged and can be submitted again.",
  };
}

/** Subject-line lead for a single-order email. */
export function outcomeSubject(o: Pick<OrderOutcome, "status" | "portalOrderNo">, name: string): string {
  switch (bucketOf(o)) {
    case "submitted":
      return `✅ Order submitted — ${name}`;
    case "order_entered":
      return `⚠️ Order entered but not completed — ${name}`;
    default:
      return `❌ Order failed — ${name}`;
  }
}

export interface BatchTotals {
  total: number;
  submitted: number;
  orderEntered: number;
  failed: number;
}

export function summarize(results: OrderOutcome[]): BatchTotals {
  const totals: BatchTotals = {
    total: results.length,
    submitted: 0,
    orderEntered: 0,
    failed: 0,
  };
  for (const r of results) {
    const bucket = bucketOf(r);
    if (bucket === "submitted") totals.submitted += 1;
    else if (bucket === "order_entered") totals.orderEntered += 1;
    else totals.failed += 1;
  }
  return totals;
}

/**
 * How long the run took, in words.
 *
 * Built from the two timestamps rather than formatted with toLocaleString: an
 * email is read in whatever timezone the reader is in, and a duration is the
 * one time value that means the same thing everywhere.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

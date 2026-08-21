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

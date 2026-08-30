"use client";

import Link from "next/link";
import { portalCodeFrom, portalOrderUrl, submitErrorCopy } from "@/lib/order-types";
import { ACTION_LABEL, actionFor, contactAdminNote } from "@/lib/failure-action";

interface Props {
  errorMessage: string | null;
  errorCode?: string | null;
  /** Portal order number, when the failure left one behind. */
  orderId?: string | null;
  /** `warning` (stranded order) reads amber; anything else reads red. */
  status: string;
  className?: string;
  /**
   * The order this failure belongs to, when the caller has it. With it the
   * block renders the remedy as a BUTTON — open the draft on the right card,
   * submit again, check at Unifi, reconnect. Without it (a past attempt in the
   * history list) the prose alone shows, as before.
   */
  order?: {
    id: string;
    reference?: string | null;
    autoRetries?: number;
    autoRetryAt?: Date | string | null;
  } | null;
  /** Starts a resubmit; the button is omitted when the caller cannot offer one. */
  onResubmit?: () => void;
}

/**
 * A submit failure, as much explained as the scraper managed to classify.
 *
 * Three tiers, and the fallback matters as much as the good case:
 *   * unclassified → the portal's message alone, exactly as it rendered before
 *     any of this existed. A code we have no copy for must never blank the panel.
 *   * classified   → a title, the portal's verbatim sentence, the numeric code
 *     as a quotable chip, and subtext saying what the code MEANS plus the field
 *     to change. The portal says what is wrong and never what to do about it.
 *   * classified + a minted order number → also the fact that the order already
 *     exists. Resubmitting mints a second one, and the first has to be voided by
 *     hand; leaving that unsaid is how duplicates reach a real customer.
 */
export function SubmitErrorBlock({
  errorMessage,
  errorCode,
  orderId,
  status,
  className = "",
  order,
  onResubmit,
}: Props) {
  if (!errorMessage) return null;

  const copy = submitErrorCopy(errorCode);
  const resolved = order
    ? actionFor({ errorCode, orderId, status, autoRetries: order.autoRetries, autoRetryAt: order.autoRetryAt })
    : null;
  const amber = status === "warning";
  const tone = amber ? "text-amber-700" : "text-red-600";

  if (!copy) {
    return (
      <div className={className}>
        <p className={`text-[11px] leading-snug ${tone}`}>{errorMessage}</p>
        {resolved && order && (
          <ActionRow resolved={resolved} order={order} orderId={orderId} errorCode={errorCode} onResubmit={onResubmit} />
        )}
      </div>
    );
  }

  const code = portalCodeFrom(errorMessage);
  const border = amber ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const muted = amber ? "text-amber-800/80" : "text-red-700/80";

  return (
    <div className={`rounded-md border ${border} px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`text-[12px] font-semibold ${tone}`}>{copy.title}</span>
        {code && (
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              amber
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-red-300 bg-red-100 text-red-900"
            }`}
            title="The portal's own error code — quote this to Unifi support"
          >
            {code}
          </span>
        )}
      </div>

      <p className={`mt-1 text-[11px] leading-snug ${tone}`}>{errorMessage}</p>

      <p className={`mt-1.5 text-[11px] leading-snug ${muted}`}>{copy.subtext}</p>

      <p className={`mt-1.5 text-[11px] font-medium leading-snug ${tone}`}>
        {copy.fix}
        {orderId && (
          <>
            {" "}
            Order{" "}
            <span className="font-mono tabular-nums">{orderId}</span> already exists in
            the portal and must be voided — resubmitting creates a second one.
          </>
        )}
      </p>
      {resolved && order && (
        <ActionRow resolved={resolved} order={order} orderId={orderId} errorCode={errorCode} onResubmit={onResubmit} />
      )}
    </div>
  );
}

/**
 * The remedy as a button. `wait` renders nothing — the status pill already
 * reads "Retrying · 2 of 3", and a second control saying so is noise.
 */
function ActionRow({ resolved, order, orderId, errorCode, onResubmit }: {
  resolved: ReturnType<typeof actionFor>;
  order: NonNullable<Props["order"]>;
  orderId?: string | null;
  errorCode?: string | null;
  onResubmit?: () => void;
}) {
  const btn = "mt-2 inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[12px] font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]";
  switch (resolved.action) {
    case "wait":
      return null;
    case "fix_field":
      return (
        <Link
          href={`/dashboard/order-entry/new-order?draft=${order.id}&focus=${resolved.section ?? "customer"}`}
          className={`${btn} bg-[#635BFF] hover:bg-[#0A2540]`}
        >
          {ACTION_LABEL.fix_field}
        </Link>
      );
    case "resubmit":
      return onResubmit ? (
        <button type="button" onClick={onResubmit} className={`${btn} bg-[#635BFF] hover:bg-[#0A2540]`}>
          {ACTION_LABEL.resubmit}
        </button>
      ) : null;
    case "check_portal":
      return (
        <a
          href={portalOrderUrl(orderId ?? "")}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} bg-[#B54708] hover:bg-[#0A2540]`}
        >
          {ACTION_LABEL.check_portal} ↗
        </a>
      );
    case "reconnect":
      return (
        <Link href="/dashboard/order-entry" className={`${btn} bg-[#635BFF] hover:bg-[#0A2540]`}>
          {ACTION_LABEL.reconnect}
        </Link>
      );
    case "contact_admin":
      return (
        <p className="mt-2 text-[11px] font-medium text-[#425466]">
          {contactAdminNote({ errorCode, reference: order.reference })}
        </p>
      );
  }
}

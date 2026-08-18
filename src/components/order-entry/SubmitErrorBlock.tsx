"use client";

import { portalCodeFrom, submitErrorCopy } from "@/lib/order-types";

interface Props {
  errorMessage: string | null;
  errorCode?: string | null;
  /** Portal order number, when the failure left one behind. */
  orderId?: string | null;
  /** `warning` (stranded order) reads amber; anything else reads red. */
  status: string;
  className?: string;
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
}: Props) {
  if (!errorMessage) return null;

  const copy = submitErrorCopy(errorCode);
  const amber = status === "warning";
  const tone = amber ? "text-amber-700" : "text-red-600";

  if (!copy) {
    return (
      <p className={`text-[11px] leading-snug ${tone} ${className}`}>{errorMessage}</p>
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
    </div>
  );
}

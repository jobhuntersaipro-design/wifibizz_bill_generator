"use client";

import { useEffect, useState } from "react";
import { markOutcomeSeen, unseenOutcomes, type UnseenOutcome } from "@/actions/order";
import { SubmitErrorBlock } from "@/components/order-entry/SubmitErrorBlock";

/**
 * "While you were away" — terminal outcomes no signed-in eye has seen.
 *
 * Shown at the top of the Orders list, and only when there is something in it.
 * Each failure row carries the SAME action button the detail page has
 * (SubmitErrorBlock), because the point of telling an agent something failed is
 * what they do next.
 *
 * Dismissing is what marks an outcome seen — the card appearing on screen does
 * NOT, deliberately: auto-marking on render would empty the badge the moment
 * the page loads, before anything was actually read.
 */
export function UnseenOutcomes({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<UnseenOutcome[] | null>(null);

  useEffect(() => {
    let alive = true;
    unseenOutcomes()
      .then((res) => { if (alive && res.success) setItems(res.orders); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!items || items.length === 0) return null;

  async function dismiss(ids: string[]) {
    // Optimistic: the rows leave the card at once, and a failed call simply
    // brings them back on the next visit rather than leaving a dead button.
    setItems((prev) => (prev ? prev.filter((i) => !ids.includes(i.id)) : prev));
    await markOutcomeSeen(ids).catch(() => {});
    onChanged?.();
  }

  return (
    <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#0A2540]">
          While you were away · {items.length}
        </h2>
        <button
          type="button"
          onClick={() => dismiss(items.map((i) => i.id))}
          className="cursor-pointer text-xs text-[#635BFF] hover:underline"
        >
          Dismiss all
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((o) => (
          <li key={o.id} className="rounded-lg border border-[#F0F3F8] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-[#0A2540]">
                <span className="font-medium">{o.reference ?? o.fullName}</span>
                {o.reference && <span className="ml-2 text-xs text-[#697386]">{o.fullName}</span>}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <OutcomePill status={o.status} />
                <button
                  type="button"
                  onClick={() => dismiss([o.id])}
                  aria-label={`Dismiss ${o.reference ?? o.fullName}`}
                  className="cursor-pointer rounded p-1 text-[#697386] hover:bg-[#F6F9FC] hover:text-[#0A2540]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {o.status === "submitted" ? (
              o.orderId && (
                <p className="mt-1 text-xs text-[#425466]">
                  Order No. <span className="font-medium tabular-nums">{o.orderId}</span>
                </p>
              )
            ) : (
              <SubmitErrorBlock
                className="mt-2"
                errorMessage={o.errorMessage}
                errorCode={o.errorCode}
                orderId={o.orderId}
                status={o.status}
                order={{ id: o.id, reference: o.reference, autoRetries: o.autoRetries, autoRetryAt: o.autoRetryAt }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OutcomePill({ status }: { status: string }) {
  const tone =
    status === "submitted" ? "bg-[#ECFDF3] text-[#027A48]"
    : status === "warning" ? "bg-[#FFFAEB] text-[#B54708]"
    : "bg-[#FEF3F2] text-[#B42318]";
  const label = status === "submitted" ? "Submitted" : status === "warning" ? "Needs checking" : "Failed";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

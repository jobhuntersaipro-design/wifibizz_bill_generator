"use client";

import {
  SUBMIT_STEPS,
  POINT_OF_NO_RETURN,
  stepIndexForStage,
} from "@/lib/order-types";

type StepState = "done" | "running" | "failed" | "warning" | "pending";

interface Props {
  stage: string | null;
  status: string;
  errorMessage: string | null;
  orderId: string | null;
}

const POINT_INDEX = SUBMIT_STEPS.findIndex((s) => s.key === POINT_OF_NO_RETURN);

/** A terminal status means the run is over, whatever step it stopped on. */
const isTerminal = (status: string) =>
  status === "submitted" || status === "failed" || status === "warning";

function stateFor(index: number, current: number, status: string): StepState {
  if (status === "submitted") return "done";
  if (index < current) return "done";
  if (index > current) return "pending";
  // The step the run is sitting on: still working, or the one it stopped on.
  if (status === "failed") return "failed";
  // A warning means it REACHED this step and didn't get through it — a green
  // tick here would claim work that never completed (e.g. the device dialog
  // that was never confirmed).
  if (status === "warning") return "warning";
  return "running";
}

function Icon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-green-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (state === "running") {
    return (
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
    );
  }
  if (state === "warning") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-amber-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 8v5M12 17h.01" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-red-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C1C9D2]" />;
}

/**
 * The step checklist for one submit, shown inline under its row.
 *
 * Steps come from the shared SUBMIT_STEPS list and the order's last reported
 * stage. A stage this build doesn't know (the scraper may be a deploy ahead)
 * yields index -1, which renders as a generic "Working…" line rather than
 * silently showing no progress at all.
 */
export function SubmitProgress({ stage, status, errorMessage, orderId }: Props) {
  const current = stepIndexForStage(stage);
  const unknownStage = current === -1 && !!stage && !isTerminal(status);

  return (
    <div className="px-4 py-3 bg-[#F6F9FC] border-t border-[#E3E8EF]">
      <ol className="flex flex-col gap-1.5">
        {SUBMIT_STEPS.map((step, i) => {
          const state = stateFor(i, current, status);
          return (
            <li key={step.key}>
              {/* Everything below this line exists in the portal — a failure
                  after it needs checking by hand, not resubmitting. */}
              {i === POINT_INDEX + 1 && (
                <div className="flex items-center gap-2 py-1.5" aria-hidden="true">
                  <span className="h-px flex-1 bg-[#E3E8EF]" />
                  <span className="text-[9px] uppercase tracking-wide text-[#8792A2]">
                    Order exists in portal
                  </span>
                  <span className="h-px flex-1 bg-[#E3E8EF]" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  <Icon state={state} />
                </span>
                <span
                  className={`text-[11px] ${
                    state === "failed"
                      ? "text-red-700 font-medium"
                      : state === "warning"
                        ? "text-amber-700 font-medium"
                        : state === "running"
                          ? "text-[#0A2540] font-medium"
                          : state === "done"
                            ? "text-[#425466]"
                            : "text-[#8792A2]"
                  }`}
                >
                  {step.label}
                  {state === "running" && "…"}
                </span>
              </div>
            </li>
          );
        })}
        {unknownStage && (
          <li className="flex items-center gap-2">
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              <Icon state="running" />
            </span>
            <span className="text-[11px] text-[#0A2540] font-medium">Working…</span>
          </li>
        )}
      </ol>

      {orderId && (
        <p className="mt-2.5 text-[11px] text-[#425466]">
          Order No. <span className="font-medium tabular-nums">{orderId}</span>
        </p>
      )}
      {errorMessage && (
        <p
          className={`mt-2 text-[11px] leading-snug ${
            status === "warning" ? "text-amber-700" : "text-red-600"
          }`}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}

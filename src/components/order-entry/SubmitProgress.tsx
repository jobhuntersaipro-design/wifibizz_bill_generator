"use client";

import { SubmitErrorBlock } from "@/components/order-entry/SubmitErrorBlock";
import RobotWorking from "./RobotWorking";
import {
  SUBMIT_STEPS,
  POINT_OF_NO_RETURN,
  progressReading,
  type StageDetails,
} from "@/lib/order-types";

type StepState = "done" | "running" | "failed" | "warning" | "pending";

interface Props {
  stage: string | null;
  status: string;
  errorMessage: string | null;
  // Classified failure, when the scraper recognised one. Drives the explained
  // error block; null falls back to the raw portal message.
  errorCode?: string | null;
  orderId: string | null;
  // What the portal resolved at each step, keyed by stage. A step without an
  // entry simply shows no second line — details arrive as the run reaches them.
  details?: StageDetails;
  // Every stage this run has been seen at, in any order — the floor for "how far
  // did it actually get". Only needed where `details` is not the record of that
  // (the detail page reads the event history, not the progress poll); it falls
  // back to the details' own keys.
  observedStages?: (string | null | undefined)[];
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

function Marker({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <svg
        className="step-mark step-mark-check marker-pop h-3.5 w-3.5 shrink-0 text-[#0E9F6E]"
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
      <span className="step-live h-2 w-2 shrink-0 rounded-full bg-[#635BFF]" />
    );
  }
  if (state === "warning") {
    return (
      <svg
        className="step-mark marker-pop h-3.5 w-3.5 shrink-0 text-amber-600"
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
        className="step-mark marker-pop h-3.5 w-3.5 shrink-0 text-red-600"
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
 * The step timeline for one submit — same rail-and-marker shape the attempt
 * history uses, so a live run and a finished one read as the same object.
 *
 * Steps come from the shared SUBMIT_STEPS list and the order's last reported
 * stage. A stage this build doesn't know (the scraper may be a deploy ahead)
 * yields index -1, which renders as a generic "Working…" line rather than
 * silently showing no progress at all.
 */
export function SubmitProgress({
  stage,
  status,
  errorMessage,
  errorCode,
  orderId,
  details,
  observedStages,
}: Props) {
  // The step arithmetic lives in progressReading (order-types) so it can be
  // tested: this file has no test environment, and it is exactly this
  // calculation that used to answer an unrecognised stage with "Step 1 of 17".
  const { current, done, pct, heading, unknownStage } = progressReading(
    stage,
    status,
    observedStages ?? Object.keys(details ?? {}),
  );

  return (
    <div className="px-4 py-3 bg-[#F6F9FC] border-t border-[#E3E8EF]">
      {/* One glanceable line of progress above the detail — the timeline says
          which step, this says how far. */}
      <div className="mb-3 flex items-center gap-3">
        {/* The 2-5 minute wait is where the agent actually lives — the robot
            at its laptop says "still working on it" louder than a static
            label, and leaves the moment the run ends, whichever way. */}
        {!isTerminal(status) && <RobotWorking size={64} className="-my-2" />}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={`text-[11px] font-semibold ${
                status === "failed"
                  ? "text-red-700"
                  : status === "warning"
                    ? "text-amber-700"
                    : status === "submitted"
                      ? "text-[#0E9F6E]"
                      : "text-[#0A2540]"
              }`}
            >
              {heading}
            </span>
            <span className="ml-auto text-[10px] tabular-nums text-[#8792A2]">
              {pct}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#E3E8EF]">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                  status === "failed"
                    ? "bg-red-500"
                    : status === "warning"
                      ? "bg-amber-500"
                      : status === "submitted"
                        ? "bg-[#0E9F6E]"
                        : "bg-[#635BFF]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-[#8792A2]">
              {done}/{SUBMIT_STEPS.length}
            </span>
          </div>
        </div>
      </div>

      <ol className="flex flex-col">
        {SUBMIT_STEPS.map((step, i) => {
          const detail = details?.[step.key];
          let state = stateFor(i, current, status);
          // A resolved step outranks position. The run moves on past a mandatory
          // portal field it left unset (Winback Tagging at "---Please select---"),
          // and a green tick behind it would claim work that never happened.
          if (detail && state !== "pending" && state !== "running") {
            if (detail.outcome === "failed") state = "failed";
            else if (detail.outcome === "skipped") state = "warning";
            // `not_applicable` stays done — the field isn't on this offer, which
            // is normal, not a warning.
          }
          const reached = state !== "pending";
          const last = i === SUBMIT_STEPS.length - 1 && !unknownStage;
          return (
            <li
              key={step.key}
              className="step-row-in flex gap-3"
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
            >
              {/* Rail: the connector below a marker is what carries the eye
                  down the run, and it only fills once the step is behind us. */}
              <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
                <span className="flex h-4 w-3.5 items-center justify-center">
                  <Marker state={state} />
                </span>
                {!last && (
                  <span
                    className={`w-px flex-1 ${
                      state === "done"
                        ? "rail-draw bg-[#B9B5FF]"
                        : "bg-[#E3E8EF]"
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-2">
                <span className="flex items-baseline gap-1.5">
                  {/* Fixed-width so the labels stay in one optical column, and
                      zero-padded so 4 and 14 occupy the same space. */}
                  <span
                    className={`w-4 shrink-0 text-[10px] tabular-nums ${
                      state === "pending" ? "text-[#C1C9D2]" : "text-[#8792A2]"
                    }`}
                    aria-hidden="true"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`text-[12px] transition-colors duration-300 ${
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
                </span>

                {/* What the portal actually resolved. This is the point of the
                    whole checklist: "Checking installation address ✓" says
                    nothing, the matched address says whether it picked the right
                    unit. Wraps rather than truncates — a near-miss address
                    differs at the end. */}
                {detail?.value && (
                  <p
                    className={`detail-in mt-0.5 ml-5.5 break-words text-[11px] leading-snug ${
                      detail.outcome === "failed"
                        ? "text-red-600"
                        : detail.outcome === "skipped"
                          ? "text-amber-700"
                          : detail.outcome === "not_applicable"
                            ? "text-[#8792A2]"
                            : "text-[#425466]"
                    }`}
                  >
                    {detail.value}
                    {detail.note && (
                      <span className="text-[#8792A2]"> — {detail.note}</span>
                    )}
                  </p>
                )}

                {/* Everything below this line exists in the portal — a failure
                    after it needs checking by hand, not resubmitting. */}
                {i === POINT_INDEX && (
                  <div
                    className="mt-2 flex items-center gap-2"
                    aria-hidden="true"
                  >
                    <span className="text-[9px] uppercase tracking-wide text-[#8792A2]">
                      Order exists in portal
                    </span>
                    <span
                      className={`h-px flex-1 ${
                        reached ? "bg-[#B9B5FF]" : "bg-[#E3E8EF]"
                      }`}
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}

        {unknownStage && (
          <li className="flex gap-3">
            <span className="flex h-4 w-3.5 items-center justify-center">
              <Marker state="running" />
            </span>
            <span className="text-[11px] font-medium text-[#0A2540]">
              Working…
            </span>
          </li>
        )}
      </ol>

      {orderId && (
        <p className="mt-1.5 text-[11px] text-[#425466]">
          Order No. <span className="font-medium tabular-nums">{orderId}</span>
        </p>
      )}
      <SubmitErrorBlock
        className="mt-2"
        errorMessage={errorMessage}
        errorCode={errorCode}
        orderId={orderId}
        status={status}
      />
    </div>
  );
}

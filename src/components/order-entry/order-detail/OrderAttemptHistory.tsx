"use client";

import { useState } from "react";
import { Camera, ChevronDown, CornerDownRight, FileText, Maximize2 } from "lucide-react";
import type { AttemptView } from "@/lib/order-history";
import {
  CAPTURE_RETENTION_DAYS,
  captureCaption,
  captureExpiry,
  captureLabel,
  elapsedLabel,
  isPageBreakStage,
  isPdfCapture,
  labelForStage,
  mergeTimeline,
  partitionCaptures,
  stepIndexForStage,
  type CaptureFrame,
  type RunTone,
} from "@/lib/order-types";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptureCarousel, captureSrc } from "../CaptureCarousel";
import { SubmitErrorBlock } from "../SubmitErrorBlock";
import { OUTCOME_LABEL, TONE, dayLabel, gap, time } from "./shared";

/**
 * The strip of thumbnails at the top of an expanded attempt.
 *
 * Each frame stays a timeline row at its own chronological position, which is
 * what keeps every picture next to the step it documents — but with nine of them
 * scrolling the whole timeline to find the device shot is real friction, so this
 * is the index into it. Only worth showing once there is more than one frame.
 */
function CapturesStrip({
  captures,
  onOpen,
}: {
  captures: CaptureFrame[];
  onOpen: (index: number) => void;
}) {
  return (
    <div className="border-t border-[#E3E8EF] bg-white px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <Camera className="h-3 w-3 shrink-0 text-[#8792A2]" aria-hidden="true" />
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8792A2]">
          Captures · {captures.length}
        </h4>
      </div>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {captures.map((c, n) => (
          <li key={c.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(n)}
              aria-label={`Open ${captureLabel(c.slot)} in the capture viewer`}
              title={captureLabel(c.slot)}
              className="group block w-20 cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
            >
              <span className="block overflow-hidden rounded-md border border-[#E3E8EF] bg-[#F6F9FC]">
                {isPdfCapture(c.key) ? (
                  /* A PDF has no thumbnail to show — a file tile says what it is
                     rather than leaving a blank slot in the rail. */
                  <span className="flex h-12 w-full items-center justify-center bg-[#EDEBFF] transition-transform duration-200 ease-out group-hover:scale-[1.04]">
                    <FileText className="h-4 w-4 text-[#635BFF]" aria-hidden="true" />
                  </span>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- an
                        auth-gated private stream, not an optimisable static asset */}
                    <img
                      src={captureSrc(c.key)}
                      alt=""
                      loading="lazy"
                      className="h-12 w-full object-cover object-top transition-transform duration-200 ease-out group-hover:scale-[1.04]"
                    />
                  </>
                )}
              </span>
              <span className="mt-1 block truncate text-[9px] leading-tight text-[#697386]">
                {captureLabel(c.slot)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One captured screen, as a timeline row at the moment it was taken.
 *
 * Chronological placement is what makes nine pictures readable rather than a
 * wall: each one sits next to the step it documents, so it reads as "…and here
 * is what the screen looked like at that point".
 */
function ShotRow({
  capture,
  last,
  onOpen,
}: {
  capture: CaptureFrame;
  last: boolean;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const src = captureSrc(capture.key);
  // The e-RF arrives through the capture path so it lands in its true place on
  // the timeline, but it is a document, not a screen — no <img>, no thumbnail.
  const isPdf = isPdfCapture(capture.key);
  const expiry = captureExpiry(capture.at);
  // Past retention the object is GONE from R2, so the <img> would 404 into a
  // broken frame. Say so in words instead.
  const expired = !!expiry?.expired;
  const soon = !!expiry?.soon;

  return (
    <li className="step-row-in flex items-start gap-3">
      <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
        <span className="flex h-4 w-3.5 items-center justify-center">
          {isPdf ? (
            <FileText className="h-3 w-3 shrink-0 text-[#635BFF]" aria-hidden="true" />
          ) : (
            <Camera className="h-3 w-3 shrink-0 text-[#635BFF]" aria-hidden="true" />
          )}
        </span>
        {!last && <span className="w-px flex-1 bg-[#B9B5FF]" />}
      </div>
      <div className="min-w-0 flex-1 pb-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12px] font-medium text-[#0A2540]">
            {captureLabel(capture.slot)}
          </span>
          <span className="text-[10px] tabular-nums text-[#8792A2]">{time(capture.at)}</span>
          {expiry && (
            <span
              className={`text-[10px] tabular-nums ${
                expired ? "text-[#8792A2]" : soon ? "text-amber-700" : "text-[#8792A2]"
              }`}
            >
              {expiry.label}
            </span>
          )}
          {!expired && (
            <button
              type="button"
              onClick={onOpen}
              className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#635BFF] transition-colors duration-150 hover:bg-[#EDEBFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
            >
              Full size <Maximize2 className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
        {expired ? (
          <p className="mt-1.5 rounded-lg border border-dashed border-[#E3E8EF] px-3 py-4 text-center text-[10px] leading-snug text-[#8792A2]">
            {isPdf ? "This document" : "This frame"} passed its {CAPTURE_RETENTION_DAYS}-day
            retention and has been deleted.
          </p>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${captureLabel(capture.slot)} in the capture viewer`}
            className="group mt-1.5 block w-full cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            <div className="relative overflow-hidden rounded-lg border border-[#E3E8EF] bg-white">
              {isPdf && (
                <span className="flex items-center gap-2.5 px-3 py-4 transition-colors duration-150 group-hover:bg-[#F6F9FC]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#EDEBFF]">
                    <FileText className="h-4 w-4 text-[#635BFF]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-[11px] font-medium text-[#0A2540]">
                      {capture.key.split("/").pop()}
                    </span>
                    <span className="block text-[10px] text-[#8792A2]">
                      PDF · click to preview
                    </span>
                  </span>
                </span>
              )}
              {!isPdf && !loaded && <Skeleton className="h-40 w-full rounded-none" />}
              {!isPdf && (
                /* eslint-disable-next-line @next/next/no-img-element -- an auth-gated
                   private stream, not an optimisable static asset */
                <img
                  src={src}
                  alt={`${captureLabel(capture.slot)} as the portal rendered it`}
                  loading="lazy"
                  onLoad={() => setLoaded(true)}
                  onError={() => setLoaded(true)}
                  className={`h-40 w-full object-cover object-top transition-transform duration-300 ease-out group-hover:scale-[1.015] ${
                    loaded ? "opacity-100" : "absolute inset-0 opacity-0"
                  }`}
                />
              )}
            </div>
          </button>
        )}
        <p className="mt-1 text-[10px] leading-snug text-[#8792A2]">
          {captureCaption(capture.slot)}
        </p>
      </div>
    </li>
  );
}

/**
 * Fold consecutive events that resolve to the SAME step into one row.
 *
 * Several coarse scraper keys map onto one step (`order_entered`, `feasibility`
 * and `checking_address` are all "Checking installation address"), and each
 * arrives as its own row — so the timeline would print the same step three times
 * in a row. Keep the FIRST row's timestamp, because that is when the step
 * actually started, and adopt the first message that arrives, because that is
 * the value the portal resolved.
 *
 * Only consecutive rows of the same status fold: a terminal row carries a stage
 * too, and swallowing it would hide the failure.
 */
function foldSteps(events: AttemptView["events"]): AttemptView["events"] {
  const out: AttemptView["events"] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const i = stepIndexForStage(e.stage);
    const same =
      prev &&
      i >= 0 &&
      stepIndexForStage(prev.stage) === i &&
      prev.status === e.status;
    if (same) out[out.length - 1] = { ...prev, message: prev.message ?? e.message };
    else out.push(e);
  }
  return out;
}

/**
 * One attempt as a vertical timeline.
 *
 * Each row is a step with the time it took, so a slow or stuck step is visible
 * at a glance — the flat "stage" on the order can only ever show the last one.
 */
function Attempt({ a, defaultOpen, delay }: { a: AttemptView; defaultOpen: boolean; delay: number }) {
  const [open, setOpen] = useState(defaultOpen);
  // Which frame of THIS attempt the carousel is showing, or null when closed.
  // Owned here because the carousel's sequence is exactly this attempt's frames.
  const [viewing, setViewing] = useState<number | null>(null);
  const failure = [...a.events].reverse().find(
    (e) => (e.status === "failed" || e.status === "warning") && e.message,
  );
  // Captures are artefacts of the run, not steps it passed through, so they
  // never appear as timeline rows reading out an R2 key — they come back below
  // as pictures, at the same position.
  const { steps, captures } = partitionCaptures(a.events);
  const took = elapsedLabel(a.startedAt, a.endedAt);
  const rows = mergeTimeline(foldSteps(steps), captures);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="panel-card-in overflow-hidden rounded-xl border border-[#E3E8EF] bg-white"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]">
        <span className="text-[12px] font-semibold text-[#0A2540]">Attempt {a.attempt}</span>
        <Badge
          className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-medium ${
            TONE[a.outcome === "submitting" ? "running" : a.outcome === "order_entered" ? "submitted" : (a.outcome as RunTone)]?.chip ??
            "bg-[#E3E8EF] text-[#425466]"
          }`}
        >
          {OUTCOME_LABEL[a.outcome] ?? a.outcome}
        </Badge>
        <span className="ml-auto flex items-center gap-2 text-[10px] tabular-nums text-[#697386]">
          {captures.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-[#EDEBFF] px-1.5 py-0.5 font-medium text-[#635BFF]"
              title={`This attempt captured ${captures.length} portal screen${captures.length === 1 ? "" : "s"}`}
            >
              <Camera className="h-3 w-3" aria-hidden="true" />
              Capture · {captures.length}
            </span>
          )}
          {took && <span>{took}</span>}
          <ChevronDown
            className={`h-3.5 w-3.5 text-[#8792A2] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </CollapsibleTrigger>

      <p className="px-4 pb-2 text-[10px] tabular-nums text-[#8792A2]">
        {dayLabel(a.startedAt)} · {time(a.startedAt)}
        {a.endedAt && ` → ${time(a.endedAt)}`}
      </p>

      {/* The reason is worth seeing without expanding — it's the question being asked. */}
      {!open && failure?.message && (
        <SubmitErrorBlock
          className="mx-4 mb-3"
          errorMessage={failure.message}
          errorCode={failure.errorCode}
          status={a.outcome}
        />
      )}

      <CollapsibleContent className="collapse-panel" keepMounted>
        {/* An index into the timeline below — only earns its space once there is
            more than one frame to hunt through. */}
        {captures.length > 1 && (
          <CapturesStrip captures={captures} onOpen={setViewing} />
        )}
        <ol className="flex flex-col border-t border-[#E3E8EF] bg-[#F6F9FC] px-4 py-3">
          {rows.map((row, i) => {
            const last = i === rows.length - 1;
            if (row.kind === "shot") {
              // Index within `captures`, not within `rows` — the carousel's
              // sequence is the frames alone, with the step rows removed.
              const at = captures.findIndex((c) => c.id === row.capture.id);
              return (
                <ShotRow
                  key={row.capture.id}
                  capture={row.capture}
                  last={last}
                  onOpen={() => setViewing(at)}
                />
              );
            }
            const e = row.event;
            // A page boundary, not a step. Rendered as a rule across the
            // timeline so the run reads as the sequence of portal pages an
            // agent would have clicked through, instead of one flat list of
            // sixteen steps with no sense of where they happened.
            if (isPageBreakStage(e.stage)) {
              return (
                <li key={e.id} className="step-row-in flex items-center gap-2 py-1.5">
                  <span className="h-px flex-1 bg-[#CBD2DC]" aria-hidden="true" />
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#697386] ring-1 ring-[#E3E8EF]">
                    <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {e.message || "Next page"}
                  </span>
                  <span className="h-px flex-1 bg-[#CBD2DC]" aria-hidden="true" />
                </li>
              );
            }
            const prev = rows[i - 1];
            const took = prev ? gap(prev.at, e.createdAt) : "";
            const bad = e.status === "failed";
            const warn = e.status === "warning";
            return (
              <li
                key={e.id}
                className="step-row-in flex items-start gap-3"
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              >
                {/* Rail — same shape as the live run's timeline. */}
                <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
                  <span className="flex h-4 w-3.5 items-center justify-center">
                    <span
                      className={`step-mark h-2 w-2 shrink-0 rounded-full ${
                        bad ? "bg-red-500" : warn ? "bg-amber-500" : e.status === "submitted" ? "bg-[#0E9F6E]" : "bg-[#B9B5FF]"
                      }`}
                    />
                  </span>
                  {!last && <span className="w-px flex-1 bg-[#B9B5FF]" />}
                </div>
                <div className="min-w-0 flex-1 pb-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={`text-[12px] font-medium ${
                        bad ? "text-red-700" : warn ? "text-amber-700" : "text-[#0A2540]"
                      }`}
                    >
                      {e.stage ? labelForStage(e.stage) : OUTCOME_LABEL[e.status] ?? e.status}
                    </span>
                    <span className="text-[10px] tabular-nums text-[#8792A2]">{time(e.createdAt)}</span>
                    {took && <span className="text-[10px] tabular-nums text-[#8792A2]">+{took}</span>}
                  </div>
                  {e.message && (
                    <p
                      className={`mt-0.5 break-words text-[11px] leading-snug ${
                        bad ? "text-red-600" : warn ? "text-amber-700" : "text-[#425466]"
                      }`}
                    >
                      {e.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>

      {/* Portals itself above whatever page opened it. */}
      {viewing !== null && (
        <CaptureCarousel
          captures={captures}
          startIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </Collapsible>
  );
}

/**
 * The History tab body: loading/empty states, then one `Attempt` per run.
 * Takes already-fetched `attempts`/`error` (from `useOrderAttempts`) rather
 * than fetching its own — the hero needs the same data for its step-count
 * stat, so both read one fetch instead of polling twice.
 */
export function AttemptList({
  attempts,
  error,
  hasAttempted,
}: {
  attempts: AttemptView[] | null;
  error: string | null;
  /** Whether the order has ever been submitted — shapes the empty-state copy. */
  hasAttempted: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {!error && attempts === null && (
        <>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </>
      )}
      {!error && attempts?.length === 0 && (
        <p className="rounded-xl border border-dashed border-[#E3E8EF] px-4 py-6 text-center text-[11px] text-[#697386]">
          {hasAttempted
            ? "No step history was recorded — this order was submitted before status tracking existed."
            : "This draft hasn't been submitted yet."}
        </p>
      )}
      {attempts?.map((a, i) => (
        <Attempt key={a.attempt} a={a} defaultOpen={i === 0} delay={i * 60} />
      ))}
    </div>
  );
}

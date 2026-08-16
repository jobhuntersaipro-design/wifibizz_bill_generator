"use client";

import { useEffect, useState } from "react";
import { getOrderHistory } from "@/actions/order";
import type { AttemptView } from "@/lib/order-history";
import {
  PAGE1_SCREENSHOT_STAGE,
  SUBMIT_STEPS,
  needsVoiding,
  type OrderListItem,
} from "@/lib/order-types";
import { SubmitProgress } from "./SubmitProgress";

const STEP_LABELS: Record<string, string> = Object.fromEntries(
  SUBMIT_STEPS.map((s) => [s.key, s.label]),
);

const OUTCOME_STYLE: Record<string, string> = {
  submitted: "bg-green-100 text-green-700",
  order_entered: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
  submitting: "bg-[#EDEBFF] text-[#635BFF]",
};

const OUTCOME_LABEL: Record<string, string> = {
  submitted: "Submitted",
  order_entered: "Order entered",
  warning: "Needs checking",
  failed: "Failed",
  submitting: "Running",
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** Seconds between two events, for the per-step timings. */
function gap(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 1000) return "";
  return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * The R2 key of this attempt's page-1 screenshot, if it captured one.
 *
 * Read per attempt rather than off the order: a retried order has one frame per
 * attempt, and the order row only ever holds the latest.
 */
function screenshotKeyFor(a: AttemptView): string | null {
  const e = [...a.events]
    .reverse()
    .find((x) => x.stage === PAGE1_SCREENSHOT_STAGE && x.message);
  const key = e?.message?.trim() ?? "";
  // A failed capture records its reason in the same field. Only a real key is a
  // screenshot — anything else must not become a broken <img>.
  return key.startsWith("order-screenshots/") && key.endsWith(".png") ? key : null;
}

/**
 * The portal frame captured once Winback Tagging resolved.
 *
 * This is the audit artefact for a submit: order number, installation address,
 * installation contact, main offer, account and winback tagging in one image, as
 * the portal rendered them. Anchored to the top because that is where the order
 * number and address sit — the full capture is a tall page.
 */
function ScreenshotSection({ orderKey }: { orderKey: string }) {
  const src = `/api/orders/screenshot?key=${encodeURIComponent(orderKey)}`;
  return (
    <div className="border-t border-[#E3E8EF] bg-white px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-[#0A2540]">Portal screenshot</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[11px] font-medium text-[#635BFF] hover:underline"
        >
          Open ↗
        </a>
      </div>
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- an auth-gated
            private stream, not an optimisable static asset */}
        <img
          src={src}
          alt="New Connection page as the portal rendered it"
          loading="lazy"
          className="max-h-64 w-full max-w-full rounded-md border border-[#E3E8EF] object-cover object-top"
        />
      </a>
      <p className="mt-1.5 text-[10px] leading-snug text-[#8792A2]">
        Captured after Winback Tagging — order number, installation address,
        contact, main offer, account and winback tagging.
      </p>
    </div>
  );
}

/**
 * One attempt as a vertical timeline.
 *
 * Each row is a step with the time it took, so a slow or stuck step is visible
 * at a glance — the flat "stage" on the order can only ever show the last one.
 */
function Attempt({ a, defaultOpen }: { a: AttemptView; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const failure = [...a.events].reverse().find(
    (e) => (e.status === "failed" || e.status === "warning") && e.message,
  );
  const shot = screenshotKeyFor(a);
  // The capture is an artefact of the run, not a step it passed through, so it
  // gets its own section instead of a timeline row reading out an R2 key.
  const events = a.events.filter((e) => e.stage !== PAGE1_SCREENSHOT_STAGE);

  return (
    <div className="rounded-lg border border-[#E3E8EF] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-[#F6F9FC] transition-colors cursor-pointer text-left"
      >
        <span className="text-[12px] font-semibold text-[#0A2540]">Attempt {a.attempt}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            OUTCOME_STYLE[a.outcome] ?? "bg-[#E3E8EF] text-[#425466]"
          }`}
        >
          {OUTCOME_LABEL[a.outcome] ?? a.outcome}
        </span>
        <span className="text-[11px] text-[#697386] tabular-nums">
          {dayLabel(a.startedAt)} · {time(a.startedAt)}
          {a.endedAt && ` → ${time(a.endedAt)}`}
        </span>
        <svg
          className={`ml-auto h-3.5 w-3.5 text-[#8792A2] transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* The reason is worth seeing without expanding — it's the question being asked. */}
      {!open && failure?.message && (
        <p className={`px-4 pb-2.5 text-[11px] leading-snug ${
          a.outcome === "warning" ? "text-amber-700" : "text-red-600"
        }`}>
          {failure.message}
        </p>
      )}

      {open && (
        <ol className="border-t border-[#E3E8EF] bg-[#F6F9FC] px-4 py-3 flex flex-col gap-0">
          {events.map((e, i) => {
            const prev = events[i - 1];
            const took = prev ? gap(prev.createdAt, e.createdAt) : "";
            const bad = e.status === "failed";
            const warn = e.status === "warning";
            return (
              <li
                key={e.id}
                className="step-row-in flex gap-3 items-start"
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              >
                {/* Rail — same shape as the live run's timeline. */}
                <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
                  <span className="flex h-4 w-3.5 items-center justify-center">
                    <span
                      className={`step-mark h-2 w-2 shrink-0 rounded-full ${
                        bad ? "bg-red-500" : warn ? "bg-amber-500" : e.status === "submitted" ? "bg-green-500" : "bg-[#B9B5FF]"
                      }`}
                    />
                  </span>
                  {i < events.length - 1 && <span className="w-px flex-1 bg-[#B9B5FF]" />}
                </div>
                <div className="pb-3 min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`text-[11px] font-medium ${
                      bad ? "text-red-700" : warn ? "text-amber-700" : "text-[#0A2540]"
                    }`}>
                      {e.stage ? STEP_LABELS[e.stage] ?? e.stage : OUTCOME_LABEL[e.status] ?? e.status}
                    </span>
                    <span className="text-[10px] text-[#8792A2] tabular-nums">{time(e.createdAt)}</span>
                    {took && <span className="text-[10px] text-[#8792A2] tabular-nums">+{took}</span>}
                  </div>
                  {e.message && (
                    <p className={`mt-0.5 text-[11px] leading-snug break-words ${
                      bad ? "text-red-600" : warn ? "text-amber-700" : "text-[#425466]"
                    }`}>
                      {e.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Only when this attempt actually captured one. An attempt that failed
          before Winback Tagging, or whose upload failed, shows no section at
          all — never an empty placeholder or a broken image. */}
      {open && shot && <ScreenshotSection orderKey={shot} />}
    </div>
  );
}

/**
 * Everything known about one order's submits: the live checklist while it runs,
 * and the full attempt history underneath.
 */
export function OrderHistoryPanel({ order, onClose }: { order: OrderListItem; onClose: () => void }) {
  const [attempts, setAttempts] = useState<AttemptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch while the order is live so finished steps join the timeline.
  const live = order.status === "submitting";
  useEffect(() => {
    let active = true;
    const load = () =>
      getOrderHistory(order.id)
        .then((r) => {
          if (!active) return;
          if (r.success) setAttempts(r.attempts);
          else setError(r.error ?? "Couldn't load history.");
        })
        .catch(() => active && setError("Couldn't load history."));
    load();
    if (!live) return () => { active = false; };
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [order.id, live]);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-[70] w-full max-w-lg bg-white border-l border-[#E3E8EF] shadow-xl flex flex-col animate-fade-in-right"
      role="dialog"
      aria-modal="true"
      aria-label={`Status history for ${order.fullName}`}
    >
      <header className="flex items-start gap-3 px-5 py-4 border-b border-[#E3E8EF]">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-[#635BFF] tabular-nums">{order.reference ?? "—"}</p>
          <h2 className="text-[15px] font-semibold text-[#0A2540] truncate">{order.fullName}</h2>
          <p className="text-[11px] text-[#697386] tabular-nums">{order.idType} · {order.idNumber}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close status history"
          className="ml-auto shrink-0 rounded-md p-1.5 text-[#697386] hover:bg-[#F6F9FC] hover:text-[#0A2540] transition-colors cursor-pointer"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {needsVoiding(order) && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-[12px] font-semibold text-amber-900">Needs voiding in the portal</p>
            <p className="mt-1 text-[11px] leading-snug text-amber-800">
              Order <span className="tabular-nums font-medium">{order.orderId}</span> exists in the
              Unifi portal but never completed. Void it there so it doesn&apos;t sit as an open order.
            </p>
            <a
              href={`https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails?custOrderId=${order.orderId}&custOrderNbr=${order.orderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[11px] font-medium text-[#635BFF] hover:underline"
            >
              Open in portal →
            </a>
          </div>
        )}

        {/* Live run: the step checklist is the clearest view while it moves. */}
        {live && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8792A2]">
              Current run
            </h3>
            <div className="rounded-lg border border-[#E3E8EF] overflow-hidden">
              <SubmitProgress
                stage={order.stage}
                status={order.status}
                errorMessage={order.errorMessage}
                orderId={order.orderId}
              />
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8792A2]">
            History
          </h3>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {!error && attempts === null && (
            <p className="text-[11px] text-[#697386]">Loading…</p>
          )}
          {!error && attempts?.length === 0 && (
            <p className="text-[11px] text-[#697386]">
              {order.attempt > 0 || order.orderId
                ? "No step history was recorded — this order was submitted before status tracking existed."
                : "This draft hasn't been submitted yet."}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {attempts?.map((a, i) => (
              <Attempt key={a.attempt} a={a} defaultOpen={i === 0} />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

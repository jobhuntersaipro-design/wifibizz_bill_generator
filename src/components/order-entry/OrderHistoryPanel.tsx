"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  History,
  ListChecks,
  RotateCcw,
  X,
} from "lucide-react";
import { getOrderHistory } from "@/actions/order";
import type { AttemptView } from "@/lib/order-history";
import {
  PAGE1_SCREENSHOT_STAGE,
  SUBMIT_STEPS,
  elapsedLabel,
  formatDuration,
  heroFor,
  initialsFor,
  labelForStage,
  stepIndexForStage,
  needsVoiding,
  stepsCompleted,
  type OrderListItem,
  type RunTone,
} from "@/lib/order-types";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubmitProgress } from "./SubmitProgress";

/**
 * One colour family per run outcome, used by the hero and every accent.
 *
 * Kept as literal class strings rather than composed at runtime — Tailwind only
 * emits classes it can see in the source, so `bg-${x}` would ship as no style.
 */
const TONE: Record<RunTone, { hero: string; dot: string; chip: string; label: string }> = {
  running: { hero: "bg-[#635BFF]", dot: "bg-[#635BFF]", chip: "bg-[#EDEBFF] text-[#635BFF]", label: "Running" },
  submitted: { hero: "bg-[#0E9F6E]", dot: "bg-[#0E9F6E]", chip: "bg-green-100 text-green-700", label: "Submitted" },
  warning: { hero: "bg-[#C2740B]", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800", label: "Needs checking" },
  failed: { hero: "bg-[#D6304A]", dot: "bg-red-500", chip: "bg-red-100 text-red-700", label: "Failed" },
  draft: { hero: "bg-[#425466]", dot: "bg-[#8792A2]", chip: "bg-[#E3E8EF] text-[#425466]", label: "Draft" },
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
  return formatDuration(ms);
}

/**
 * A bordered block with a tiny icon + SMALL CAPS header.
 *
 * The single most reusable idea from the reference design: a card boundary tells
 * the eye where one idea stops, and the icon makes the label scannable without
 * reading it. Everything in the panel body is one of these.
 */
function SectionCard({
  icon: Icon,
  label,
  action,
  children,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="panel-card-in rounded-xl border border-[#E3E8EF] bg-white"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-1.5 px-4 pt-3">
        <Icon className="h-3 w-3 shrink-0 text-[#8792A2]" aria-hidden="true" />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8792A2]">
          {label}
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-4 pt-2 pb-3">{children}</div>
    </section>
  );
}

/** One of the three metrics under the hero. */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  bar,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  bar?: number;
  delay: number;
}) {
  return (
    <div
      className="panel-card-in rounded-xl border border-[#E3E8EF] bg-white px-3 py-2.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-1">
        <Icon className="h-3 w-3 shrink-0 text-[#8792A2]" aria-hidden="true" />
        <span className="truncate text-[9px] font-semibold uppercase tracking-tight text-[#8792A2] sm:tracking-[0.08em]">
          {label}
        </span>
      </div>
      <p className="mt-1 text-[17px] font-semibold leading-none tabular-nums text-[#0A2540]">
        {value}
      </p>
      {typeof bar === "number" && (
        <Progress value={bar} className="mt-2 w-full">
          <ProgressTrack className="h-1 bg-[#E3E8EF]">
            <ProgressIndicator className="bg-[#635BFF] transition-[width] duration-700 ease-out" />
          </ProgressTrack>
        </Progress>
      )}
      {sub && <p className="mt-1 truncate text-[10px] text-[#8792A2]">{sub}</p>}
    </div>
  );
}

/**
 * The R2 key of this attempt's page-1 screenshot, if it captured one.
 *
 * Read per attempt rather than off the order: a retried order has one frame per
 * attempt, and the order row only ever holds the latest.
 */
function screenshotFor(a: AttemptView): { key: string; at: string } | null {
  const e = [...a.events]
    .reverse()
    .find((x) => x.stage === PAGE1_SCREENSHOT_STAGE && x.message);
  const key = e?.message?.trim() ?? "";
  // A failed capture records its reason in the same field. Only a real key is a
  // screenshot — anything else must not become a broken <img>.
  const ok = key.startsWith("order-screenshots/") && key.endsWith(".png");
  return ok && e ? { key, at: e.createdAt } : null;
}

/**
 * The portal frame this attempt captured, shown as the LAST entry in its
 * timeline.
 *
 * It belongs to the attempt, and chronologically it happens right after Winback
 * Tagging — so it reads as "…and here is what the screen looked like at that
 * point", rather than as a separate gallery the agent has to correlate back to a
 * run by attempt number.
 */
function ShotRow({ orderKey, at }: { orderKey: string; at: string }) {
  const [loaded, setLoaded] = useState(false);
  const src = `/api/orders/screenshot?key=${encodeURIComponent(orderKey)}`;
  return (
    <li className="step-row-in flex items-start gap-3">
      <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
        <span className="flex h-4 w-3.5 items-center justify-center">
          <Camera className="h-3 w-3 shrink-0 text-[#635BFF]" aria-hidden="true" />
        </span>
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12px] font-medium text-[#0A2540]">Portal screenshot</span>
          <span className="text-[10px] tabular-nums text-[#8792A2]">{time(at)}</span>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#635BFF] transition-colors duration-150 hover:bg-[#EDEBFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            Full size <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-1.5 block cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
        >
          <div className="relative overflow-hidden rounded-lg border border-[#E3E8EF] bg-white">
            {!loaded && <Skeleton className="h-40 w-full rounded-none" />}
            {/* eslint-disable-next-line @next/next/no-img-element -- an auth-gated
                private stream, not an optimisable static asset */}
            <img
              src={src}
              alt="New Connection page as the portal rendered it"
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className={`h-40 w-full object-cover object-top transition-transform duration-300 ease-out group-hover:scale-[1.015] ${
                loaded ? "opacity-100" : "absolute inset-0 opacity-0"
              }`}
            />
          </div>
        </a>
        <p className="mt-1 text-[10px] leading-snug text-[#8792A2]">
          Order number, installation address, contact, main offer, account and
          winback tagging, as the portal rendered them.
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
  const failure = [...a.events].reverse().find(
    (e) => (e.status === "failed" || e.status === "warning") && e.message,
  );
  // The capture is an artefact of the run, not a step it passed through, so it
  // never appears as a timeline row reading out an R2 key.
  const events = foldSteps(a.events.filter((e) => e.stage !== PAGE1_SCREENSHOT_STAGE));
  const took = elapsedLabel(a.startedAt, a.endedAt);
  const shot = screenshotFor(a);

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
          {shot && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-[#EDEBFF] px-1.5 py-0.5 font-medium text-[#635BFF]"
              title="This attempt captured a portal screenshot"
            >
              <Camera className="h-3 w-3" aria-hidden="true" />
              Capture
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
        <p
          className={`px-4 pb-3 text-[11px] leading-snug ${
            a.outcome === "warning" ? "text-amber-700" : "text-red-600"
          }`}
        >
          {failure.message}
        </p>
      )}

      <CollapsibleContent className="collapse-panel" keepMounted>
        <ol className="flex flex-col border-t border-[#E3E8EF] bg-[#F6F9FC] px-4 py-3">
          {events.map((e, i) => {
            const prev = events[i - 1];
            const took = prev ? gap(prev.createdAt, e.createdAt) : "";
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
                  {i < events.length - 1 && <span className="w-px flex-1 bg-[#B9B5FF]" />}
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
          {shot && <ShotRow orderKey={shot.key} at={shot.at} />}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Everything known about one order's submits: the live checklist while it runs,
 * the full attempt history, and the portal frame each attempt captured.
 *
 * Built on shadcn's Sheet (Base UI Dialog underneath) rather than a hand-rolled
 * aside — that is what actually delivers the focus trap, focus restore, Escape
 * handling and scroll lock the previous `aria-modal="true"` only claimed.
 */
export function OrderHistoryPanel({ order, onClose }: { order: OrderListItem; onClose: () => void }) {
  const [attempts, setAttempts] = useState<AttemptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The parent mounts this panel conditionally, so unmounting on the first
  // close request would cut the exit transition off mid-slide. Close the Sheet
  // first, let it play out, THEN tell the parent to drop us.
  const [open, setOpen] = useState(true);
  const CLOSE_MS = 300; // must match data-[side=right]:duration-300 below
  const requestClose = () => {
    setOpen(false);
    setTimeout(onClose, CLOSE_MS);
  };

  const live = order.status === "submitting";

  // Refetch while the order is live so finished steps join the timeline.
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

  // A live run's elapsed time has to tick, or a frozen number reads as finished.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const hero = heroFor(order);
  const tone = TONE[hero.tone];
  const latest = attempts?.[0] ?? null;

  const stats = useMemo(() => {
    const done = latest ? stepsCompleted(latest.events.map((e) => e.stage)) : 0;
    const elapsed = latest
      ? latest.endedAt
        ? elapsedLabel(latest.startedAt, latest.endedAt)
        : formatDuration(now - new Date(latest.startedAt).getTime())
      : null;
    return { done, elapsed };
  }, [latest, now]);

  async function copyOrderNumber() {
    if (!hero.isOrderNumber) return;
    try {
      await navigator.clipboard.writeText(hero.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked by permissions; the number is still selectable.
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 border-l border-[#E3E8EF] bg-white p-0 sm:max-w-[30rem] data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=right]:duration-300"
      >
        <SheetTitle className="sr-only">Submit history for {order.fullName}</SheetTitle>
        <SheetDescription className="sr-only">
          Step-by-step progress, attempt history and portal screenshots for this order.
        </SheetDescription>

        {/* ── Header: identity as a block, not a line ─────────────────────── */}
        <header className="flex items-start gap-3 border-b border-[#E3E8EF] px-5 py-4">
          <span
            className="panel-item-in flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EDEBFF] text-[13px] font-semibold text-[#635BFF]"
            aria-hidden="true"
          >
            {initialsFor(order.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="panel-item-in truncate text-[15px] font-semibold leading-tight text-[#0A2540]"
              style={{ animationDelay: "40ms" }}
            >
              {order.fullName}
            </h2>
            <div
              className="panel-item-in mt-1 flex flex-wrap items-center gap-1.5"
              style={{ animationDelay: "80ms" }}
            >
              <Badge className="rounded-md border-0 bg-[#EDEBFF] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#635BFF] transition-colors duration-150 hover:bg-[#DEDAFF]">
                {order.reference ?? "No reference"}
              </Badge>
              <Badge className="rounded-md border-0 bg-[#F6F9FC] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#425466] transition-colors duration-150 hover:bg-[#E3E8EF]">
                {order.idType} · {order.idNumber}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close submit history"
            className="group -mr-2.5 -mt-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            <X className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {/* ── Hero: the one value an agent copies out of this panel ─────── */}
          <div
            className={`panel-card-in rounded-xl px-4 py-3.5 text-white ${tone.hero}`}
            style={{ animationDelay: "60ms" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" aria-hidden="true" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80">
                {hero.isOrderNumber ? "Customer order number" : "Submit status"}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {hero.isOrderNumber && (
                  <button
                    type="button"
                    onClick={copyOrderNumber}
                    aria-label="Copy order number"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[10px] font-medium text-white transition-colors duration-150 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
                {order.orderId && (
                  <a
                    href={`https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails?custOrderId=${order.orderId}&custOrderNbr=${order.orderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[10px] font-medium text-white transition-colors duration-150 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    Portal <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
            <p
              className={`mt-1.5 font-semibold leading-tight text-white ${
                hero.isOrderNumber
                  // A 16-digit portal number overflows a 390px card at 26px, and
                  // clipping the one value agents copy is the worst possible
                  // failure for this card. Step down and allow it to break.
                  ? "text-[21px] tabular-nums break-all sm:text-[26px]"
                  : "text-[20px] sm:text-[22px]"
              }`}
            >
              {hero.value}
            </p>
            <p className="mt-1.5 text-[11px] text-white/80">
              {tone.label}
              {order.attempt > 0 && ` · attempt ${order.attempt}`}
              {stats.elapsed && ` · ${stats.elapsed}`}
            </p>
          </div>

          {/* ── Needs voiding: too urgent to hide behind a tab ────────────── */}
          {needsVoiding(order) && (
            <div
              className="panel-item-in rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
              style={{ animationDelay: "100ms" }}
            >
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Needs voiding in the portal
              </p>
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                Order <span className="font-medium tabular-nums">{order.orderId}</span> exists in
                the Unifi portal but never completed. Void it there so it doesn&apos;t sit as an
                open order.
              </p>
            </div>
          )}

          {/* ── Three metrics, one shape ──────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              icon={ListChecks}
              label="Steps"
              value={`${stats.done}/${SUBMIT_STEPS.length}`}
              bar={(stats.done / SUBMIT_STEPS.length) * 100}
              delay={120}
            />
            <StatCard
              icon={Clock}
              label="Elapsed"
              value={stats.elapsed ?? "—"}
              sub={live ? "running" : undefined}
              delay={180}
            />
            <StatCard
              icon={RotateCcw}
              label="Attempts"
              value={String(order.attempt || 0)}
              sub={order.attempt > 1 ? "retried" : undefined}
              delay={240}
            />
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────────── */}
          <Tabs defaultValue={live ? "progress" : "history"} className="mt-1 gap-3">
            <TabsList variant="line" className="w-full justify-start gap-3 border-b border-[#E3E8EF] p-0">
              <TabsTrigger
                value="progress"
                className="min-h-10 flex-none cursor-pointer px-1 pb-2 text-[12px] text-[#697386] after:bottom-[-1px] after:bg-[#635BFF] data-active:text-[#0A2540]"
              >
                Progress
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="min-h-10 flex-none cursor-pointer px-1 pb-2 text-[12px] text-[#697386] after:bottom-[-1px] after:bg-[#635BFF] data-active:text-[#0A2540]"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                History{attempts?.length ? ` · ${attempts.length}` : ""}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="progress" className="tab-panel-in flex flex-col gap-3">
              <SectionCard icon={ListChecks} label={live ? "Current run" : "Last run"}>
                <div className="-mx-4 -mb-3">
                  <SubmitProgress
                    stage={order.stage}
                    status={order.status}
                    errorMessage={order.errorMessage}
                    orderId={order.orderId}
                  />
                </div>
              </SectionCard>
            </TabsContent>

            <TabsContent value="history" className="tab-panel-in flex flex-col gap-2">
              {error && <p className="text-[11px] text-red-600">{error}</p>}
              {!error && attempts === null && (
                <>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </>
              )}
              {!error && attempts?.length === 0 && (
                <p className="rounded-xl border border-dashed border-[#E3E8EF] px-4 py-6 text-center text-[11px] text-[#697386]">
                  {order.attempt > 0 || order.orderId
                    ? "No step history was recorded — this order was submitted before status tracking existed."
                    : "This draft hasn't been submitted yet."}
                </p>
              )}
              {attempts?.map((a, i) => (
                <Attempt key={a.attempt} a={a} defaultOpen={i === 0} delay={i * 60} />
              ))}
            </TabsContent>

          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, Copy, ExternalLink, ListChecks, RotateCcw } from "lucide-react";
import type { AttemptView } from "@/lib/order-history";
import {
  SUBMIT_STEPS,
  elapsedLabel,
  formatDuration,
  heroFor,
  needsVoiding,
  stepsCompleted,
  type OrderListItem,
} from "@/lib/order-types";
import LottieSpot from "../LottieSpot";
import { StatCard, TONE } from "./shared";

/**
 * Hero card (order number / submit status), the voiding warning, and the
 * three stat tiles — everything above the tabs. Needs the same attempt data
 * the History tab lists (for the steps-completed stat), passed in rather than
 * fetched again here.
 */
export function OrderDetailHero({
  order,
  attempts,
  live,
  now,
}: {
  order: OrderListItem;
  attempts: AttemptView[] | null;
  live: boolean;
  now: number;
}) {
  const [copied, setCopied] = useState(false);
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
    <>
      {/* ── Hero: the one value an agent copies out of this page ─────────── */}
      <div
        className={`panel-card-in relative rounded-xl px-4 py-3.5 text-white ${tone.hero}`}
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
        {/* The paid submit is the agent's payday — it gets the one
            celebratory animation in the section, played once. */}
        {/* Absolutely positioned: floating it stole layout width and made
            the 16-digit number wrap — and the number is the one value
            agents copy. The meta line below is short, so the bottom-right
            corner is reliably empty. */}
        {order.status === "submitted" && (
          <LottieSpot
            name="success"
            size={34}
            loop={false}
            className="absolute bottom-2.5 right-3"
            fallback={null}
          />
        )}
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

      {/* ── Needs voiding: too urgent to hide behind a tab ────────────────── */}
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
            {"Order "}
            <span className="font-medium tabular-nums">{order.orderId}</span>
            {" exists in the Unifi portal but never completed. Void it there so it doesn't sit as an open order."}
          </p>
        </div>
      )}

      {/* ── Three metrics, one shape ──────────────────────────────────────── */}
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
    </>
  );
}

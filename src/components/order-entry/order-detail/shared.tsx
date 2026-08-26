import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { formatDuration, type RunTone } from "@/lib/order-types";

/**
 * One colour family per run outcome, used by the hero and every accent.
 *
 * Kept as literal class strings rather than composed at runtime — Tailwind only
 * emits classes it can see in the source, so `bg-${x}` would ship as no style.
 */
export const TONE: Record<RunTone, { hero: string; dot: string; chip: string; label: string }> = {
  running: { hero: "bg-[#635BFF]", dot: "bg-[#635BFF]", chip: "bg-[#EDEBFF] text-[#635BFF]", label: "Running" },
  submitted: { hero: "bg-[#0E9F6E]", dot: "bg-[#0E9F6E]", chip: "bg-green-100 text-green-700", label: "Submitted" },
  warning: { hero: "bg-[#C2740B]", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800", label: "Needs checking" },
  failed: { hero: "bg-[#D6304A]", dot: "bg-red-500", chip: "bg-red-100 text-red-700", label: "Failed" },
  draft: { hero: "bg-[#425466]", dot: "bg-[#8792A2]", chip: "bg-[#E3E8EF] text-[#425466]", label: "Draft" },
  cancelled: { hero: "bg-[#697386]", dot: "bg-[#8792A2]", chip: "bg-[#E3E8EF] text-[#697386]", label: "Cancelled" },
};

export const OUTCOME_LABEL: Record<string, string> = {
  submitted: "Submitted",
  order_entered: "Order entered",
  warning: "Needs checking",
  failed: "Failed",
  submitting: "Running",
};

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** Seconds between two events, for the per-step timings. */
export function gap(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 1000) return "";
  return formatDuration(ms);
}

/**
 * A bordered block with a tiny icon + SMALL CAPS header.
 *
 * The single most reusable idea from the reference design: a card boundary tells
 * the eye where one idea stops, and the icon makes the label scannable without
 * reading it. Everything in the detail view body is one of these.
 */
export function SectionCard({
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
export function StatCard({
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

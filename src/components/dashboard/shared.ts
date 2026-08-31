import { useEffect, useState, useRef } from "react";

// ── Types ──

export interface AnalyticsData {
  totalCases: number;
  byStatus: { name: string; value: number }[];
  byProvider: { name: string; value: number }[];
  timeSeriesByStatus: Record<string, string | number>[];
  statusKeys: string[];
  byState: { name: string; value: number }[];
  allStatuses: string[];
  allProviders: string[];
  allPackages: string[];
}

export interface StateDetail {
  total: number;
  byStatus: { name: string; value: number }[];
  byProvider: { name: string; value: number }[];
  byPackage: { name: string; value: number }[];
}

export interface CaseRow {
  case_no: string;
  case_url: string | null;
  full_name: string | null;
  full_address: string | null;
  mobile: string | null;
  email: string | null;
  id_no: string | null;
  provider: string | null;
  package: string | null;
  order_no: string | null;
  agent: string | null;
  agent_remark: string | null;
  status: string | null;
  internet_bill_url: string | null;
  utility_bill_url: string | null;
  case_created_at: string | null;
  updated_at: string | null;
}

export type SortDir = "asc" | "desc";

export interface SortState {
  column: string;
  dir: SortDir;
}

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

// ── Constants ──

export const PAGE_SIZE = 10;

export const STATUS_COLORS: Record<string, string> = {
  Activated: "#09825D",
  Processed: "#3B82F6",
  Pending: "#D97706",
  Rejected: "#DF1B41",
  Cancelled: "#697386",
};

export const PIE_COLORS = ["#635BFF", "#09825D", "#3B82F6", "#D97706", "#DF1B41", "#8B5CF6", "#697386"];

export const STATUS_STYLES: Record<string, string> = {
  Activated: "bg-emerald-50 text-[#09825D] ring-emerald-600/10",
  Processed: "bg-blue-50 text-blue-700 ring-blue-600/10",
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/10",
  Rejected: "bg-red-50 text-[#DF1B41] ring-red-600/10",
  Cancelled: "bg-gray-50 text-[#697386] ring-gray-500/10",
};

export const COLUMNS: { key: string; label: string; hideOnMobile?: boolean }[] = [
  { key: "case_no", label: "Case No." },
  { key: "order_no", label: "Order ID", hideOnMobile: true },
  { key: "status", label: "Status" },
  { key: "full_name", label: "Full Name" },
  { key: "full_address", label: "Full Address", hideOnMobile: true },
  { key: "mobile", label: "Mobile" },
  { key: "provider", label: "Provider", hideOnMobile: true },
  { key: "package", label: "Package", hideOnMobile: true },
  { key: "agent_remark", label: "Agent Remark", hideOnMobile: true },
  { key: "case_created_at", label: "Created At" },
  { key: "updated_at", label: "Updated At", hideOnMobile: true },
];

export const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export const DATE_RANGE_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "1m", label: "Last 1 Month" },
  { value: "3m", label: "Last 3 Months" },
  { value: "12m", label: "Last 12 Months" },
];

// ── Helpers ──

export function dateRangeToDates(preset: string): { from: string; to: string } {
  if (!preset) return { from: "", to: "" };
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const d = new Date(now);
  switch (preset) {
    case "today": break;
    case "3d": d.setDate(d.getDate() - 3); break;
    case "7d": d.setDate(d.getDate() - 7); break;
    case "1m": d.setMonth(d.getMonth() - 1); break;
    case "3m": d.setMonth(d.getMonth() - 3); break;
    case "12m": d.setFullYear(d.getFullYear() - 1); break;
    default: return { from: "", to: "" };
  }
  return { from: d.toISOString().split("T")[0], to };
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getStatusStyle(status: string | null): string {
  if (!status) return "bg-gray-50 text-[#697386] ring-gray-400/10";
  return STATUS_STYLES[status] ?? "bg-violet-50 text-violet-700 ring-violet-600/10";
}

export function formatPeriodLabel(period: string, granularity: Granularity): string {
  if (granularity === "month") {
    const [y, m] = period.split("-");
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }
  if (granularity === "day") {
    const parts = period.split("-");
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${parseInt(parts[2], 10)} ${names[parseInt(parts[1], 10) - 1]}`;
  }
  if (granularity === "week") {
    const match = period.match(/^(\d{4})-W(\d{1,2})$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const week = parseInt(match[2], 10);
      const jan4 = new Date(year, 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const monday = new Date(jan4);
      monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fmt = (d: Date) => `${d.getDate()} ${months[d.getMonth()]}`;
      return `${fmt(monday)} – ${fmt(sunday)}`;
    }
    return period.replace(/^\d{4}-/, "");
  }
  if (granularity === "quarter") {
    return period;
  }
  return period;
}

export function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max) + "..." : label;
}

// Status-based heat color palettes (light to dark)
const HEAT_PALETTES: Record<string, string[]> = {
  Activated: ["#DCFCE7", "#86EFAC", "#4ADE80", "#09825D"],
  Processed: ["#DBEAFE", "#93C5FD", "#60A5FA", "#3B82F6"],
  Pending: ["#FEF3C7", "#FDE68A", "#FBBF24", "#D97706"],
  Rejected: ["#FEE2E2", "#FCA5A5", "#F87171", "#DF1B41"],
  Cancelled: ["#F3F4F6", "#D1D5DB", "#9CA3AF", "#697386"],
  "Follow Up": ["#EDE9FE", "#C4B5FD", "#A78BFA", "#8B5CF6"],
};
const DEFAULT_HEAT_PALETTE = ["#DEDCFF", "#B8B4FF", "#8B85FF", "#635BFF"];

export function getHeatColor(value: number, max: number, status?: string): string {
  if (max === 0 || value === 0) return "#F6F9FC";
  const palette = (status && HEAT_PALETTES[status]) || DEFAULT_HEAT_PALETTE;
  const intensity = value / max;
  if (intensity > 0.7) return palette[3];
  if (intensity > 0.4) return palette[2];
  if (intensity > 0.15) return palette[1];
  return palette[0];
}

export function getHeatLegendColors(status?: string): string[] {
  const palette = (status && HEAT_PALETTES[status]) || DEFAULT_HEAT_PALETTE;
  return ["#F6F9FC", palette[0], palette[1], palette[2], palette[3]];
}

export function getStatusColor(status: string, index: number): string {
  return STATUS_COLORS[status] ?? PIE_COLORS[index % PIE_COLORS.length];
}

// ── Animated Counter Hook ──

export function useAnimatedCounter(target: number, duration: number = 600): number {
  const [count, setCount] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    prevTarget.current = target;
    // A counting number is motion. Reduced motion (or a browser without
    // matchMedia, e.g. a test runner) gets the final value at once.
    if (
      typeof window === "undefined" ||
      !window.matchMedia ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // Deferred a frame for the same reason the animated path always was:
      // a synchronous setState inside an effect cascades renders.
      const raf = requestAnimationFrame(() => setCount(target));
      return () => cancelAnimationFrame(raf);
    }
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [target, duration]);

  return count;
}

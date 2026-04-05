"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LabelList,
} from "recharts";
import type { LabelProps, PieLabelRenderProps } from "recharts";
import { MALAYSIA_SVG_PATHS, MALAYSIA_STATE_LABELS } from "@/lib/malaysia-map-data";

// ── Types ──

interface AnalyticsData {
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

interface StateDetail {
  total: number;
  byStatus: { name: string; value: number }[];
  byProvider: { name: string; value: number }[];
  byPackage: { name: string; value: number }[];
}

interface CaseRow {
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
  case_created_at: string | null;
  updated_at: string | null;
}

type SortDir = "asc" | "desc";

interface SortState {
  column: string;
  dir: SortDir;
}

type Granularity = "day" | "week" | "month" | "quarter" | "year";

// ── Constants ──

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<string, string> = {
  Activated: "#09825D",
  Processed: "#3B82F6",
  Pending: "#D97706",
  Rejected: "#DF1B41",
  Cancelled: "#697386",
};

const PIE_COLORS = ["#635BFF", "#09825D", "#3B82F6", "#D97706", "#DF1B41", "#8B5CF6", "#697386"];

const STATUS_STYLES: Record<string, string> = {
  Activated: "bg-emerald-50 text-[#09825D] ring-emerald-600/10",
  Processed: "bg-blue-50 text-blue-700 ring-blue-600/10",
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/10",
  Rejected: "bg-red-50 text-[#DF1B41] ring-red-600/10",
  Cancelled: "bg-gray-50 text-[#697386] ring-gray-500/10",
};

const COLUMNS: { key: string; label: string; hideOnMobile?: boolean }[] = [
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

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];


const DATE_RANGE_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "1m", label: "Last 1 Month" },
  { value: "3m", label: "Last 3 Months" },
  { value: "12m", label: "Last 12 Months" },
];

function dateRangeToDates(preset: string): { from: string; to: string } {
  if (!preset) return { from: "", to: "" };
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const d = new Date(now);
  switch (preset) {
    case "today": break; // from = today
    case "3d": d.setDate(d.getDate() - 3); break;
    case "7d": d.setDate(d.getDate() - 7); break;
    case "1m": d.setMonth(d.getMonth() - 1); break;
    case "3m": d.setMonth(d.getMonth() - 3); break;
    case "12m": d.setFullYear(d.getFullYear() - 1); break;
    default: return { from: "", to: "" };
  }
  return { from: d.toISOString().split("T")[0], to };
}

// ── Helpers ──

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getStatusStyle(status: string | null): string {
  if (!status) return "bg-gray-50 text-[#697386] ring-gray-400/10";
  return STATUS_STYLES[status] ?? "bg-violet-50 text-violet-700 ring-violet-600/10";
}

function formatPeriodLabel(period: string, granularity: Granularity): string {
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
    return period.replace(/^\d{4}-/, "");
  }
  if (granularity === "quarter") {
    return period;
  }
  return period;
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max) + "..." : label;
}

function getHeatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return "#F6F9FC";
  const intensity = value / max;
  if (intensity > 0.7) return "#635BFF";
  if (intensity > 0.4) return "#8B85FF";
  if (intensity > 0.15) return "#B8B4FF";
  return "#DEDCFF";
}

function getStatusColor(status: string, index: number): string {
  return STATUS_COLORS[status] ?? PIE_COLORS[index % PIE_COLORS.length];
}

// ── Main Component ──

export default function DashboardPage() {
  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Chart filter state
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [chartProvider, setChartProvider] = useState("");
  const [timeSeriesLoading, setTimeSeriesLoading] = useState(false);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set());

  // Map filter state
  const [mapStatus, setMapStatus] = useState("Activated");
  const [mapDateRange, setMapDateRange] = useState(""); // preset key or ""
  const [mapDateFrom, setMapDateFrom] = useState("");
  const [mapDateTo, setMapDateTo] = useState("");
  const [mapProvider, setMapProvider] = useState("");
  const [mapPackage, setMapPackage] = useState("");
  const [mapLoading, setMapLoading] = useState(false);

  // State detail panel
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [stateDetail, setStateDetail] = useState<StateDetail | null>(null);
  const [stateDetailLoading, setStateDetailLoading] = useState(false);

  // Case list state
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [sort, setSort] = useState<SortState>({ column: "case_created_at", dir: "desc" });
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch analytics (initial load — state map defaults to Activated)
  useEffect(() => {
    const emptyAnalytics: AnalyticsData = {
      totalCases: 0, byStatus: [], byProvider: [], timeSeriesByStatus: [],
      statusKeys: [], byState: [], allStatuses: [], allProviders: [], allPackages: [],
    };
    fetch(`/api/cases/analytics?granularity=${granularity}&state_status=Activated`)
      .then((res) => res.json())
      .then((data) => setAnalytics(data.byStatus ? data : emptyAnalytics))
      .catch(() => setAnalytics(emptyAnalytics))
      .finally(() => setAnalyticsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch time series when chart filters change
  useEffect(() => {
    if (analyticsLoading) return;
    setTimeSeriesLoading(true);
    const params = new URLSearchParams({ granularity });
    if (chartProvider) params.set("chart_provider", chartProvider);

    fetch(`/api/cases/analytics?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.timeSeriesByStatus) {
          setAnalytics((prev) =>
            prev ? { ...prev, timeSeriesByStatus: data.timeSeriesByStatus, statusKeys: data.statusKeys } : prev
          );
        }
      })
      .finally(() => setTimeSeriesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, chartProvider]);

  // Refetch state map data when map filters change
  useEffect(() => {
    if (analyticsLoading) return;
    setMapLoading(true);
    setSelectedState(null); // close detail panel on filter change
    const params = new URLSearchParams();
    if (mapStatus) params.set("state_status", mapStatus);
    if (mapDateFrom) params.set("state_date_from", mapDateFrom);
    if (mapDateTo) params.set("state_date_to", mapDateTo);
    if (mapProvider) params.set("state_provider", mapProvider);
    if (mapPackage) params.set("state_package", mapPackage);

    fetch(`/api/cases/analytics?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.byState) {
          setAnalytics((prev) =>
            prev ? { ...prev, byState: data.byState } : prev
          );
        }
      })
      .finally(() => setMapLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStatus, mapDateFrom, mapDateTo, mapProvider, mapPackage]);

  // Fetch state detail when a state is selected
  useEffect(() => {
    if (!selectedState) { setStateDetail(null); return; }
    setStateDetailLoading(true);
    const params = new URLSearchParams({ state: selectedState });
    if (mapStatus) params.set("status", mapStatus);
    if (mapDateFrom) params.set("date_from", mapDateFrom);
    if (mapDateTo) params.set("date_to", mapDateTo);
    if (mapProvider) params.set("provider", mapProvider);
    if (mapPackage) params.set("package", mapPackage);

    fetch(`/api/cases/analytics/state?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.total !== undefined) setStateDetail(data);
      })
      .catch(() => setStateDetail(null))
      .finally(() => setStateDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState]);

  // Fetch cases
  const fetchCases = useCallback(async () => {
    setCasesLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort_by: sort.column,
      sort_dir: sort.dir,
    });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    const res = await fetch(`/api/cases?${params}`);
    const json = await res.json();
    setCases(json.data ?? []);
    setCount(json.count ?? 0);
    if (json.statuses) setStatuses(json.statuses);
    setCasesLoading(false);
  }, [page, search, status, dateFrom, dateTo, sort]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      setSearch(value);
    }, 300);
  }

  function handleSort(column: string) {
    setSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === "desc" ? "asc" : "desc",
    }));
    setPage(0);
  }

  function toggleStatusLegend(statusName: string) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(statusName)) next.delete(statusName);
      else next.add(statusName);
      return next;
    });
  }

  const totalPages = Math.ceil(count / PAGE_SIZE);
  const showingFrom = count === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, count);
  const hasFilters = search || status || dateFrom || dateTo;
  const activatedCount = analytics?.byStatus.find((s) => s.name === "Activated")?.value ?? 0;
  // Build state map for the SVG — merge KL/Putrajaya into Selangor since SVG lacks separate paths
  const stateMap = new Map(analytics?.byState.map((s) => [s.name, s.value]) ?? []);
  if (stateMap.has("Kuala Lumpur") || stateMap.has("Putrajaya")) {
    const sgrVal = (stateMap.get("Selangor") ?? 0) + (stateMap.get("Kuala Lumpur") ?? 0) + (stateMap.get("Putrajaya") ?? 0);
    stateMap.set("Selangor", sgrVal);
  }
  const maxStateValue = stateMap.size ? Math.max(...stateMap.values()) : 0;
  const hasChartFilters = !!chartProvider;
  const mapHasFilters = mapStatus !== "Activated" || mapDateFrom || mapDateTo || mapDateRange || mapProvider || mapPackage;

  function clearMapFilters() {
    setMapStatus("Activated");
    setMapDateRange("");
    setMapDateFrom("");
    setMapDateTo("");
    setMapProvider("");
    setMapPackage("");
    setSelectedState(null);
  }

  function handleMapDatePreset(preset: string) {
    setMapDateRange(preset);
    const { from, to } = dateRangeToDates(preset);
    setMapDateFrom(from);
    setMapDateTo(to);
  }

  function handleMapDateFrom(value: string) {
    setMapDateRange(""); // custom range
    setMapDateFrom(value);
  }

  function handleMapDateTo(value: string) {
    setMapDateRange(""); // custom range
    setMapDateTo(value);
  }

  function handleStateClick(stateName: string) {
    setSelectedState((prev) => (prev === stateName ? null : stateName));
  }

  // Prepare time series data with formatted labels
  const chartData = analytics?.timeSeriesByStatus.map((d) => ({
    ...d,
    label: formatPeriodLabel(d.period as string, granularity),
  }));

  // Visible status keys (not hidden by legend)
  const visibleStatuses = (analytics?.statusKeys ?? []).filter((s) => !hiddenStatuses.has(s));

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Dashboard</h1>
        <p className="text-sm text-[#697386] mt-1">Analytics overview and case management</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KpiCard label="Total Cases" value={analyticsLoading ? "—" : String(analytics?.totalCases ?? 0)} icon={<FileStackIcon className="w-4 h-4" />} />
        <KpiCard label="Activated" value={analyticsLoading ? "—" : String(activatedCount)} icon={<CheckCircleIcon className="w-4 h-4" />} accent="text-[#09825D]" />
        <KpiCard label="Statuses" value={analyticsLoading ? "—" : String(analytics?.byStatus.length ?? 0)} icon={<TagIcon className="w-4 h-4" />} />
        <KpiCard label="Providers" value={analyticsLoading ? "—" : String(analytics?.byProvider.length ?? 0)} icon={<GlobeIcon className="w-4 h-4" />} />
      </div>

      {/* Cases Over Time — multi-series with status legend */}
      <div className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift">
          <div className="px-5 pt-5 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#0A2540]">Cases Over Time</h3>
                <p className="text-xs text-[#697386] mt-0.5">
                  Case creation trend by {granularity}
                  {hasChartFilters && " (filtered)"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Provider filter */}
                <select
                  className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[160px]"
                  value={chartProvider}
                  onChange={(e) => setChartProvider(e.target.value)}
                >
                  <option value="">All Providers</option>
                  {(analytics?.allProviders ?? []).map((p) => (
                    <option key={p} value={p}>{truncateLabel(p, 30)}</option>
                  ))}
                </select>

                {hasChartFilters && (
                  <button
                    className="text-[11px] text-[#DF1B41] hover:underline"
                    onClick={() => setChartProvider("")}
                  >
                    Clear
                  </button>
                )}

                {/* Granularity toggle */}
                <div className="flex items-center bg-[#F6F9FC] rounded-md p-0.5 border border-[#E3E8EF]">
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-all ${
                        granularity === opt.value
                          ? "bg-white text-[#0A2540] shadow-sm"
                          : "text-[#697386] hover:text-[#425466]"
                      }`}
                      onClick={() => setGranularity(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Interactive status legend */}
          {analytics && analytics.statusKeys.length > 0 && (
            <div className="px-5 pb-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {analytics.statusKeys.map((s, i) => (
                <button
                  key={s}
                  className={`flex items-center gap-1.5 transition-opacity duration-200 ${hiddenStatuses.has(s) ? "opacity-30" : "opacity-100"}`}
                  onClick={() => toggleStatusLegend(s)}
                  title={`Click to ${hiddenStatuses.has(s) ? "show" : "hide"} ${s}`}
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getStatusColor(s, i) }} />
                  <span className="text-[11px] text-[#697386] select-none">{s}</span>
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pb-5">
            {analyticsLoading || timeSeriesLoading ? (
              <ChartSkeleton />
            ) : !chartData || chartData.length === 0 ? (
              <EmptyChart message={hasChartFilters ? "No data for selected filters" : "No data available"} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    {visibleStatuses.map((s, i) => (
                      <linearGradient key={s} id={`areaGrad-${s}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={getStatusColor(s, i)} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={getStatusColor(s, i)} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #E3E8EF", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                    labelStyle={{ fontWeight: 600, color: "#0A2540" }}
                  />
                  {visibleStatuses.map((s, i) => {
                    const color = getStatusColor(s, i);
                    return (
                      <Area
                        key={s}
                        type="monotone"
                        dataKey={s}
                        name={s}
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#areaGrad-${s})`}
                        dot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }}
                        activeDot={{ r: 6.5 }}
                        label={(props: LabelProps) => {
                          const px = Number(props.x ?? 0);
                          const py = Number(props.y ?? 0);
                          const val = Number(props.value ?? 0);
                          if (!val) return <g />;
                          return (
                            <text x={px} y={py - 14} textAnchor="middle" fontSize={12} fontWeight={700} paintOrder="stroke" stroke="#fff" strokeWidth={3} fill={color}>
                              {val}
                            </text>
                          );
                        }}
                      />
                    );
                  })}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Cases by State — Full Width with Filters */}
      <div className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift">
          <div className="px-5 pt-5 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#0A2540]">Cases by State</h3>
                <p className="text-xs text-[#697386] mt-0.5">
                  Geographic distribution across Malaysia
                  {mapHasFilters && " (filtered)"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#697386]">
                <span>Low</span>
                <div className="flex gap-0.5">
                  {["#F6F9FC", "#DEDCFF", "#B8B4FF", "#8B85FF", "#635BFF"].map((c) => (
                    <div key={c} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span>High</span>
              </div>
            </div>

            {/* Map filters row */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select
                className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all"
                value={mapStatus}
                onChange={(e) => setMapStatus(e.target.value)}
              >
                <option value="">All Statuses</option>
                {(analytics?.allStatuses ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <select
                className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[160px]"
                value={mapProvider}
                onChange={(e) => setMapProvider(e.target.value)}
              >
                <option value="">All Providers</option>
                {(analytics?.allProviders ?? []).map((p) => (
                  <option key={p} value={p}>{truncateLabel(p, 28)}</option>
                ))}
              </select>

              <select
                className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[200px]"
                value={mapPackage}
                onChange={(e) => setMapPackage(e.target.value)}
              >
                <option value="">All Packages</option>
                {(analytics?.allPackages ?? []).map((p) => (
                  <option key={p} value={p}>{truncateLabel(p, 35)}</option>
                ))}
              </select>

              <div className="h-5 w-px bg-[#E3E8EF]" />

              <select
                className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all"
                value={mapDateRange}
                onChange={(e) => handleMapDatePreset(e.target.value)}
              >
                {DATE_RANGE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all"
                  value={mapDateFrom}
                  onChange={(e) => handleMapDateFrom(e.target.value)}
                  placeholder="From"
                />
                <span className="text-[10px] text-[#697386]">to</span>
                <input
                  type="date"
                  className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all"
                  value={mapDateTo}
                  onChange={(e) => handleMapDateTo(e.target.value)}
                />
              </div>

              {mapHasFilters && (
                <button
                  className="h-7 px-2.5 rounded-md text-[11px] font-medium text-[#697386] bg-[#F6F9FC] border border-[#E3E8EF] hover:bg-[#EDF0F4] hover:text-[#425466] transition-all"
                  onClick={clearMapFilters}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="px-4 pb-5 relative">
            {analyticsLoading ? (
              <ChartSkeleton />
            ) : analytics?.byState.length === 0 && !mapLoading ? (
              <EmptyChart message="No state data available" />
            ) : (
              <div className="relative">
                {mapLoading && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-lg transition-opacity duration-200">
                    <div className="flex items-center gap-2 text-[#697386]">
                      <svg className="animate-spin h-4 w-4 text-[#635BFF]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-[11px] font-medium">Updating map...</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-6">
                  {/* SVG Map */}
                  <div className="flex-1">
                    <MalaysiaMap
                      stateData={stateMap}
                      maxValue={maxStateValue}
                      selectedState={selectedState}
                      onStateClick={handleStateClick}
                    />
                  </div>

                  {/* State ranking list */}
                  <div className="w-[200px] shrink-0">
                    <p className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-2">Top States</p>
                    <div className="space-y-2">
                      {analytics?.byState.slice(0, 8).map((state, i) => (
                        <div
                          key={state.name}
                          className={`flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-colors ${selectedState === state.name ? "bg-[#F0EEFF]" : "hover:bg-[#F6F9FC]"}`}
                          onClick={() => handleStateClick(state.name)}
                        >
                          <span className="text-[10px] font-semibold text-[#697386] w-3 tabular-nums">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-[#0A2540] truncate">{state.name}</span>
                              <span className="text-[11px] font-semibold text-[#0A2540] tabular-nums ml-2">{state.value}</span>
                            </div>
                            <div className="h-1 bg-[#F6F9FC] rounded-full mt-1 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#635BFF] transition-all duration-500"
                                style={{ width: `${maxStateValue > 0 ? (state.value / maxStateValue) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* State detail panel */}
                {selectedState && (
                  <div className="mt-4 border-t border-[#E3E8EF] pt-4 animate-fade-in-up">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#635BFF]" />
                        <h4 className="text-sm font-semibold text-[#0A2540]">{selectedState}</h4>
                        {stateDetailLoading ? (
                          <svg className="animate-spin h-3.5 w-3.5 text-[#635BFF]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <span className="text-xs text-[#697386] tabular-nums">{stateDetail?.total ?? 0} cases</span>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedState(null)}
                        className="text-[11px] text-[#697386] hover:text-[#0A2540] transition-colors"
                      >
                        Close
                      </button>
                    </div>

                    {!stateDetailLoading && stateDetail && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* By Status */}
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Status</p>
                          {stateDetail.byStatus.length === 0 ? (
                            <p className="text-[11px] text-[#697386]">No data</p>
                          ) : (
                            <div className="space-y-1.5">
                              {stateDetail.byStatus.map((s) => (
                                <div key={s.name} className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.name] ?? "#697386" }} />
                                    <span className="text-[11px] text-[#425466]">{s.name}</span>
                                  </div>
                                  <span className="text-[11px] font-semibold text-[#0A2540] tabular-nums">{s.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* By Provider */}
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Provider</p>
                          {stateDetail.byProvider.length === 0 ? (
                            <p className="text-[11px] text-[#697386]">No data</p>
                          ) : (
                            <div className="space-y-1.5">
                              {stateDetail.byProvider.map((p, i) => (
                                <div key={p.name} className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                    <span className="text-[11px] text-[#425466] truncate max-w-[140px]">{p.name}</span>
                                  </div>
                                  <span className="text-[11px] font-semibold text-[#0A2540] tabular-nums">{p.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* By Package */}
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Package</p>
                          {stateDetail.byPackage.length === 0 ? (
                            <p className="text-[11px] text-[#697386]">No data</p>
                          ) : (
                            <div className="space-y-1.5">
                              {stateDetail.byPackage.map((p, i) => (
                                <div key={p.name} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[(i + 3) % PIE_COLORS.length] }} />
                                    <span className="text-[11px] text-[#425466] truncate">{p.name}</span>
                                  </div>
                                  <span className="text-[11px] font-semibold text-[#0A2540] tabular-nums shrink-0">{p.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row: Status + Provider */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Status Breakdown — Donut Chart */}
        <div className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
          <ChartCard title="By Status" subtitle="Case distribution by status">
            {analyticsLoading ? (
              <ChartSkeleton />
            ) : analytics?.byStatus.length === 0 ? (
              <EmptyChart message="No data available" />
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={analytics?.byStatus}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                      label={(props: PieLabelRenderProps) => {
                        const { cx, cy, midAngle, outerRadius, value } = props;
                        const RADIAN = Math.PI / 180;
                        const radius = (outerRadius as number) + 16;
                        const x = (cx as number) + radius * Math.cos(-(midAngle as number) * RADIAN);
                        const y = (cy as number) + radius * Math.sin(-(midAngle as number) * RADIAN);
                        return (
                          <text x={x} y={y} textAnchor={x > (cx as number) ? "start" : "end"} dominantBaseline="central" fontSize={10} fontWeight={600} fill="#425466">
                            {value}
                          </text>
                        );
                      }}
                    >
                      {analytics?.byStatus.map((entry, index) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E3E8EF", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                  {analytics?.byStatus.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[entry.name] ?? PIE_COLORS[index % PIE_COLORS.length] }} />
                      <span className="text-[11px] text-[#697386]">{entry.name} ({entry.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>
        </div>

        {/* By Provider */}
        <div className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <ChartCard title="By Provider" subtitle="Cases per internet provider">
            {analyticsLoading ? (
              <ChartSkeleton />
            ) : analytics?.byProvider.length === 0 ? (
              <EmptyChart message="No data available" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={analytics?.byProvider.map((p) => ({ ...p, label: truncateLabel(p.name, 22) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} width={140} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E3E8EF", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} labelStyle={{ fontWeight: 600, color: "#0A2540" }} formatter={(value) => [String(value), "Cases"]} />
                  <Bar dataKey="value" fill="#635BFF" radius={[0, 4, 4, 0]} barSize={20}>
                    <LabelList dataKey="value" position="right" style={{ fontSize: 11, fontWeight: 600, fill: "#0A2540" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Case List Section */}
      <div className="space-y-4">
        <div className="animate-fade-in-up" style={{ animationDelay: "500ms" }}>
          <h2 className="text-lg font-semibold text-[#0A2540]">Case List</h2>
          <p className="text-sm text-[#697386] mt-0.5">{count} case{count !== 1 ? "s" : ""} in total</p>
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-lg border border-[#E3E8EF] p-4 animate-fade-in-up" style={{ animationDelay: "550ms" }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] max-w-sm relative group">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#697386] transition-colors group-focus-within:text-[#635BFF]" />
              <Input placeholder="Search name, case no, mobile, provider..." defaultValue="" onChange={(e) => handleSearchChange(e.target.value)} className="pl-9 h-9 bg-[#F6F9FC] border-[#E3E8EF] rounded-lg text-sm text-[#0A2540] placeholder:text-[#697386] focus:bg-white focus:border-[#635BFF] transition-all" />
            </div>
            <select className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
              <option value="">All Statuses</option>
              {statuses.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium">From</label>
              <input type="date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none" value={dateFrom} onChange={(e) => { setPage(0); setDateFrom(e.target.value); }} />
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium">To</label>
              <input type="date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none" value={dateTo} onChange={(e) => { setPage(0); setDateTo(e.target.value); }} />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="text-xs rounded-lg text-[#DF1B41] hover:bg-red-50 hover:text-[#DF1B41] transition-colors" onClick={() => { setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(0); }}>
                Clear all
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden animate-fade-in-up" style={{ animationDelay: "600ms" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E3E8EF]">
                  {COLUMNS.map((col) => (
                    <th key={col.key} className={`px-4 py-3 text-left text-[11px] font-semibold text-[#697386] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-[#0A2540] transition-colors ${col.hideOnMobile ? "hidden lg:table-cell" : ""}`} onClick={() => handleSort(col.key)}>
                      <span className="inline-flex items-center gap-1">{col.label}<SortIcon column={col.key} sort={sort} /></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E8EF]/60">
                {casesLoading ? (
                  <tr><td colSpan={COLUMNS.length} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-3"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" /><span className="text-sm text-[#697386]">Loading cases...</span></div></td></tr>
                ) : cases.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-2"><div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-2"><EmptyIcon className="w-5 h-5 text-[#697386]" /></div><p className="text-sm font-medium text-[#0A2540]">No cases found</p><p className="text-xs text-[#697386]">{hasFilters ? "Try adjusting your filters" : "Run a crawl to get started"}</p></div></td></tr>
                ) : (
                  cases.map((c) => (
                    <tr key={c.case_no} className={`hover:bg-[#F6F9FC] transition-colors duration-100 cursor-pointer ${selectedCase?.case_no === c.case_no ? "bg-[#F6F9FC]" : ""}`} onClick={() => setSelectedCase(c)}>
                      <td className="px-4 py-3 text-[13px] tabular-nums whitespace-nowrap">
                        {c.case_url ? (<a href={c.case_url} target="_blank" rel="noopener noreferrer" className="text-[#635BFF] font-medium hover:underline transition-colors" onClick={(e) => e.stopPropagation()}>{c.case_no}</a>) : (<span className="font-medium text-[#425466]">{c.case_no}</span>)}
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap hidden lg:table-cell"><span className="block truncate max-w-[140px] text-[#425466]">{c.order_no || "—"}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(c.status)}`}>{c.status ?? "Unknown"}</span></td>
                      <td className="px-4 py-3"><span className="block truncate max-w-[160px] text-[13px] font-medium text-[#0A2540]">{c.full_name || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[180px] text-[13px] text-[#697386]">{c.full_address || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#425466] tabular-nums whitespace-nowrap">{c.mobile || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[140px] text-[13px] text-[#425466]">{c.provider || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[160px] text-[13px] text-[#425466]">{c.package || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[160px] text-[13px] text-[#697386]">{c.agent_remark || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap">{formatDateTime(c.case_created_at)}</td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap hidden lg:table-cell">{formatDateTime(c.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E3E8EF] bg-[#F6F9FC]">
            <span className="text-xs text-[#697386]">Showing{" "}<span className="font-medium text-[#0A2540] tabular-nums">{showingFrom}–{showingTo}</span>{" "}of <span className="font-medium text-[#0A2540] tabular-nums">{count}</span> cases</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-8 px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]">Previous</Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) pageNum = i;
                else if (page < 3) pageNum = i;
                else if (page > totalPages - 4) pageNum = totalPages - 5 + i;
                else pageNum = page - 2 + i;
                return (
                  <Button key={pageNum} variant={pageNum === page ? "default" : "outline"} size="sm" className={`h-8 w-8 p-0 text-xs rounded-md tabular-nums ${pageNum === page ? "bg-[#635BFF] text-white border-[#635BFF]" : "border-[#E3E8EF] text-[#425466]"}`} onClick={() => setPage(pageNum)}>{pageNum + 1}</Button>
                );
              })}
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="h-8 px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]">Next</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-in detail panel */}
      {selectedCase && createPortal(
        <CaseDetailPanel caseData={selectedCase} onClose={() => setSelectedCase(null)} />,
        document.body
      )}
    </div>
  );
}

// ── Malaysia SVG Map ──

function MalaysiaMap({ stateData, maxValue, selectedState, onStateClick }: {
  stateData: Map<string, number>;
  maxValue: number;
  selectedState?: string | null;
  onStateClick?: (name: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ name: string; value: number; x: number; y: number } | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: React.MouseEvent, name: string) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredState(name);
    setTooltip({
      name,
      value: stateData.get(name) ?? 0,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleMouseLeave() {
    setHoveredState(null);
    setTooltip(null);
  }

  return (
    <div ref={containerRef} className="relative">
      <svg viewBox="-5 -5 802 275" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Sea background */}
        <rect x="-5" y="-5" width="802" height="275" fill="#F8FAFC" rx="8" />

        {/* Water label */}
        <text x="330" y="140" textAnchor="middle" fontSize="9" fill="#CBD5E1" fontStyle="italic" className="select-none">South China Sea</text>

        {/* State paths */}
        {Object.entries(MALAYSIA_SVG_PATHS).map(([name, path]) => {
          const val = stateData.get(name) ?? 0;
          const color = getHeatColor(val, maxValue);
          const isHovered = hoveredState === name;
          const isSelected = selectedState === name;
          return (
            <path
              key={name}
              d={path}
              fill={color}
              stroke={isSelected ? "#0A2540" : isHovered ? "#635BFF" : "#C8CDD3"}
              strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 0.8}
              strokeLinejoin="round"
              className="transition-colors duration-200 cursor-pointer"
              style={{ filter: isHovered && !isSelected ? "brightness(0.92)" : undefined }}
              onMouseMove={(e) => handleMouseMove(e, name)}
              onMouseLeave={handleMouseLeave}
              onClick={() => onStateClick?.(name)}
            />
          );
        })}

        {/* State labels with case count */}
        {MALAYSIA_STATE_LABELS.map(({ name, abbr, x, y }) => {
          const val = stateData.get(name) ?? 0;
          const isLight = val === 0 || maxValue === 0 || (val / maxValue) <= 0.15;
          const fill = isLight ? "#0A2540" : "#fff";
          const subFill = isLight ? "#64748B" : "rgba(255,255,255,0.85)";
          return (
            <g key={name} className="pointer-events-none select-none">
              <text x={x} y={y - 2} textAnchor="middle" fontSize="6" fontWeight="600" fill={subFill}>
                {abbr}
              </text>
              <text x={x} y={y + 7} textAnchor="middle" fontSize="9" fontWeight="700" fill={fill} className="tabular-nums">
                {val}
              </text>
            </g>
          );
        })}

        {/* Region labels */}
        <text x="90" y="260" textAnchor="middle" fontSize="7.5" fill="#94A3B8" fontWeight="500" className="select-none">Peninsular Malaysia</text>
        <text x="620" y="245" textAnchor="middle" fontSize="7.5" fill="#94A3B8" fontWeight="500" className="select-none">East Malaysia</text>
      </svg>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 bg-white rounded-lg shadow-lg border border-[#E3E8EF] px-3 py-2"
          style={{
            left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth ?? 400) - 150),
            top: Math.max(tooltip.y - 52, 4),
          }}
        >
          <p className="text-xs font-semibold text-[#0A2540]">{tooltip.name}</p>
          <p className="text-[11px] text-[#697386] tabular-nums">{tooltip.value} {tooltip.value === 1 ? "case" : "cases"}</p>
          <p className="text-[10px] text-[#635BFF] mt-0.5">Click for details</p>
        </div>
      )}
    </div>
  );
}

// ── Chart Components ──

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift">
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-semibold text-[#0A2540]">{title}</h3>
        <p className="text-xs text-[#697386] mt-0.5">{subtitle}</p>
      </div>
      <div className="px-4 pb-5">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center h-[240px]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
        <span className="text-xs text-[#697386]">Loading...</span>
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[240px] text-sm text-[#697386]">{message}</div>
  );
}

// ── KPI Card ──

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] px-5 py-4 hover-lift animate-fade-in-up">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#697386]">{icon}</span>
        <span className="text-xs font-medium text-[#697386]">{label}</span>
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${accent ?? "text-[#0A2540]"}`}>{value}</p>
    </div>
  );
}

// ── Case Detail Panel ──

function CaseDetailPanel({ caseData, onClose }: { caseData: CaseRow; onClose: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)); }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") handleClose(); }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function handleClose() { setIsVisible(false); setTimeout(onClose, 300); }
  function handleBackdropClick(e: React.MouseEvent) { if (e.target === e.currentTarget) handleClose(); }

  const sections = [
    { title: "Case Information", fields: [
      { label: "Case No.", value: caseData.case_no },
      { label: "Order ID", value: caseData.order_no },
      { label: "Status", value: caseData.status, isStatus: true },
    ]},
    { title: "Customer Details", fields: [
      { label: "Full Name", value: caseData.full_name },
      { label: "Full Address", value: caseData.full_address },
      { label: "Mobile", value: caseData.mobile },
      { label: "Email", value: caseData.email },
      { label: "ID No.", value: caseData.id_no },
    ]},
    { title: "Service", fields: [
      { label: "Provider", value: caseData.provider },
      { label: "Package", value: caseData.package },
    ]},
    { title: "Agent", fields: [
      { label: "Agent", value: caseData.agent },
      { label: "Agent Remark", value: caseData.agent_remark },
    ]},
    { title: "Timestamps", fields: [
      { label: "Created At", value: formatDateTime(caseData.case_created_at) },
      { label: "Updated At", value: formatDateTime(caseData.updated_at) },
    ]},
  ];

  return (
    <div className={`fixed inset-0 z-50 transition-colors duration-300 ${isVisible ? "bg-black/20" : "bg-transparent"}`} onClick={handleBackdropClick}>
      <div ref={panelRef} className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col" style={{ transform: isVisible ? "translateX(0)" : "translateX(100%)", transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E8EF]" style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(-8px)", transition: "opacity 400ms ease-out 150ms, transform 400ms ease-out 150ms" }}>
          <div>
            <h2 className="text-lg font-semibold text-[#0A2540]">Case Details</h2>
            <p className="text-xs text-[#697386] mt-0.5 font-mono tabular-nums">{caseData.case_no}</p>
          </div>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F6F9FC] text-[#697386] hover:text-[#0A2540] transition-colors duration-200">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sections.map((section, sectionIndex) => {
            const visibleFields = section.fields.filter((f) => f.value);
            if (visibleFields.length === 0) return null;
            const delay = 200 + sectionIndex * 80;
            return (
              <div key={section.title}>
                {sectionIndex > 0 && (<div className="border-t border-[#E3E8EF] my-5" style={{ opacity: isVisible ? 1 : 0, transition: `opacity 500ms ease-out ${delay}ms` }} />)}
                <div style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(12px)", transition: `opacity 400ms ease-out ${delay}ms, transform 400ms ease-out ${delay}ms` }}>
                  <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">{section.title}</h3>
                  <div className="space-y-3">
                    {visibleFields.map((field, fieldIndex) => (
                      <div key={field.label} style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(8px)", transition: `opacity 350ms ease-out ${delay + 40 + fieldIndex * 40}ms, transform 350ms ease-out ${delay + 40 + fieldIndex * 40}ms` }}>
                        <dt className="text-xs text-[#697386] mb-0.5">{field.label}</dt>
                        <dd className="text-sm text-[#0A2540]">
                          {field.isStatus ? (<span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(field.value ?? null)}`}>{field.value}</span>) : (<span className="break-words">{field.value}</span>)}
                        </dd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {caseData.case_url && (
          <div className="px-6 py-4 border-t border-[#E3E8EF]" style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(8px)", transition: "opacity 400ms ease-out 600ms, transform 400ms ease-out 600ms" }}>
            <a href={caseData.case_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200">
              Open in WifiBizz
              <ExternalLinkIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Icons ──

function FileStackIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 7h-3a2 2 0 0 1-2-2V2" /><path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" /><path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15" /><path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" /></svg>);
}
function CheckCircleIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>);
}
function TagIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></svg>);
}
function GlobeIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>);
}
function SearchIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>);
}
function EmptyIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="M12 10v4" /><path d="M12 18h.01" /></svg>);
}
function CloseIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>);
}
function ExternalLinkIcon({ className }: { className?: string }) {
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>);
}
function SortIcon({ column, sort }: { column: string; sort: SortState }) {
  if (sort.column !== column) return <span className="text-[#E3E8EF] text-[10px]">&#8597;</span>;
  return <span className="text-[#635BFF] text-[10px]">{sort.dir === "asc" ? "\u25B2" : "\u25BC"}</span>;
}

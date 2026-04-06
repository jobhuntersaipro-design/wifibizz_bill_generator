"use client";

import { useEffect, useState, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LabelList,
} from "recharts";
import type { LabelProps, PieLabelRenderProps } from "recharts";
import { MALAYSIA_SVG_PATHS, MALAYSIA_STATE_LABELS } from "@/lib/malaysia-map-data";
import {
  type AnalyticsData, type StateDetail, type Granularity,
  GRANULARITY_OPTIONS, DATE_RANGE_PRESETS, STATUS_COLORS, PIE_COLORS,
  dateRangeToDates, formatPeriodLabel, truncateLabel,
  getHeatColor, getHeatLegendColors, getStatusColor, useAnimatedCounter,
} from "./shared";
import { FileStackIcon, CheckCircleIcon, TagIcon, GlobeIcon } from "./icons";

// ── KPI Card ──

function KpiCard({ label, value, icon, accent, delay = 0 }: { label: string; value: string; icon: React.ReactNode; accent?: string; delay?: number }) {
  const numericValue = parseInt(value, 10);
  const isNumeric = !isNaN(numericValue) && value !== "—";
  const animatedValue = useAnimatedCounter(isNumeric ? numericValue : 0, 800);

  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] px-5 py-4 hover-lift animate-fade-in-up chart-card-hover">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#697386] animate-scale-in" style={{ animationDelay: `${delay + 200}ms` }}>{icon}</span>
        <span className="text-xs font-medium text-[#697386] truncate">{label}</span>
      </div>
      <p className={`text-2xl font-semibold tabular-nums number-pop ${accent ?? "text-[#0A2540]"}`} style={{ animationDelay: `${delay + 100}ms` }}>
        {isNumeric ? animatedValue : value}
      </p>
    </div>
  );
}

// ── Chart Helpers ──

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift chart-card-hover">
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

// ── Malaysia SVG Map ──

function MalaysiaMap({ stateData, maxValue, selectedState, onStateClick, status }: {
  stateData: Map<string, number>;
  maxValue: number;
  selectedState?: string | null;
  onStateClick?: (name: string) => void;
  status?: string;
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
        <rect x="-5" y="-5" width="802" height="275" fill="#F8FAFC" rx="8" />
        <text x="330" y="140" textAnchor="middle" fontSize="9" fill="#CBD5E1" fontStyle="italic" className="select-none">South China Sea</text>
        {Object.entries(MALAYSIA_SVG_PATHS).map(([name, path], idx) => {
          const val = stateData.get(name) ?? 0;
          const color = getHeatColor(val, maxValue, status);
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
              className="cursor-pointer map-state-enter"
              style={{
                animationDelay: `${idx * 40}ms`,
                filter: isHovered && !isSelected ? "brightness(0.92)" : undefined,
                transition: "fill 200ms ease, stroke 200ms ease, stroke-width 200ms ease, filter 200ms ease",
              }}
              onMouseMove={(e) => handleMouseMove(e, name)}
              onMouseLeave={handleMouseLeave}
              onClick={() => onStateClick?.(name)}
            />
          );
        })}
        {MALAYSIA_STATE_LABELS.map(({ name, abbr, x, y }) => {
          const val = stateData.get(name) ?? 0;
          const isLight = val === 0 || maxValue === 0 || (val / maxValue) <= 0.15;
          const fill = isLight ? "#0A2540" : "#fff";
          const subFill = isLight ? "#64748B" : "rgba(255,255,255,0.85)";
          return (
            <g key={name} className="pointer-events-none select-none">
              <text x={x} y={y - 2} textAnchor="middle" fontSize="6" fontWeight="600" fill={subFill}>{abbr}</text>
              <text x={x} y={y + 7} textAnchor="middle" fontSize="9" fontWeight="700" fill={fill} className="tabular-nums">{val}</text>
            </g>
          );
        })}
        <text x="90" y="260" textAnchor="middle" fontSize="7.5" fill="#94A3B8" fontWeight="500" className="select-none">Peninsular Malaysia</text>
        <text x="620" y="245" textAnchor="middle" fontSize="7.5" fill="#94A3B8" fontWeight="500" className="select-none">East Malaysia</text>
      </svg>
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 bg-white rounded-lg shadow-lg border border-[#E3E8EF] px-3 py-2 tooltip-enter"
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

// ── Main Analytics Section ──

export default function AnalyticsSection() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [chartProvider, setChartProvider] = useState("");
  const [timeSeriesLoading, setTimeSeriesLoading] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());

  // Map filter state
  const [mapStatus, setMapStatus] = useState("Activated");
  const [mapDateRange, setMapDateRange] = useState("");
  const [mapDateFrom, setMapDateFrom] = useState("");
  const [mapDateTo, setMapDateTo] = useState("");
  const [mapProvider, setMapProvider] = useState("");
  const [mapPackage, setMapPackage] = useState("");
  const [mapLoading, setMapLoading] = useState(false);

  // State detail panel
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [stateDetail, setStateDetail] = useState<StateDetail | null>(null);
  const [stateDetailLoading, setStateDetailLoading] = useState(false);

  const emptyAnalytics: AnalyticsData = {
    totalCases: 0, byStatus: [], byProvider: [], timeSeriesByStatus: [],
    statusKeys: [], byState: [], allStatuses: [], allProviders: [], allPackages: [],
  };

  // Fetch analytics (initial load)
  useEffect(() => {
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
    setSelectedState(null);
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
          setAnalytics((prev) => prev ? { ...prev, byState: data.byState } : prev);
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

  // Computed values
  const activatedCount = analytics?.byStatus.find((s) => s.name === "Activated")?.value ?? 0;
  const stateMap = new Map(analytics?.byState.map((s) => [s.name, s.value]) ?? []);
  if (stateMap.has("Kuala Lumpur") || stateMap.has("Putrajaya")) {
    const sgrVal = (stateMap.get("Selangor") ?? 0) + (stateMap.get("Kuala Lumpur") ?? 0) + (stateMap.get("Putrajaya") ?? 0);
    stateMap.set("Selangor", sgrVal);
    stateMap.delete("Kuala Lumpur");
    stateMap.delete("Putrajaya");
  }
  const mergedStates = Array.from(stateMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const maxStateValue = stateMap.size ? Math.max(...stateMap.values()) : 0;
  const hasChartFilters = !!chartProvider;
  const mapHasFilters = mapStatus !== "Activated" || mapDateFrom || mapDateTo || mapDateRange || mapProvider || mapPackage;

  function toggleStatusLegend(statusName: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(statusName)) next.delete(statusName);
      else next.add(statusName);
      return next;
    });
  }

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
    setMapDateRange("");
    setMapDateFrom(value);
  }

  function handleMapDateTo(value: string) {
    setMapDateRange("");
    setMapDateTo(value);
  }

  function handleStateClick(stateName: string) {
    setSelectedState((prev) => (prev === stateName ? null : stateName));
  }

  const chartData = analytics?.timeSeriesByStatus.map((d) => ({
    ...d,
    label: formatPeriodLabel(d.period as string, granularity),
  }));

  const visibleStatuses = selectedStatuses.size > 0
    ? (analytics?.statusKeys ?? []).filter((s) => selectedStatuses.has(s))
    : (analytics?.statusKeys ?? []);

  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KpiCard label="Total Cases" value={analyticsLoading ? "—" : String(analytics?.totalCases ?? 0)} icon={<FileStackIcon className="w-4 h-4" />} delay={0} />
        <KpiCard label="Activated" value={analyticsLoading ? "—" : String(activatedCount)} icon={<CheckCircleIcon className="w-4 h-4" />} accent="text-[#09825D]" delay={80} />
        <KpiCard label="Statuses" value={analyticsLoading ? "—" : String(analytics?.byStatus.length ?? 0)} icon={<TagIcon className="w-4 h-4" />} delay={160} />
        <KpiCard label="Providers" value={analyticsLoading ? "—" : String(analytics?.byProvider.length ?? 0)} icon={<GlobeIcon className="w-4 h-4" />} delay={240} />
      </div>

      {/* Cases Over Time */}
      <div className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift chart-card-hover">
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
                  <button className="text-[11px] text-[#DF1B41] hover:underline" onClick={() => setChartProvider("")}>Clear</button>
                )}
                <div className="flex items-center bg-[#F6F9FC] rounded-md p-0.5 border border-[#E3E8EF]">
                  {GRANULARITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-all ${granularity === opt.value ? "bg-white text-[#0A2540] shadow-sm" : "text-[#697386] hover:text-[#425466]"}`}
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
            <div className="px-5 pb-2 flex flex-wrap gap-x-4 gap-y-1.5 legend-stagger">
              {analytics.statusKeys.map((s, i) => (
                <button
                  key={s}
                  className={`flex items-center gap-1.5 transition-all duration-200 hover:scale-105 ${selectedStatuses.size > 0 && !selectedStatuses.has(s) ? "opacity-30 scale-95" : "opacity-100"}`}
                  onClick={() => toggleStatusLegend(s)}
                  title={`Click to ${selectedStatuses.has(s) ? "deselect" : "select"} ${s}`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full transition-transform duration-200 ${selectedStatuses.size > 0 && !selectedStatuses.has(s) ? "scale-75" : ""}`} style={{ backgroundColor: getStatusColor(s, i) }} />
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
              <div className="chart-enter">
              <ResponsiveContainer width="100%" height={440}>
                <AreaChart data={chartData}>
                  <defs>
                    {visibleStatuses.map((s, i) => (
                      <linearGradient key={s} id={`areaGrad-${s}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={getStatusColor(s, i)} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={getStatusColor(s, i)} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#697386" }} axisLine={false} tickLine={false} interval={0} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #E3E8EF", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                    labelStyle={{ fontWeight: 600, color: "#0A2540" }}
                    cursor={{ stroke: "#635BFF", strokeWidth: 1, strokeDasharray: "4 4" }}
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
                        strokeWidth={2.5}
                        fill={`url(#areaGrad-${s})`}
                        dot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }}
                        activeDot={{ r: 7, stroke: color, strokeWidth: 2, fill: "#fff" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={i * 200}
                        animationEasing="ease-out"
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
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cases by State — Full Width with Filters */}
      <div className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift chart-card-hover">
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
                  {getHeatLegendColors(mapStatus).map((c) => (
                    <div key={c} className="w-3 h-3 rounded-sm transition-colors duration-300" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span>High</span>
              </div>
            </div>

            {/* Map filters row */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all" value={mapStatus} onChange={(e) => setMapStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {(analytics?.allStatuses ?? []).map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
              <select className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[160px]" value={mapProvider} onChange={(e) => setMapProvider(e.target.value)}>
                <option value="">All Providers</option>
                {(analytics?.allProviders ?? []).map((p) => (<option key={p} value={p}>{truncateLabel(p, 28)}</option>))}
              </select>
              <select className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[200px]" value={mapPackage} onChange={(e) => setMapPackage(e.target.value)}>
                <option value="">All Packages</option>
                {(analytics?.allPackages ?? []).map((p) => (<option key={p} value={p}>{truncateLabel(p, 35)}</option>))}
              </select>
              <div className="h-5 w-px bg-[#E3E8EF]" />
              <select className="h-7 rounded-md border border-[#E3E8EF] bg-white px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all" value={mapDateRange} onChange={(e) => handleMapDatePreset(e.target.value)}>
                {DATE_RANGE_PRESETS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
              <div className="flex items-center gap-1.5">
                <input type="date" className="h-7 rounded-md border border-[#E3E8EF] bg-white px-1.5 sm:px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[130px]" value={mapDateFrom} onChange={(e) => handleMapDateFrom(e.target.value)} placeholder="From" />
                <span className="text-[10px] text-[#697386]">to</span>
                <input type="date" className="h-7 rounded-md border border-[#E3E8EF] bg-white px-1.5 sm:px-2 text-[11px] text-[#425466] focus:border-[#635BFF] outline-none transition-all max-w-[130px]" value={mapDateTo} onChange={(e) => handleMapDateTo(e.target.value)} />
              </div>
              {mapHasFilters && (
                <button className="h-7 px-2.5 rounded-md text-[11px] font-medium text-[#697386] bg-[#F6F9FC] border border-[#E3E8EF] hover:bg-[#EDF0F4] hover:text-[#425466] transition-all" onClick={clearMapFilters}>Reset</button>
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
                <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                  <div className="flex-1 min-w-0">
                    <MalaysiaMap stateData={stateMap} maxValue={maxStateValue} selectedState={selectedState} onStateClick={handleStateClick} status={mapStatus} />
                  </div>
                  <div className="w-full md:w-[200px] md:shrink-0">
                    <p className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-2">Top States</p>
                    <div className="space-y-2">
                      {mergedStates.slice(0, 8).map((state, i) => (
                        <div
                          key={state.name}
                          className={`flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-all duration-200 animate-fade-in-left ${selectedState === state.name ? "bg-[#F0EEFF]" : "hover:bg-[#F6F9FC]"}`}
                          style={{ animationDelay: `${i * 60}ms` }}
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
                                className="h-full rounded-full progress-fill"
                                style={{
                                  width: `${maxStateValue > 0 ? (state.value / maxStateValue) * 100 : 0}%`,
                                  backgroundColor: STATUS_COLORS[mapStatus] ?? "#635BFF",
                                  animationDelay: `${300 + i * 80}ms`,
                                  transition: "width 500ms ease-out, background-color 300ms ease",
                                }}
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
                        <div className="w-2 h-2 rounded-full transition-colors duration-300" style={{ backgroundColor: STATUS_COLORS[mapStatus] ?? "#635BFF" }} />
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
                      <button onClick={() => setSelectedState(null)} className="text-[11px] text-[#697386] hover:text-[#0A2540] transition-colors">Close</button>
                    </div>
                    {!stateDetailLoading && stateDetail && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Status</p>
                          {stateDetail.byStatus.length === 0 ? (<p className="text-[11px] text-[#697386]">No data</p>) : (
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
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Provider</p>
                          {stateDetail.byProvider.length === 0 ? (<p className="text-[11px] text-[#697386]">No data</p>) : (
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
                        <div className="bg-[#F6F9FC] rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-[#697386] uppercase tracking-wider mb-2">By Package</p>
                          {stateDetail.byPackage.length === 0 ? (<p className="text-[11px] text-[#697386]">No data</p>) : (
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
        <div className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
          <ChartCard title="By Status" subtitle="Case distribution by status">
            {analyticsLoading ? (
              <ChartSkeleton />
            ) : analytics?.byStatus.length === 0 ? (
              <EmptyChart message="No data available" />
            ) : (
              <div className="flex flex-col items-center chart-enter" style={{ animationDelay: "200ms" }}>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={analytics?.byStatus}
                      cx="50%" cy="50%"
                      innerRadius={70} outerRadius={105}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={true}
                      animationDuration={1200}
                      animationBegin={300}
                      animationEasing="ease-out"
                      label={(props: PieLabelRenderProps) => {
                        const { cx, cy, midAngle, outerRadius, value } = props;
                        const RADIAN = Math.PI / 180;
                        const radius = (outerRadius as number) + 20;
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
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 legend-stagger">
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
        <div className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <ChartCard title="By Provider" subtitle="Cases per internet provider">
            {analyticsLoading ? (
              <ChartSkeleton />
            ) : analytics?.byProvider.length === 0 ? (
              <EmptyChart message="No data available" />
            ) : (
              <div className="chart-enter" style={{ animationDelay: "200ms" }}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={analytics?.byProvider.map((p) => ({ ...p, label: truncateLabel(p.name, 22) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#697386" }} axisLine={false} tickLine={false} width={140} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E3E8EF", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} labelStyle={{ fontWeight: 600, color: "#0A2540" }} formatter={(value) => [String(value), "Cases"]} cursor={{ fill: "rgba(99, 91, 255, 0.04)" }} />
                  <Bar dataKey="value" fill="#635BFF" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={true} animationDuration={1000} animationBegin={300} animationEasing="ease-out">
                    <LabelList dataKey="value" position="right" style={{ fontSize: 11, fontWeight: 600, fill: "#0A2540" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";

// ── Types ──

interface UsageLogEntry {
  caseNo: string;
  caseName: string | null;
  billType: string;
  hasInternet: boolean;
  hasUtility: boolean;
  chargedAt: string;
}

interface DualAxisEntry {
  date: string;
  usage: number;
  limit: number;
  percentage: number;
}

interface LimitChangeEntry {
  previousLimit: number;
  newLimit: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

interface UsageSummary {
  casesUsed: number;
  limit: number;
  remaining: number;
  internetBills: number;
  utilityBills: number;
  totalCases: number;
}

interface UsageHistoryResponse {
  data: UsageLogEntry[];
  total: number;
  limit: number;
  offset: number;
  dualAxisChart: DualAxisEntry[];
  usage: UsageSummary;
  limitChangeLog: LimitChangeEntry[];
}

const PAGE_SIZE = 15;

const DATE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "3m", days: 90 },
] as const;

// ── Main Screen ──

export function CaseUsageScreen() {
  const [entries, setEntries] = useState<UsageLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [chartDays, setChartDays] = useState(30);
  const [chartFrom, setChartFrom] = useState("");
  const [chartTo, setChartTo] = useState("");
  const [dualAxisChart, setDualAxisChart] = useState<DualAxisEntry[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [limitChangeLog, setLimitChangeLog] = useState<LimitChangeEntry[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async (pageOffset: number, searchTerm: string, days: number, from?: string, to?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageOffset),
        days: String(days),
      });
      if (searchTerm) params.set("search", searchTerm);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await fetch(`/api/cases/usage/history?${params}`);
      const data: UsageHistoryResponse = await res.json();
      setEntries(data.data);
      setTotal(data.total);
      setOffset(pageOffset);
      setDualAxisChart(data.dualAxisChart);
      setUsage(data.usage);
      setLimitChangeLog(data.limitChangeLog);
    } catch {
      // silent
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchHistory(0, "", 30);
  }, [fetchHistory]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
      fetchHistory(0, value, chartDays, chartFrom, chartTo);
    }, 300);
  }

  function handleChartDaysChange(days: number) {
    setChartDays(days);
    setChartFrom("");
    setChartTo("");
    fetchHistory(offset, search, days);
  }

  function handleDateRangeChange(from: string, to: string) {
    setChartFrom(from);
    setChartTo(to);
    if (from && to) {
      fetchHistory(offset, search, chartDays, from, to);
    }
  }

  function goToPage(newOffset: number) {
    fetchHistory(newOffset, search, chartDays, chartFrom, chartTo);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      {/* Progress bar + summary */}
      {usage && <UsageProgressCard usage={usage} />}

      {/* Chart */}
      <DailyCaseUsageChart
        data={dualAxisChart}
        days={chartDays}
        from={chartFrom}
        to={chartTo}
        onDaysChange={handleChartDaysChange}
        onDateRangeChange={handleDateRangeChange}
      />

      {/* Limit Purchase History */}
      <LimitPurchaseHistory entries={limitChangeLog} />

      {/* History table */}
      <Card className="border-[#E3E8EF] bg-white animate-fade-in-up" style={{ animationDelay: "400ms" }}>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm font-semibold text-[#0A2540]">Usage History</CardTitle>
              <span className="text-xs text-[#697386] tabular-nums">{total} entries</span>
            </div>
            <div className="relative w-full sm:w-64">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#697386]" />
              <Input
                placeholder="Search case no. or name..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="h-8 pl-8 text-xs rounded-lg border-[#E3E8EF]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mx-auto mb-3">
                <EmptyIcon className="w-5 h-5 text-[#697386]" />
              </div>
              <p className="text-sm font-medium text-[#0A2540]">
                {search ? "No matching results" : "No bills generated yet"}
              </p>
              <p className="text-xs text-[#697386] mt-1">
                {search ? "Try a different search term" : "Generate bills from the dashboard to see usage here"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E3E8EF]">
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Case No.</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Customer Name</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Bills Generated</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Charged At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E8EF]/60">
                    {entries.map((entry, i) => (
                      <tr key={`${entry.caseNo}-${i}`} className="hover:bg-[#F6F9FC] transition-colors duration-100">
                        <td className="px-3 py-2.5 font-medium text-[#0A2540] tabular-nums">{entry.caseNo}</td>
                        <td className="px-3 py-2.5 text-[#425466] hidden sm:table-cell max-w-[200px] truncate">{entry.caseName || "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md ${
                              entry.hasInternet
                                ? "bg-blue-50 text-blue-700"
                                : "bg-gray-50 text-gray-400"
                            }`}>
                              Umobile
                            </span>
                            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md ${
                              entry.hasUtility
                                ? "bg-amber-50 text-amber-700"
                                : "bg-gray-50 text-gray-400"
                            }`}>
                              Utility
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#697386] tabular-nums">
                          {new Date(entry.chargedAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-[#E3E8EF] mt-3">
                  <span className="text-xs text-[#697386]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0 || loading}
                      onClick={() => goToPage(offset - PAGE_SIZE)}
                      className="h-7 px-2.5 text-xs rounded-md border-[#E3E8EF]"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + PAGE_SIZE >= total || loading}
                      onClick={() => goToPage(offset + PAGE_SIZE)}
                      className="h-7 px-2.5 text-xs rounded-md border-[#E3E8EF]"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Usage Progress Card ──

function UsageProgressCard({ usage }: { usage: UsageSummary }) {
  const percentage = usage.limit > 0 ? Math.min(100, (usage.casesUsed / usage.limit) * 100) : 0;
  const isAtLimit = usage.remaining === 0;
  const isNearLimit = usage.remaining > 0 && usage.remaining <= 2;

  return (
    <Card className="border-[#E3E8EF] bg-white animate-fade-in-up" style={{ animationDelay: "100ms" }}>
      <CardContent className="pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          {/* Progress section */}
          <div className="flex-1 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-[#0A2540] tabular-nums">{usage.casesUsed}</span>
                <span className="text-sm text-[#697386]">/ {usage.limit} cases used</span>
              </div>
              <span className={`text-sm font-medium tabular-nums ${
                isAtLimit ? "text-[#DF1B41]" : isNearLimit ? "text-amber-500" : "text-[#697386]"
              }`}>
                {Math.round(percentage)}%
              </span>
            </div>

            <div className="h-3 rounded-full bg-[#F6F9FC] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  isAtLimit
                    ? "bg-[#DF1B41]"
                    : isNearLimit
                      ? "bg-amber-500"
                      : "bg-[#635BFF]"
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            {isAtLimit && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm">
                <p className="font-medium text-[#DF1B41]">Case limit reached</p>
                <p className="text-[#697386] mt-0.5">
                  Need more?{" "}
                  <a href="mailto:support@wifibizz.com" className="text-[#635BFF] underline underline-offset-2">
                    Contact us
                  </a>
                </p>
              </div>
            )}

            {isNearLimit && (
              <p className="text-sm text-amber-600">
                {usage.remaining} case{usage.remaining === 1 ? "" : "s"} remaining
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 sm:gap-6 shrink-0">
            <div className="text-center">
              <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Remaining</p>
              <p className="text-xl font-semibold text-[#0A2540] tabular-nums mt-1">{usage.remaining}</p>
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Umobile</p>
              <p className="text-xl font-semibold text-[#635BFF] tabular-nums mt-1">{usage.internetBills}</p>
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Utility</p>
              <p className="text-xl font-semibold text-amber-500 tabular-nums mt-1">{usage.utilityBills}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Chart Date Presets ──

function ChartDatePresets({ days, onChange, isCustom }: { days: number; onChange: (d: number) => void; isCustom?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {DATE_PRESETS.map((p) => (
        <button
          key={p.days}
          onClick={() => onChange(p.days)}
          className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
            !isCustom && days === p.days
              ? "bg-[#635BFF] text-white"
              : "bg-[#F6F9FC] text-[#697386] hover:bg-[#E3E8EF]"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Daily Case Usage Chart (Dual Axis) ──

function DailyCaseUsageChart({
  data,
  days,
  from,
  to,
  onDaysChange,
  onDateRangeChange,
}: {
  data: DualAxisEntry[];
  days: number;
  from: string;
  to: string;
  onDaysChange: (d: number) => void;
  onDateRangeChange: (from: string, to: string) => void;
}) {
  const hasData = data.some((d) => d.usage > 0 || d.limit > 0);
  const isCustomRange = from && to;
  const presetLabel = isCustomRange ? "Custom" : (DATE_PRESETS.find((p) => p.days === days)?.label ?? `${days}d`);

  return (
    <Card className="border-[#E3E8EF] bg-white animate-fade-in-up" style={{ animationDelay: "200ms" }}>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold text-[#0A2540]">Daily Case Usage</CardTitle>
              <p className="text-xs text-[#697386] mt-0.5">{isCustomRange ? `${from} to ${to}` : `Last ${presetLabel}`}</p>
            </div>
            <ChartDatePresets days={days} onChange={onDaysChange} isCustom={!!isCustomRange} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-[#697386] font-medium">From</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => onDateRangeChange(e.target.value, to)}
              className="h-7 text-xs rounded-md border-[#E3E8EF] w-[140px]"
            />
            <label className="text-[11px] text-[#697386] font-medium">To</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => onDateRangeChange(from, e.target.value)}
              className="h-7 text-xs rounded-md border-[#E3E8EF] w-[140px]"
            />
            {isCustomRange && (
              <button
                onClick={() => {
                  onDateRangeChange("", "");
                  onDaysChange(days);
                }}
                className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-[#F6F9FC] text-[#697386] hover:bg-[#E3E8EF] transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="text-center py-8 text-sm text-[#697386]">No activity in this period</div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#635BFF]" />
                <span className="text-[11px] text-[#697386]">Case Usage</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#E3E8EF]" />
                <span className="text-[11px] text-[#697386]">Case Limit</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-[#DF1B41]" />
                <span className="text-[11px] text-[#697386]">Usage %</span>
              </div>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#697386" }}
                    tickLine={false}
                    axisLine={{ stroke: "#E3E8EF" }}
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "#697386" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={36}
                    label={{ value: "Cases", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "#697386" }, offset: -5 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#697386" }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    width={36}
                    label={{ value: "Usage %", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "#697386" }, offset: -5 }}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #E3E8EF",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    labelFormatter={(label) =>
                      new Date(String(label)).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    }
                    formatter={(value, name) => {
                      if (name === "Usage %") return [`${value}%`, name];
                      return [value, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="limit" name="Case Limit" fill="#E3E8EF" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="usage" name="Case Usage" fill="#635BFF" radius={[3, 3, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="percentage"
                    name="Usage %"
                    stroke="#DF1B41"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Purchase History ──

function LimitPurchaseHistory({ entries }: { entries: LimitChangeEntry[] }) {
  const increases = entries.filter((e) => e.newLimit > e.previousLimit);

  return (
    <Card className="border-[#E3E8EF] bg-white animate-fade-in-up" style={{ animationDelay: "350ms" }}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-[#0A2540]">Purchase History</CardTitle>
            <p className="text-xs text-[#697386] mt-0.5">Your case topup transactions</p>
          </div>
          {increases.length > 0 && (
            <span className="text-xs text-[#697386] tabular-nums">{increases.length} topup{increases.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {increases.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mx-auto mb-3">
              <CartIcon className="w-5 h-5 text-[#697386]" />
            </div>
            <p className="text-sm font-medium text-[#0A2540]">No purchases yet</p>
            <p className="text-xs text-[#697386] mt-1">
              Case topups will appear here when purchased
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E3E8EF]">
            {increases.map((entry, i) => {
              const added = entry.newLimit - entry.previousLimit;
              return (
                <div
                  key={i}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="w-9 h-9 rounded-full bg-[#635BFF]/10 flex items-center justify-center shrink-0">
                    <TopupIcon className="w-4 h-4 text-[#635BFF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0A2540]">
                      Topup +{added.toLocaleString()} case{added !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-[#697386] mt-0.5">
                      New balance: {entry.newLimit.toLocaleString()} cases
                      {entry.reason && <span className="text-[#425466]"> &middot; {entry.reason}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[#697386] tabular-nums">
                      {new Date(entry.changedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    <p className="text-[11px] text-[#697386]">
                      {new Date(entry.changedAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Icons ──

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function EmptyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="m7 11 4-4 4 4 5-5" />
    </svg>
  );
}

function CartIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

function TopupIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2v20" />
      <path d="m5 9 7-7 7 7" />
    </svg>
  );
}

"use client";

import LottieSpot from "@/components/order-entry/LottieSpot";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CRAWL_LOOKBACK_MONTHS,
  crawlDateWindow,
  crawlLookbackStart,
  formatCrawlDate,
  isCrawlDateInLookback,
} from "@/lib/crawler/date-window";

interface CrawlProgress {
  step: string;
  current: number;
  total: number;
  percent: number;
}

type PresetKey = "1d" | "3d" | "7d" | "1w" | "1m" | "3m" | "6m" | "1y";

type DatePreset =
  | { key: Exclude<PresetKey, "6m" | "1y">; label: string; days: number }
  | { key: "6m"; label: string; months: number }
  | { key: "1y"; label: string };

const PRESETS: DatePreset[] = [
  { key: "1d", label: "Last 1 day", days: 1 },
  { key: "3d", label: "Last 3 days", days: 3 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "1w", label: "Last 1 week", days: 7 },
  { key: "1m", label: "Last 1 month", days: 30 },
  { key: "3m", label: "Last 3 months", days: 90 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "1y", label: "Last 1 year" },
];

function fromDateForPreset(preset: DatePreset, now: Date): Date {
  if (preset.key === "1y") return crawlLookbackStart(now);
  const from = new Date(now);
  if (preset.key === "6m") {
    from.setMonth(from.getMonth() - preset.months);
    return from;
  }
  from.setDate(from.getDate() - preset.days);
  return from;
}

export default function CrawlPage() {
  const [crawling, setCrawling] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [result, setResult] = useState<{
    total: number;
    saved: number;
  } | null>(null);
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activePreset, setActivePreset] = useState<PresetKey | null>(null);
  const [dateError, setDateError] = useState("");

  const { start: maxPast, end: today } = crawlDateWindow(new Date());

  const dateValidation = useMemo(() => {
    if (!dateFrom && !dateTo) return { valid: true, error: "" };

    const now = new Date();
    if (dateFrom && !isCrawlDateInLookback(dateFrom, now)) {
      return {
        valid: false,
        error: `From date cannot be older than ${CRAWL_LOOKBACK_MONTHS} months`,
      };
    }
    if (dateTo && !isCrawlDateInLookback(dateTo, now)) {
      return {
        valid: false,
        error: `To date cannot be older than ${CRAWL_LOOKBACK_MONTHS} months`,
      };
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return { valid: false, error: "From date must be before To date" };
    }
    if (dateFrom && dateFrom > today) {
      return { valid: false, error: "From date cannot be in the future" };
    }
    if (dateTo && dateTo > today) {
      return { valid: false, error: "To date cannot be in the future" };
    }
    return { valid: true, error: "" };
  }, [dateFrom, dateTo, today]);

  function applyPreset(preset: DatePreset) {
    const to = new Date();
    setDateFrom(formatCrawlDate(fromDateForPreset(preset, to)));
    setDateTo(formatCrawlDate(to));
    setActivePreset(preset.key);
    setDateError("");
  }

  function resetDates() {
    setDateFrom("");
    setDateTo("");
    setActivePreset(null);
    setDateError("");
  }

  function handleDateFromChange(val: string) {
    setDateFrom(val);
    setActivePreset(null);
    setDateError("");
  }

  function handleDateToChange(val: string) {
    setDateTo(val);
    setActivePreset(null);
    setDateError("");
  }

  async function handleCrawl() {
    if (!dateValidation.valid) {
      setDateError(dateValidation.error);
      return;
    }

    setCrawling(true);
    setResult(null);
    setDateError("");
    setProgress({ step: "Starting...", current: 0, total: 0, percent: 0 });

    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const url = `/api/crawl${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { method: "POST" });

      // Handle non-SSE error responses (JSON)
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        if (json.error === "no_credentials") {
          toast.error("Set your WifiBizz credentials in Settings first.");
          router.push("/dashboard/settings");
          return;
        }
        toast.error(json.error ?? "Crawl failed");
        return;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        toast.error("Failed to start crawl stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "progress") {
              setProgress({
                step: data.step,
                current: data.current,
                total: data.total,
                percent: data.percent,
              });
            } else if (data.type === "done") {
              setResult({
                total: data.total,
                saved: data.saved,
              });
              setProgress(null);
              toast.success(`Crawl complete — ${data.saved} cases saved`);
            } else if (data.type === "error") {
              toast.error(data.error ?? "Crawl failed");
              setProgress(null);
            }
          } catch {
            // skip malformed SSE data
          }
        }
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCrawling(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Crawler</h1>
        <p className="text-sm text-[#697386] mt-1">
          Fetch activated cases from WifiBizz using your saved credentials
        </p>
      </div>

      {/* Date Filter */}
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-5 animate-fade-in-up" style={{ animationDelay: "150ms" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#0A2540]">Date Filter</h3>
          {(dateFrom || dateTo) && (
            <button
              onClick={resetDates}
              className="text-xs text-[#635BFF] hover:text-[#0A2540] font-medium transition-colors press-effect"
            >
              Reset
            </button>
          )}
        </div>

        {/* Preset buttons */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              disabled={crawling}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 press-effect ${
                activePreset === p.key
                  ? "bg-[#635BFF] text-white shadow-sm shadow-[#635BFF]/20"
                  : "bg-[#F6F9FC] text-[#425466] border border-[#E3E8EF] hover:bg-[#E3E8EF] hover:text-[#0A2540]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Date inputs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[#697386] mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateFromChange(e.target.value)}
              min={maxPast}
              max={today}
              disabled={crawling}
              className="w-full h-9 px-3 rounded-md border border-[#E3E8EF] text-sm text-[#0A2540] bg-white focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20 focus:border-[#635BFF] disabled:opacity-50 tabular-nums"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-[#697386] mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateToChange(e.target.value)}
              min={maxPast}
              max={today}
              disabled={crawling}
              className="w-full h-9 px-3 rounded-md border border-[#E3E8EF] text-sm text-[#0A2540] bg-white focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20 focus:border-[#635BFF] disabled:opacity-50 tabular-nums"
            />
          </div>
        </div>

        {/* Date error */}
        {(dateError || !dateValidation.valid) && (
          <p className="text-xs text-[#DF1B41] mt-2 animate-fade-in">
            {dateError || dateValidation.error}
          </p>
        )}

        {/* Active filter indicator */}
        {dateFrom && dateTo && dateValidation.valid && (
          <p className="text-xs text-[#09825D] mt-2 animate-fade-in">
            Filtering: {dateFrom} to {dateTo}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Crawl action card */}
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <div className="p-6">
            <div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-5">
              <CrawlerIcon className="w-5 h-5 text-[#635BFF]" />
            </div>
            <h2 className="text-base font-semibold text-[#0A2540] mb-1.5">
              Start New Crawl
            </h2>
            <p className="text-sm text-[#697386] leading-relaxed mb-5">
              Connects to WifiBizz and fetches all Home Fibre and Business Fibre
              cases with all status. New cases will be added and existing
              ones updated.
            </p>

            <Button
              onClick={handleCrawl}
              disabled={crawling || !dateValidation.valid}
              className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
            >
              {crawling ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Crawling...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <PlayIcon className="w-4 h-4" />
                  Start Crawl
                </span>
              )}
            </Button>

            {/* Progress bar */}
            {crawling && progress && (
              <div className="mt-5 animate-fade-in">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 text-xs text-[#697386]">
                    {/* Marks the WAITING state, exactly as the submit checklist
                        uses it. Reduced motion falls back to nothing extra —
                        the spinner in the button already carries the state. */}
                    <LottieSpot name="processing" size={18} fallback={null} />
                    {progress.step}
                  </span>
                  <span className="text-xs font-semibold text-[#0A2540] tabular-nums">
                    {progress.percent}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#F6F9FC] rounded-full overflow-hidden border border-[#E3E8EF]">
                  <div
                    className="h-full bg-[#635BFF] rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                {progress.total > 0 && (
                  <p className="text-[11px] text-[#697386] mt-1.5 tabular-nums">
                    {progress.current} of {progress.total} cases processed
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Result / info card */}
        <div>
          {result ? (
            <div className="bg-white rounded-lg border border-[#E3E8EF] p-6 animate-scale-in">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-5 animate-scale-in" style={{ animationDelay: "100ms" }}>
                <CheckIcon className="w-5 h-5 text-[#09825D]" />
              </div>
              <h2 className="text-base font-semibold text-[#0A2540] mb-4 animate-fade-in" style={{ animationDelay: "150ms" }}>
                Crawl Complete
              </h2>

              <div className="space-y-3 stagger-children">
                <ResultRow label="Total cases found" value={result.total} />
                <ResultRow label="Saved to database" value={result.saved} accent />
              </div>

              <Button
                variant="outline"
                className="mt-5 rounded-lg border-[#E3E8EF] text-[#425466] hover:text-[#0A2540] press-effect animate-fade-in-up" style={{ animationDelay: "300ms" }}
                onClick={() => router.push("/dashboard")}
              >
                View Cases
              </Button>
            </div>
          ) : (
            <div className="bg-[#F6F9FC] rounded-lg border border-[#E3E8EF] border-dashed p-6 flex flex-col items-center justify-center text-center h-full min-h-70 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              <div className="w-12 h-12 rounded-lg bg-white border border-[#E3E8EF] flex items-center justify-center mb-4 animate-scale-in">
                <InfoIcon className="w-5 h-5 text-[#697386]" />
              </div>
              <h3 className="text-sm font-medium text-[#425466] mb-1">
                Ready to crawl
              </h3>
              <p className="text-xs text-[#697386] max-w-60 leading-relaxed">
                Hit &quot;Start Crawl&quot; to fetch the latest cases from your
                WifiBizz account
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  value,
  accent,
  warning,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#E3E8EF]/60 last:border-0 animate-slide-up">
      <span className="text-sm text-[#697386]">{label}</span>
      <span
        className={`text-base font-semibold tabular-nums ${
          warning
            ? "text-amber-600"
            : accent
              ? "text-[#09825D]"
              : "text-[#0A2540]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function CrawlerIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 12H3" />
      <path d="M16 6H3" />
      <path d="M12 18H3" />
      <path d="m16 12 5 3-5 3v-6Z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

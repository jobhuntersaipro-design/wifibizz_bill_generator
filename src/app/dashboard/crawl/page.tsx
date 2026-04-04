"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function CrawlPage() {
  const [crawling, setCrawling] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    saved: number;
    skipped: number;
  } | null>(null);
  const router = useRouter();

  async function handleCrawl() {
    setCrawling(true);
    setResult(null);

    try {
      const res = await fetch("/api/crawl", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        if (json.error === "no_credentials") {
          toast.error("Set your WifiBizz credentials in Settings first.");
          router.push("/dashboard/settings");
          return;
        }
        if (json.error === "case_limit_reached") {
          toast.error(
            `Case limit reached (${json.current}/${json.limit}). Contact us to increase.`
          );
          return;
        }
        toast.error(json.error ?? "Crawl failed");
        return;
      }

      setResult({
        total: json.total,
        saved: json.saved,
        skipped: json.skipped,
      });
      toast.success(`Crawl complete — ${json.saved} cases saved`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCrawling(false);
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
              cases with &quot;Activated&quot; status. New cases will be added and existing
              ones updated.
            </p>

            <Button
              onClick={handleCrawl}
              disabled={crawling}
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

            {crawling && (
              <p className="text-xs text-[#697386] mt-4 animate-pulse">
                This may take a moment. Do not close this page.
              </p>
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
                {result.skipped > 0 && (
                  <ResultRow label="Skipped (limit)" value={result.skipped} warning />
                )}
              </div>

              <Button
                variant="outline"
                className="mt-5 rounded-lg border-[#E3E8EF] text-[#425466] hover:text-[#0A2540] press-effect animate-fade-in-up" style={{ animationDelay: "300ms" }}
                onClick={() => router.push("/dashboard/cases")}
              >
                View Cases
              </Button>
            </div>
          ) : (
            <div className="bg-[#F6F9FC] rounded-lg border border-[#E3E8EF] border-dashed p-6 flex flex-col items-center justify-center text-center h-full min-h-[280px] animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              <div className="w-12 h-12 rounded-lg bg-white border border-[#E3E8EF] flex items-center justify-center mb-4 animate-float">
                <InfoIcon className="w-5 h-5 text-[#697386]" />
              </div>
              <h3 className="text-sm font-medium text-[#425466] mb-1">
                Ready to crawl
              </h3>
              <p className="text-xs text-[#697386] max-w-[240px] leading-relaxed">
                Hit &quot;Start Crawl&quot; to fetch the latest activated cases from your
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardData {
  totalCases: number;
  activatedCases: number;
  lastCrawlAt: string | null;
  recentCases: {
    case_no: string;
    full_name: string | null;
    mobile: string | null;
    package: string | null;
  }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/cases?limit=4&sort_by=case_created_at&sort_dir=desc");
        const json = await res.json();
        const usageRes = await fetch("/api/cases/usage");
        const usage = await usageRes.json();
        setData({
          totalCases: json.count ?? 0,
          activatedCases: json.count ?? 0,
          lastCrawlAt: json.data?.[0]?.updated_at ?? null,
          recentCases: json.data ?? [],
        });
        if (usage.limit) {
          setData((prev) =>
            prev ? { ...prev, totalCases: usage.current } : prev
          );
        }
      } catch {
        setData({
          totalCases: 0,
          activatedCases: 0,
          lastCrawlAt: null,
          recentCases: [],
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const lastCrawlFormatted = data?.lastCrawlAt
    ? new Date(data.lastCrawlAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Never";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">
          Dashboard
        </h1>
        <p className="text-sm text-[#697386] mt-1">
          Overview of your BizzFlow activity
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        <StatCard
          label="Total Cases"
          value={loading ? "—" : String(data?.totalCases ?? 0)}
          icon={<FileStackIcon className="w-5 h-5" />}
        />
        <StatCard
          label="Activated Cases"
          value={loading ? "—" : String(data?.activatedCases ?? 0)}
          icon={<CheckCircleIcon className="w-5 h-5" />}
          valueColor="text-[#09825D]"
        />
        <StatCard
          label="Last Crawled"
          value={loading ? "—" : lastCrawlFormatted}
          icon={<RefreshIcon className="w-5 h-5" />}
          isDate
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Activated Cases */}
        <div className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden hover-lift">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#0A2540]">
                  Recent Activated Cases
                </h2>
                <p className="text-xs text-[#697386] mt-0.5">
                  Latest activations from your account
                </p>
              </div>
              <Link
                href="/dashboard/cases"
                className="text-xs font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors"
              >
                View All
              </Link>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-4 gap-4 px-5 py-2 text-[11px] font-semibold text-[#697386] uppercase tracking-wider border-b border-[#E3E8EF]">
              <span>Case No</span>
              <span>Name</span>
              <span>Mobile</span>
              <span>Package</span>
            </div>

            {/* Table body */}
            <div className="divide-y divide-[#E3E8EF]/60">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
                    <span className="text-xs text-[#697386]">Loading...</span>
                  </div>
                </div>
              ) : data?.recentCases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#697386]">
                  <p className="text-sm font-medium">No cases yet</p>
                  <p className="text-xs mt-1">Run a crawl to populate your dashboard</p>
                </div>
              ) : (
                data?.recentCases.map((c) => (
                  <div
                    key={c.case_no}
                    className="grid grid-cols-4 gap-4 px-5 py-3 hover:bg-[#F6F9FC] transition-colors duration-100 cursor-default"
                  >
                    <span className="text-xs font-mono tabular-nums text-[#425466]">
                      {c.case_no}
                    </span>
                    <span className="text-sm font-medium text-[#0A2540] truncate">
                      {formatName(c.full_name)}
                    </span>
                    <span className="text-xs text-[#697386] tabular-nums">
                      {c.mobile ?? "—"}
                    </span>
                    <span>
                      <PackageBadge pkg={c.package} />
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          {/* Generate Bills CTA */}
          <div className="bg-[#635BFF] rounded-lg p-5 text-white hover-lift">
            <h3 className="text-base font-semibold leading-tight mb-1.5">
              Generate Bills
            </h3>
            <p className="text-xs text-white/70 leading-relaxed mb-4">
              Process billing for{" "}
              {loading ? "..." : data?.activatedCases ?? 0} active cases.
            </p>
            <Link
              href="/dashboard/crawl"
              className="inline-flex items-center gap-2 bg-white text-[#635BFF] font-semibold text-sm px-4 py-2 rounded-lg hover:bg-white/90 transition-all duration-200 hover:shadow-lg hover:shadow-black/10 press-effect"
            >
              <BoltIcon className="w-4 h-4" />
              Get Started
            </Link>
          </div>

          {/* Network Health */}
          <div className="bg-white rounded-lg border border-[#E3E8EF] p-5 hover-lift">
            <div className="flex items-center gap-2 mb-3">
              <ActivityIcon className="w-4 h-4 text-[#697386]" />
              <h3 className="text-sm font-semibold text-[#0A2540]">
                Network Health
              </h3>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#697386]">
                Stability
              </span>
              <span className="text-sm font-semibold text-[#0A2540] tabular-nums">94%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#F6F9FC] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#09825D] transition-all duration-1000"
                style={{ width: "94%" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <BottomStat label="Average Speed" value="450" unit="Mbps" />
        <BottomStat label="Total Bandwidth" value="12.4" unit="TB" />
        <BottomStat label="Uptime" value="99.98" unit="%" />
        <BottomStat label="Incidents" value="0" unit="Reports" />
      </div>
    </div>
  );
}

function formatName(name: string | null): string {
  if (!name) return "—";
  return name
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function PackageBadge({ pkg }: { pkg: string | null }) {
  if (!pkg) return <span className="text-xs text-[#697386]">—</span>;

  const lower = pkg.toLowerCase();
  let color = "bg-[#F6F9FC] text-[#425466]";
  let label = pkg;

  if (lower.includes("premium")) {
    color = "bg-amber-50 text-amber-700";
    label = "Premium Gold";
  } else if (lower.includes("basic")) {
    color = "bg-blue-50 text-blue-700";
    label = "Basic Fiber";
  } else if (lower.includes("ultra") || lower.includes("stream")) {
    color = "bg-violet-50 text-violet-700";
    label = "Ultra Stream";
  } else if (lower.includes("500") || lower.includes("1000")) {
    color = "bg-emerald-50 text-emerald-700";
    label = pkg.includes("500") ? "500 Mbps" : "1 Gbps";
  }

  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {label.length > 18 ? label.slice(0, 18) + "..." : label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  isDate,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  isDate?: boolean;
  valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] p-5 hover-lift animate-fade-in-up">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[#697386]">{icon}</span>
        <span className="text-xs font-medium text-[#697386]">
          {label}
        </span>
      </div>
      <p className={`font-semibold tabular-nums ${isDate ? "text-base" : "text-2xl"} ${valueColor ?? "text-[#0A2540]"}`}>
        {value}
      </p>
    </div>
  );
}

function BottomStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] px-5 py-4 hover-lift animate-fade-in-up">
      <p className="text-xs font-medium text-[#697386] mb-1.5">
        {label}
      </p>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-semibold text-[#0A2540] tabular-nums">
          {value}
        </span>
        <span className="text-xs font-medium text-[#697386]">{unit}</span>
      </div>
    </div>
  );
}

function FileStackIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 7h-3a2 2 0 0 1-2-2V2" />
      <path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" />
      <path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15" />
      <path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

"use client";

import AnalyticsSection from "@/components/dashboard/AnalyticsSection";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Analytics</h1>
        <p className="text-sm text-[#697386] mt-1">Cases Over Time, Cases by State, By Status, and By Provider</p>
      </div>

      <AnalyticsSection surface="analytics" />
    </div>
  );
}

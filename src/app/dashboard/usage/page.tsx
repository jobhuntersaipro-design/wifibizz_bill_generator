"use client";

import { CaseUsageScreen } from "@/components/dashboard/CaseUsageScreen";

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Case Usage</h1>
        <p className="text-sm text-[#697386] mt-1">Track your case usage and bill generation history</p>
      </div>

      <CaseUsageScreen />
    </div>
  );
}

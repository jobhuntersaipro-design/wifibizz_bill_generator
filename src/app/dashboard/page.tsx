"use client";

import AnalyticsSection from "@/components/dashboard/AnalyticsSection";
import CaseManagementSection from "@/components/dashboard/CaseManagementSection";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Dashboard</h1>
        <p className="text-sm text-[#697386] mt-1">Analytics overview and case management</p>
      </div>

      {/* Analytics: KPI row, charts, map */}
      <AnalyticsSection />

      {/* Case Management: filters, table, bill actions */}
      <CaseManagementSection />
    </div>
  );
}

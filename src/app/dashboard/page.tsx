"use client";

import AnalyticsSection from "@/components/dashboard/AnalyticsSection";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import CaseManagementSection from "@/components/dashboard/CaseManagementSection";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <GettingStarted />
      {/* Page header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Dashboard</h1>
        <p className="text-sm text-[#697386] mt-1">Case workbench</p>
      </div>

      <AnalyticsSection surface="workbench" />

      {/* Case Management: filters, table, bill actions */}
      <CaseManagementSection />
    </div>
  );
}

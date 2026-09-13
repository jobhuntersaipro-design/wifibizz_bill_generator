"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { DealerSessionBanner } from "@/components/dashboard/DealerSessionBanner";
import PullToRefresh from "@/components/ui/pull-to-refresh";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar onMenuToggle={() => setSidebarOpen((v) => !v)} />
        <DealerSessionBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <PullToRefresh>{children}</PullToRefresh>
        </main>
      </div>
    </div>
  );
}

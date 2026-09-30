"use client";

import { useState } from "react";
import { AdminSidebar } from "./sidebar";
import { AdminTopbar } from "./topbar";
import { AdminChat } from "./admin-chat";

export function AdminShell({
  children,
  chat,
}: {
  children: React.ReactNode;
  /** The admin assistant, when ADMIN_CHAT_ENABLED is on. */
  chat?: { handoffName: string } | null;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopbar onMenuToggle={() => setSidebarOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>
      {chat ? <AdminChat handoffName={chat.handoffName} /> : null}
    </div>
  );
}

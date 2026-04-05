"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { label: "Crawler", href: "/dashboard/crawl", icon: CrawlerIcon },
  { label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-[240px] border-r border-sidebar-border bg-sidebar min-h-screen animate-fade-in-left" style={{ animationDuration: "400ms" }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 animate-fade-in" style={{ animationDelay: "150ms" }}>
        <div className="w-8 h-8 rounded-lg bg-[#635BFF] flex items-center justify-center">
          <WifiIcon className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="font-semibold text-sm text-[#0A2540] leading-none tracking-tight">
            BizzFlow
          </p>
          <p className="text-[11px] text-[#697386] mt-0.5">
            Network Admin
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 stagger-children">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 animate-fade-in-left press-effect",
                isActive
                  ? "bg-[#635BFF] text-white shadow-sm shadow-[#635BFF]/20"
                  : "text-[#425466] hover:bg-[#E3E8EF] hover:text-[#0A2540]"
              )}
            >
              <item.icon
                className={cn(
                  "w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-white" : ""
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 pb-4 space-y-1 animate-fade-in" style={{ animationDelay: "400ms" }}>
        <div className="border-t border-[#E3E8EF] my-3" />
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-[#425466] hover:bg-red-50 hover:text-[#DF1B41] transition-all duration-150 w-full press-effect"
        >
          <LogOutIcon className="w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-110" />
          Logout
        </button>
      </div>
    </aside>
  );
}

function WifiIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h.01" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <path d="M5 12.859a10 10 0 0 1 14 0" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    </svg>
  );
}

function LayoutDashboardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

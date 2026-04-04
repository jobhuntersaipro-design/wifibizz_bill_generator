"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSession } from "next-auth/react";

export function Topbar() {
  const { data: session } = useSession();
  const initials = session?.user?.name
    ? session.user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <header className="flex items-center justify-end h-14 px-8 border-b border-[#E3E8EF] bg-white animate-fade-in-down" style={{ animationDuration: "350ms" }}>
      {/* Right side */}
      <div className="flex items-center gap-3 animate-fade-in" style={{ animationDelay: "300ms" }}>
        <button className="relative p-2 rounded-lg hover:bg-[#F6F9FC] transition-all duration-200 press-effect">
          <BellIcon className="w-[18px] h-[18px] text-[#697386]" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#635BFF] rounded-full ring-2 ring-white animate-pulse-soft" />
        </button>
        <div className="w-px h-6 bg-[#E3E8EF]" />
        <Avatar className="h-8 w-8 cursor-pointer transition-transform duration-200 hover:scale-105">
          <AvatarFallback className="bg-[#635BFF] text-white text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

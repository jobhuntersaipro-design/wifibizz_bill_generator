"use client";

export function Topbar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  return (
    <header className="flex items-center justify-between h-14 px-4 md:px-8 border-b border-[#E3E8EF] bg-white animate-fade-in-down" style={{ animationDuration: "350ms" }}>
      {/* Left side — hamburger on mobile */}
      <button
        onClick={onMenuToggle}
        className="md:hidden p-2 rounded-lg hover:bg-[#F6F9FC] transition-colors"
      >
        <MenuIcon className="w-5 h-5 text-[#697386]" />
      </button>
      <div className="hidden md:block" />
      <div />
    </header>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}


"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavContext } from "@/lib/admin-nav";
import { DesignToggle } from "@/components/design/DesignToggle";
import { Button } from "@/components/ui/button";

/**
 * The admin topbar.
 *
 * On mobile this is the ONLY navigation on screen — the sidebar is a hidden
 * drawer — so it carries where you are and how to get back, rather than the
 * fixed "Administration" it used to show.
 *
 * A detail page swaps the drawer toggle for a back chevron instead of showing
 * both: two navigation controls competing in one 44px strip is how people press
 * the wrong one. The drawer is still one tap away from the parent page.
 */
export function AdminTopbar({
  onMenuToggle,
  // Injectable for the same reason `describeConnection` takes `now`: it makes
  // every route state renderable without navigating to it. Defaults to the
  // real hook, so no caller has to know about it.
  pathname: pathnameProp,
}: {
  onMenuToggle?: () => void;
  pathname?: string;
}) {
  const livePath = usePathname();
  const { title, back } = adminNavContext(pathnameProp ?? livePath ?? "/admin");

  return (
    <header className="flex items-center justify-between h-14 px-2 md:px-8 border-b border-line bg-card">
      <div className="flex min-w-0 items-center gap-1">
        {back ? (
          <Link
            href={back}
            aria-label="Back"
            // 44px, like every other touch target in this app. The old 36px
            // hamburger was under it.
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:hidden"
          >
            <ChevronLeftIcon className="h-5 w-5 text-ink-muted" />
          </Link>
        ) : (
          <Button unstyled variant="ghost" size="icon-sm"
            type="button"
            onClick={onMenuToggle}
            aria-label="Open menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:hidden"
          >
            <MenuIcon className="h-5 w-5 text-ink-muted" />
          </Button>
        )}
        {/* Truncates rather than pushing the ADMIN pill off the right edge. */}
        <h2 className="truncate text-sm font-medium text-ink md:text-ink-muted">
          {title}
        </h2>
      </div>
      <div className="flex shrink-0 items-center gap-3 pr-2 md:pr-0">
        <DesignToggle className="hidden sm:inline-flex" />
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-wash px-2.5 py-1 text-[11px] font-medium text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-[#09825D]" />
          ADMIN
        </span>
      </div>
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

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

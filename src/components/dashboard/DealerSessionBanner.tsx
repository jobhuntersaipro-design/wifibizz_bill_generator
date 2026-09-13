"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDealerConnection } from "@/actions/dealer";
import { hasOrderEntryAccess } from "@/actions/settings";
import {
  DEALER_SESSION_EXPIRED_COPY,
  DEALER_SESSION_RECONNECT_HREF,
  shouldShowDealerSessionBanner,
} from "@/lib/agent-connection";

/** QA only. Production Vercel ignores `?forceDealerExpired=1`. */
function forceExpiredFromQuery(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") return false;
  return new URLSearchParams(window.location.search).get("forceDealerExpired") === "1";
}

export function DealerSessionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (forceExpiredFromQuery()) {
      setVisible(true);
      return;
    }
    let alive = true;
    Promise.all([hasOrderEntryAccess(), getDealerConnection()])
      .then(([orderEntryEnabled, result]) => {
        if (!alive) return;
        setVisible(
          shouldShowDealerSessionBanner({
            orderEntryEnabled,
            sessionExpiresAt: result.success ? result.data?.sessionExpiresAt : null,
          }),
        );
      })
      .catch(() => {
        if (alive) setVisible(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-[#FEDF89] bg-[#FFFAEB] px-4 py-2.5 md:px-8"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#B54708]">
          {DEALER_SESSION_EXPIRED_COPY.title}
        </p>
        <p className="text-xs text-[#B54708]">{DEALER_SESSION_EXPIRED_COPY.body}</p>
      </div>
      <Link
        href={DEALER_SESSION_RECONNECT_HREF}
        className="shrink-0 rounded-lg bg-[#B54708] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#93370D]"
      >
        {DEALER_SESSION_EXPIRED_COPY.cta}
      </Link>
    </div>
  );
}

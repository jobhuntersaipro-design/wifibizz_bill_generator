"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getDealerConnection } from "@/actions/dealer";
import { hasOrderEntryAccess } from "@/actions/settings";
import {
  DEALER_SESSION_EXPIRED_COPY,
  DEALER_SESSION_RECONNECT_HREF,
  forceDealerExpiredFromSearch,
  shouldShowDealerSessionBanner,
} from "@/lib/agent-connection";

export function DealerSessionBanner() {
  const searchParams = useSearchParams();
  const forced = forceDealerExpiredFromSearch(searchParams.toString());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (forced) return;
    let alive = true;
    Promise.all([hasOrderEntryAccess(), getDealerConnection()])
      .then(([orderEntryEnabled, result]) => {
        if (!alive) return;
        setExpired(
          shouldShowDealerSessionBanner({
            orderEntryEnabled,
            sessionExpiresAt: result.success ? result.data?.sessionExpiresAt : null,
          }),
        );
      })
      .catch(() => {
        if (alive) setExpired(false);
      });
    return () => {
      alive = false;
    };
  }, [forced]);

  if (!forced && !expired) return null;

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

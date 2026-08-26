"use client";

import { useEffect, useState } from "react";
import { getOrderHistory } from "@/actions/order";
import type { AttemptView } from "@/lib/order-history";

/**
 * Fetches an order's attempt history, refetching every 4s while the order is
 * live so finished steps join the timeline. Shared by the hero (which needs
 * `attempts[0]` for its step-count stat) and the History tab (which lists
 * every attempt), so both read the same fetch rather than each polling on
 * their own.
 */
export function useOrderAttempts(orderId: string, live: boolean) {
  const [attempts, setAttempts] = useState<AttemptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getOrderHistory(orderId)
        .then((r) => {
          if (!active) return;
          if (r.success) setAttempts(r.attempts);
          else setError(r.error ?? "Couldn't load history.");
        })
        .catch(() => active && setError("Couldn't load history."));
    load();
    if (!live) return () => { active = false; };
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [orderId, live]);

  return { attempts, error };
}

/** Ticks once a second while `live`, so a running order's elapsed time moves. */
export function useTicker(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

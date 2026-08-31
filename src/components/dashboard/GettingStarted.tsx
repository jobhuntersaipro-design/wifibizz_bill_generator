"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getOnboardingState } from "@/actions/settings";

/**
 * Two items, shown only while incomplete and only to order-entry agents.
 * There is no dismiss — completion is the dismissal, judged on the agent's
 * FIRST dealer connection ever, so it never reopens on a lapsed session.
 */
export function GettingStarted() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    getOnboardingState().then((r) => { if (alive) setShow(r.show); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!show) return null;

  return (
    <section className="animate-fade-in-up rounded-xl border border-[#E3E8EF] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#0A2540]">Getting started</h2>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex items-center gap-2 text-[#425466]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ECFDF3]">
            <svg viewBox="0 0 24 24" fill="none" stroke="#027A48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          Password set
        </li>
        <li className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-full border-2 border-[#CBD2DC]" aria-hidden />
          <Link href="/dashboard/order-entry" className="font-medium text-[#635BFF] hover:underline">
            Connect your Unifi dealer account →
          </Link>
        </li>
      </ul>
      <p className="mt-3 text-xs text-[#697386]">
        You need the dealer connection once before you can submit orders. This card disappears when
        it&apos;s done.
      </p>
    </section>
  );
}

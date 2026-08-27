"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import LottieSpot from "@/components/order-entry/LottieSpot";

/** How far the finger must travel before the release commits to a refresh. */
const THRESHOLD = 72;
/** Where the rubber band stops, however hard you pull. */
const MAX_PULL = 120;
/** Finger distance → pull distance. Below 1 so the sheet lags the finger. */
const RESISTANCE = 0.5;
/**
 * Widest viewport the gesture runs on — Tailwind's `md`, the same breakpoint the
 * indicator hides at. Checked in the listener as well as in the class, so a
 * touchscreen laptop cannot swallow a swipe and then show nothing for it.
 */
const MOBILE_MAX = 768;
/**
 * How far from the very top still counts as "at the top", in px.
 *
 * NOT zero, and this is the whole reason the gesture did nothing on a real
 * iPhone while working in every desktop emulation. A scroll container at rest
 * reports an integer 0 in Chromium, but on a device with a fractional device
 * pixel ratio iOS parks it on a sub-pixel value (0.33, 0.5) — so a `<= 0` test
 * is false at the top of the list, the pull never arms, and nothing at all
 * happens. Two pixels is below what a finger can aim at and well above the
 * rounding.
 */
const TOP_SLOP = 2;

/**
 * Is this scroll offset "at the top"?
 *
 * Exported so the sub-pixel case has a test — it is the whole reason the
 * gesture did nothing on a real iPhone, and it is invisible in any emulator
 * that reports an integer 0.
 */
export function isAtTop(scrollTop: number): boolean {
  return scrollTop <= TOP_SLOP;
}

/**
 * The scroll container this touch actually belongs to.
 *
 * NOT `window.scrollY`: the dashboard scrolls an inner `<main class="flex-1
 * overflow-y-auto">`, so the document is pinned at 0 forever and a check
 * against it would arm the pull in the middle of a scrolled list. Walk up from
 * the touched node and find the first ancestor that genuinely scrolls; fall
 * back to the document for the chrome-free detail page, which does.
 */
function scrollerFor(node: EventTarget | null): Element | null {
  let el = node instanceof Element ? node : null;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement;
}

/**
 * Pull down from the top of a page to reload it. Mounted once per shell — the
 * dashboard, the chrome-free order detail page, and the admin panel — so every
 * page inside them has it. Never nest two: the listeners are global, and a
 * second instance would double every pull.
 *
 * On a phone the list is the whole screen and there is no visible Refresh
 * button, so the gesture people already reach for did nothing. A full
 * `location.reload()` is deliberate: the orders list fetches through a client
 * `useEffect`, which `router.refresh()` would not re-run — so the honest
 * implementation of "refresh the page" is to refresh the page.
 *
 * Two guards keep it out of the way of ordinary use:
 *
 * - it arms ONLY when the touched scroller is already at its top, so a pull
 *   inside a scrolled list scrolls;
 * - a swipe that is more horizontal than vertical disarms it outright — the
 *   orders table scrolls sideways, and stealing that gesture would break the
 *   one way to reach the pinned Actions column.
 */
export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // The indicator is PORTALLED to <body>, and that is load-bearing rather than
  // tidiness. `position: fixed` resolves against the nearest ancestor carrying a
  // transform, and this app's entrance animation (`animate-fade-in-up`, with
  // fill-mode both) leaves every card an identity `matrix(1,0,0,1,0,0)` — which
  // still counts. Rendered in place, the indicator measured y=883 on a 844px
  // screen: pinned to the top of a container that was itself below the fold.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const scrollerRef = useRef<Element | null>(null);
  // Read inside the listeners, which are bound once — reading the state values
  // there instead would capture the mount-time zero forever.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    // Chrome on Android runs its OWN pull-to-refresh whenever the document is
    // at the top, which here is always. Without this the two gestures fight and
    // the browser's wins. Restored on unmount — this is a page-level opt-out,
    // not a permanent change to the app.
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";

    const setPullBoth = (value: number) => {
      pullRef.current = value;
      setPull(value);
    };

    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (window.innerWidth >= MOBILE_MAX) return;
      const t = e.touches[0];
      const scroller = scrollerFor(e.target);
      scrollerRef.current = scroller;
      // Armed only from the top — within TOP_SLOP, which is what makes this work
      // on a real device rather than only in emulation.
      startRef.current =
        scroller && isAtTop(scroller.scrollTop) ? { x: t.clientX, y: t.clientY } : null;
    }

    function onTouchMove(e: TouchEvent) {
      const start = startRef.current;
      if (!start || refreshingRef.current) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      const dx = t.clientX - start.x;
      // Upward, or sideways-dominant: not our gesture. Disarm rather than merely
      // ignore, so a pull that begins as a sideways swipe cannot become one.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        startRef.current = null;
        if (pullRef.current) setPullBoth(0);
        return;
      }
      // The scroller can have moved since touchstart (a fling that was still
      // settling). Re-check rather than trust the arm.
      if (!isAtTop(scrollerRef.current?.scrollTop ?? 0)) {
        startRef.current = null;
        if (pullRef.current) setPullBoth(0);
        return;
      }
      e.preventDefault(); // stop the page rubber-banding under the sheet
      setPullBoth(Math.min(MAX_PULL, dy * RESISTANCE));
    }

    function onTouchEnd() {
      startRef.current = null;
      if (refreshingRef.current) return;
      if (pullRef.current >= THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullBoth(THRESHOLD); // hold the indicator open across the reload
        window.location.reload();
        return;
      }
      setPullBoth(0);
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    // Non-passive: preventDefault is the whole point, and a passive listener
    // may not call it.
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      root.style.overscrollBehaviorY = previous;
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const ready = pull >= THRESHOLD;

  return (
    <>
      {mounted &&
        pull > 0 &&
        createPortal(
        <div
          // Fixed, so it is unaffected by whichever container is scrolling, and
          // pinned under the header rather than over it.
          className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center md:hidden"
          style={{
            transform: `translateY(${pull - THRESHOLD / 2}px)`,
            opacity: Math.min(1, pull / (THRESHOLD * 0.6)),
          }}
        >
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-[0_2px_8px_rgba(10,37,64,0.12)] ring-1 ring-[#E3E8EF]">
            {refreshing ? (
              <LottieSpot
                name="processing"
                size={20}
                fallback={
                  <RefreshCw className="h-4 w-4 text-[#635BFF]" aria-hidden="true" />
                }
              />
            ) : (
              <RefreshCw
                className="h-4 w-4 text-[#635BFF] transition-transform duration-150"
                style={{ transform: `rotate(${Math.min(180, (pull / THRESHOLD) * 180)}deg)` }}
                aria-hidden="true"
              />
            )}
            <span className="text-[12px] font-medium text-[#425466]">
              {refreshing ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        </div>,
          document.body,
        )}
      <div role="status" aria-live="polite" className="sr-only">
        {refreshing ? "Refreshing the page" : ""}
      </div>
      {children}
    </>
  );
}

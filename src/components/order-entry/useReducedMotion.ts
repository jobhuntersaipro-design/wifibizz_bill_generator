"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MQ = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MQ);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether the viewer asked for reduced motion.
 *
 * The server snapshot says "reduced": SSR then paints the static fallback and
 * an animation only ever starts client-side — motion is never flashed at a
 * reduced-motion user while we wait to find out.
 */
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MQ).matches,
    () => true,
  );

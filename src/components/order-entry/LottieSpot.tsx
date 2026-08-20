"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

const REDUCED_MQ = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MQ);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// The server snapshot says "reduced": SSR then paints the static fallback and
// the animation only ever starts client-side — motion is never flashed at a
// reduced-motion user while we wait to find out.
const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MQ).matches,
    () => true,
  );

/**
 * One Lottie animation, self-hosted from /public/lottie (no CDN — the files
 * ship with the app).
 *
 * Restraint is the contract: a spot marks a STATE (waiting, success, empty),
 * it never decorates. Under prefers-reduced-motion the player is not rendered
 * at all — the `fallback` (usually whatever icon the spot replaced) shows
 * instead, so no meaning rides on the animation.
 */
export default function LottieSpot({
  name,
  size,
  loop = true,
  className = "",
  fallback = null,
}: {
  /** File name under /public/lottie, without extension. */
  name: "processing" | "success" | "empty-orders" | "otp-reading" | "dropzone";
  size: number;
  /** false = play once and hold the last frame (success moments). */
  loop?: boolean;
  className?: string;
  /** Rendered instead of the animation under prefers-reduced-motion. */
  fallback?: ReactNode;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <>{fallback}</>;
  return (
    <span
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <DotLottieReact src={`/lottie/${name}.lottie`} loop={loop} autoplay />
    </span>
  );
}

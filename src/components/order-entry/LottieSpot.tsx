"use client";

import type { ReactNode } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useReducedMotion } from "./useReducedMotion";

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

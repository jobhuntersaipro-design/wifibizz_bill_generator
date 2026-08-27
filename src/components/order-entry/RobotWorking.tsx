"use client";

import { useReducedMotion } from "./useReducedMotion";

/**
 * The robot at its laptop that marks a submit in flight.
 *
 * An animated WebP rather than a Lottie — it arrived as a raster GIF, and a
 * GIF cannot be paused, so the LottieSpot rule ("no motion under
 * prefers-reduced-motion") is honoured by swapping the file: the static first
 * frame shows instead. SSR paints that frame too, so the loop never flashes
 * before hydration. Self-hosted from /public/animations; the source was
 * shrunk from 480px / 500KB to 192px (2× the largest size it renders at).
 */
export default function RobotWorking({
  size,
  className = "",
}: {
  size: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- an animated WebP;
       next/image would re-encode the loop into a still */
    <img
      src={
        reduced
          ? "/animations/robot-working.png"
          : "/animations/robot-working.webp"
      }
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${className}`}
    />
  );
}

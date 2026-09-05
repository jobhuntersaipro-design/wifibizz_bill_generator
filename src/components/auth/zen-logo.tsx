/**
 * The ZenGarden mark, animated the way the shared logo-animation design plays:
 * the enso circle draws itself, the two sand ripples rake across, and the
 * stone settles in with a small overshoot. Pure CSS/SVG — the keyframes live
 * in globals.css (`zen-draw` / `zen-settle`), whose base state is the finished
 * mark so reduced-motion renders it drawn rather than empty.
 *
 * Stroke follows `currentColor`; only the stone takes its own fill.
 */
export function ZenLogoMark({
  size = 44,
  stone = "#635BFF",
  className = "",
}: {
  size?: number;
  stone?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="14"
        cy="14"
        r="12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        pathLength={100}
        className="zen-draw"
        style={{ animationDelay: "150ms", animationDuration: "1.1s" }}
      />
      <path
        d="M6 12.5c3-1.8 5.5-1.8 8.5 0s5.5 1.8 8.5 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={100}
        className="zen-draw"
        style={{ animationDelay: "900ms" }}
      />
      <path
        d="M6 17c3-1.8 5.5-1.8 8.5 0s5.5 1.8 8.5 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={100}
        className="zen-draw"
        style={{ animationDelay: "1200ms" }}
      />
      <circle
        cx="11"
        cy="9"
        r="2"
        fill={stone}
        className="zen-stone"
        style={{ animationDelay: "1700ms" }}
      />
    </svg>
  );
}

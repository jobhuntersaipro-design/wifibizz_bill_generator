"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, X } from "lucide-react";
import {
  CAPTURE_RETENTION_DAYS,
  captureCaption,
  captureExpiry,
  captureLabel,
  isPdfCapture,
  type CaptureFrame,
} from "@/lib/order-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** The auth-gated R2 proxy. Shared with the timeline rows. */
export const captureSrc = (key: string) =>
  `/api/orders/screenshot?key=${encodeURIComponent(key)}`;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Swipe must beat this to count, so a tap with a shaky finger doesn't navigate. */
const SWIPE_PX = 48;

/**
 * A full-screen viewer for one attempt's captured portal screens.
 *
 * Scoped to ONE attempt deliberately. Answering "was the right device picked?"
 * means comparing frames from the same run; a carousel spanning attempts would
 * put attempt 1's device page next to attempt 2's customer page with nothing but
 * a caption to tell them apart.
 *
 * Built on the Dialog primitive rather than a hand-rolled overlay so the focus
 * trap, focus restore, Escape handling and scroll lock are the primitive's job —
 * the same reason the history panel sits on Sheet. It renders above that Sheet:
 * the Sheet is what opens it.
 */
export function CaptureCarousel({
  captures,
  startIndex,
  onClose,
}: {
  captures: CaptureFrame[];
  startIndex: number;
  onClose: () => void;
}) {
  // Clamp on the way in: a caller that hands us an index for a frame that has
  // since dropped out of the list should show frame 1, not a blank stage.
  const [i, setI] = useState(() =>
    Math.min(Math.max(startIndex, 0), Math.max(captures.length - 1, 0)),
  );
  const touchX = useRef<number | null>(null);

  const last = captures.length - 1;
  const current = captures[i];

  const go = useCallback(
    (delta: number) => {
      // No wrap. In a nine-frame set, wrapping makes "am I at the end?"
      // unanswerable — the disabled chevron is the answer.
      setI((prev) => Math.min(Math.max(prev + delta, 0), last));
    },
    [last],
  );

  // Arrow keys. Bound on document because focus legitimately sits on any of the
  // rail thumbnails, the chevrons, or the close button.
  //
  // CAPTURE phase, and that is load-bearing: the Dialog primitive does its own
  // arrow-key handling for focus management and stops the event before it ever
  // bubbles up to document. Bound on the bubble phase this listener never fires
  // at all — verified in the browser, where ArrowRight only moved the focus ring.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      go(e.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [go]);

  // Warm the neighbours so stepping is instant rather than a skeleton flash.
  // Expired frames are skipped — their objects are gone and would 404.
  useEffect(() => {
    for (const n of [i - 1, i + 1]) {
      const c = captures[n];
      if (!c) continue;
      if (captureExpiry(c.at)?.expired) continue;
      // A PDF is not an image: `new Image()` would fetch it and fail its decode
      // silently, warming nothing while looking like it worked. The iframe
      // fetches it when the slide mounts.
      if (isPdfCapture(c.key)) continue;
      const img = new Image();
      img.src = captureSrc(c.key);
    }
  }, [i, captures]);

  if (!current) return null;

  const expiry = captureExpiry(current.at);
  const src = captureSrc(current.key);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-[#0A1220] p-0 text-white ring-0 top-0 left-0 z-[60] sm:max-w-none"
      >
        <DialogTitle className="sr-only">
          Captured portal screens — {captureLabel(current.slot)}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Use the left and right arrow keys, or the thumbnails below, to move
          between this attempt&apos;s {captures.length} captured screens.
        </DialogDescription>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight">
              {captureLabel(current.slot)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-white/60">
              {time(current.at)}
              {expiry && (
                <span className={expiry.soon ? "ml-2 text-amber-300" : "ml-2"}>
                  {expiry.label}
                </span>
              )}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium tabular-nums text-white/80">
            {i + 1} of {captures.length}
          </span>
          {!expiry?.expired && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-white/80 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:inline-flex"
            >
              Open original <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close capture viewer"
            className="group -mr-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
          >
            <X
              className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90"
              aria-hidden="true"
            />
          </button>
        </header>

        {/* ── Stage ───────────────────────────────────────────────────────── */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-3 sm:px-14"
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const from = touchX.current;
            touchX.current = null;
            if (from === null) return;
            const dx = (e.changedTouches[0]?.clientX ?? from) - from;
            if (Math.abs(dx) < SWIPE_PX) return;
            go(dx < 0 ? 1 : -1);
          }}
        >
          <NavButton
            side="left"
            disabled={i === 0}
            onClick={() => go(-1)}
          />

          {expiry?.expired ? (
            <p className="max-w-sm rounded-xl border border-dashed border-white/20 px-6 py-10 text-center text-[12px] leading-relaxed text-white/60">
              {isPdfCapture(current.key) ? "This document" : "This frame"} passed its{" "}
              {CAPTURE_RETENTION_DAYS}-day retention and has been deleted.
            </p>
          ) : (
            isPdfCapture(current.key) ? (
              <PdfFrame key={current.id} src={src} label={captureLabel(current.slot)} />
            ) : (
              <Frame
                key={current.id}
                src={src}
                alt={`${captureLabel(current.slot)} as the portal rendered it`}
              />
            )
          )}

          <NavButton
            side="right"
            disabled={i === last}
            onClick={() => go(1)}
          />
        </div>

        {/* ── Caption ─────────────────────────────────────────────────────── */}
        <p className="shrink-0 px-4 pb-2 text-center text-[11px] leading-snug text-white/60">
          {captureCaption(current.slot)}
        </p>

        {/* ── Rail ────────────────────────────────────────────────────────── */}
        {captures.length > 1 && (
          <div className="shrink-0 border-t border-white/10 px-3 py-2">
            <ul className="flex justify-start gap-2 overflow-x-auto sm:justify-center">
              {captures.map((c, n) => {
                const gone = captureExpiry(c.at)?.expired;
                return (
                  <li key={c.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setI(n)}
                      aria-label={`Show ${captureLabel(c.slot)}`}
                      aria-current={n === i}
                      title={captureLabel(c.slot)}
                      className={`block h-11 w-16 cursor-pointer overflow-hidden rounded-md border transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                        n === i
                          ? "border-white opacity-100"
                          : "border-white/20 opacity-50 hover:opacity-90"
                      }`}
                    >
                      {gone ? (
                        <span className="flex h-full w-full items-center justify-center bg-white/5 text-[9px] text-white/40">
                          Gone
                        </span>
                      ) : isPdfCapture(c.key) ? (
                        <span className="flex h-full w-full items-center justify-center bg-white/10">
                          <FileText className="h-4 w-4 text-white/70" aria-hidden="true" />
                        </span>
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element --
                           auth-gated private stream */
                        <img
                          src={captureSrc(c.key)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover object-top"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The frame on the stage, with its own load state.
 *
 * A separate component mounted with `key={capture.id}` so stepping to another
 * frame REMOUNTS it and the load state resets on its own — resetting a parent's
 * `loaded` from an effect would be a cascading render for something React's
 * reconciler already does correctly.
 */
function Frame({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div
          className="absolute h-24 w-24 animate-pulse rounded-full bg-white/5"
          aria-hidden="true"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- an auth-gated
          private stream, not an optimisable static asset */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        /* A plain opacity transition rather than a keyframe entrance: the global
           reduced-motion block already flattens transitions, and an entrance
           animation would fight the `opacity-0` that holds a half-decoded frame
           back until onLoad. */
        className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

/**
 * The e-RF, previewed in place.
 *
 * An <iframe> against the same auth-gated route the frames use, so the document
 * is read without leaving the page — which is the whole reason it is stored
 * rather than merely linked. There is no load event worth trusting on a
 * cross-document iframe, so there is no skeleton: the browser paints its own
 * progress inside the viewer.
 *
 * Some browsers (mobile Safari, anything with a PDF plugin disabled) render
 * nothing at all here. The fallback link behind the frame is why that is a
 * degraded preview rather than an empty black rectangle, and the header's
 * "Open original" is the same escape hatch one level up.
 */
function PdfFrame({ src, label }: { src: string; label: string }) {
  return (
    <div className="relative flex h-full w-full max-w-4xl flex-col items-center justify-center px-2 py-2">
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-white/5">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <FileText className="h-6 w-6 text-white/50" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-white/60">
            This browser cannot preview PDFs inline.
          </p>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-medium text-white underline underline-offset-2"
          >
            Open {label}
          </a>
        </div>
        <iframe
          src={src}
          title={label}
          className="relative h-full w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}

/**
 * A stage chevron.
 *
 * Stays mounted and disabled at the ends rather than unmounting: a control that
 * vanishes moves the one beside it, and a disabled arrow is itself the signal
 * that there is nothing further this way.
 */
function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous capture" : "Next capture"}
      className={`absolute ${
        side === "left" ? "left-1 sm:left-3" : "right-1 sm:right-3"
      } top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-opacity duration-150 hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-0 ${
        disabled ? "" : "cursor-pointer"
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

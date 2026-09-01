"use client";

import { useMemo, useState } from "react";
import {
  captureLabel,
  captureSlot,
  isCaptureStage,
  isPdfCapture,
  isScreenshotKey,
  partitionCaptures,
  type CaptureFrame,
} from "@/lib/order-types";
import type { StatusEventView } from "@/lib/order-history";
import { CaptureCarousel } from "@/components/order-entry/CaptureCarousel";

/**
 * The admin-side R2 proxy.
 *
 * Not the agent's `/api/orders/screenshot`: that resolves keys against the
 * CALLER's own namespace, and admin is not a NextAuth user and has none.
 */
export const adminCaptureSrc = (key: string) =>
  `/api/admin/orders/screenshot?key=${encodeURIComponent(key)}`;

/**
 * One attempt's timeline, with its captures as clickable thumbnails.
 *
 * The rows stay in chronological order — a capture sits beside the step it
 * documents, which is what makes "it was already wrong by the offer grid"
 * readable — and clicking one opens the same viewer the agent gets, scoped to
 * this attempt, so the frames can be stepped through with the arrow keys
 * instead of opened one browser tab at a time.
 *
 * A client component because the viewer needs state; the rows themselves are
 * plain data passed down from the server page.
 */
export function AdminAttemptEvents({ events }: { events: StatusEventView[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  // The frames, in the order they were shot. Derived with the same helper the
  // agent timeline uses, so the two cannot disagree about what counts as a
  // capture (a failed capture records its REASON in the same field, and must
  // stay a text row rather than becoming a broken thumbnail).
  const captures: CaptureFrame[] = useMemo(
    () => partitionCaptures(events).captures,
    [events],
  );
  const indexOf = (id: string) => captures.findIndex((c) => c.id === id);

  return (
    <>
      <ul className="mt-3 space-y-1.5">
        {events.map((e) => {
          const shot =
            isCaptureStage(e.stage) && isScreenshotKey(e.message) ? e.message! : null;
          return (
            <li key={e.id} className="flex gap-3 text-xs">
              <span className="w-32 shrink-0 tabular-nums text-[#697386]">
                {e.createdAt.slice(11, 19)}
              </span>
              <span className="w-40 shrink-0 text-[#425466]">{e.stage ?? e.status}</span>
              <span className="min-w-0 text-[#0A2540]">
                {e.errorCode && (
                  <span className="mr-1 rounded bg-[#FEF3F2] px-1 py-0.5 text-[#B42318]">
                    {e.errorCode}
                  </span>
                )}
                {shot ? (
                  <Capture
                    stage={e.stage}
                    objectKey={shot}
                    onOpen={() => {
                      const at = indexOf(e.id);
                      if (at >= 0) setOpenAt(at);
                    }}
                  />
                ) : (
                  e.message ?? ""
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {openAt !== null && (
        <CaptureCarousel
          captures={captures}
          startIndex={openAt}
          onClose={() => setOpenAt(null)}
          srcFor={adminCaptureSrc}
        />
      )}
    </>
  );
}

/**
 * One capture: what it shows, and the frame itself.
 *
 * The R2 key used to render as raw text here, which is how a failure whose
 * whole explanation was in a screenshot stayed unread through eight attempts —
 * seeing it took a hand-written S3 script against the bucket.
 *
 * The e-RF is a PDF and gets a link rather than an <img> that would silently
 * fail to decode. It still travels in the carousel's frame list, so stepping
 * through an attempt reaches it in its own chronological place.
 */
function Capture({
  stage,
  objectKey,
  onOpen,
}: {
  stage: string | null;
  objectKey: string;
  onOpen: () => void;
}) {
  const href = adminCaptureSrc(objectKey);
  const label = captureLabel(captureSlot(stage) ?? "");

  if (isPdfCapture(objectKey)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-[#635BFF] underline">
        {label} (PDF)
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={objectKey}
      className="block cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
    >
      <span className="text-[#635BFF] underline">{label}</span>
      {/* Deliberately an ordinary <img>, not next/image: these are private,
          no-store objects behind an admin cookie, and the image optimiser would
          try to fetch and cache them server-side without one. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={href}
        alt={label}
        loading="lazy"
        className="mt-1 max-h-40 w-full max-w-xs rounded border border-[#E3E8EF] bg-[#F6F9FC] object-contain transition-opacity duration-150 hover:opacity-90"
      />
    </button>
  );
}

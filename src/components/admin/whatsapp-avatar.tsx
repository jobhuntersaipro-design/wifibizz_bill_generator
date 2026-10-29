"use client";

import { useState } from "react";
import { Avatar } from "@/components/arc/components/avatar/avatar";
import { avatarTone } from "@/lib/whatsapp-inbox";

const TONES = [
  "bg-sky-100! text-sky-800! border-sky-200!",
  "bg-emerald-100! text-emerald-800! border-emerald-200!",
  "bg-amber-100! text-amber-800! border-amber-200!",
  "bg-rose-100! text-rose-800! border-rose-200!",
  "bg-violet-100! text-violet-800! border-violet-200!",
  "bg-teal-100! text-teal-800! border-teal-200!",
];

/**
 * Initials on a colour that stays the same per contact. Meta's Cloud API (Dualhook)
 * has no profile-picture endpoint, so a photo only exists with the QR gateway (`photo`).
 */
export function ContactAvatar({
  waId,
  name,
  photo = false,
  size = "md",
}: {
  waId: string;
  name: string | null;
  photo?: boolean;
  size?: "md" | "lg" | "xl";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative inline-flex shrink-0" aria-hidden>
      <Avatar name={name ?? waId.slice(-2).split("").join(" ")} size={size} className={TONES[avatarTone(waId)]} />
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- admin-only proxied image, no optimiser
        <img
          src={`/api/admin/whatsapp/avatar?wa=${waId}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      )}
    </span>
  );
}

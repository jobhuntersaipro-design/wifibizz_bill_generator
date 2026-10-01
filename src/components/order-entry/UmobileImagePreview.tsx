"use client";
import { Button } from "@/components/ui/button";

export function UmobileImagePreview({
  pick,
  busy,
  onReroll,
}: {
  pick: { id: string; filename: string } | null;
  busy: boolean;
  onReroll: () => void;
}) {
  if (!pick) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-wash p-3">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/umobile-images/${pick.id}`}
          alt={pick.filename || "UMobile modem"}
          className="max-h-20 max-w-20 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-ink">UMobile image</p>
        <p className="truncate text-[11px] text-ink-muted" title={pick.filename}>
          {pick.filename || "Selected at random. Umobile Bill will add it as an extra page."}
        </p>
      </div>
      <Button unstyled variant="outline"
        type="button"
        onClick={onReroll}
        disabled={busy}
        className="shrink-0 rounded-md border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50"
      >
        {busy ? "Picking…" : "Re-roll"}
      </Button>
    </div>
  );
}

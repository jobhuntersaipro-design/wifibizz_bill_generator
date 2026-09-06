"use client";

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
    <div className="flex items-center gap-3 rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] p-3">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/umobile-images/${pick.id}`}
          alt={pick.filename || "UMobile modem"}
          className="max-h-20 max-w-20 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[#0A2540]">UMobile image</p>
        <p className="truncate text-[11px] text-[#697386]" title={pick.filename}>
          {pick.filename || "Selected at random. Internet Bill will add it as an extra page."}
        </p>
      </div>
      <button
        type="button"
        onClick={onReroll}
        disabled={busy}
        className="shrink-0 rounded-md border border-[#E3E8EF] bg-white px-3 py-1.5 text-[12px] font-medium text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] disabled:opacity-50"
      >
        {busy ? "Picking…" : "Re-roll"}
      </button>
    </div>
  );
}

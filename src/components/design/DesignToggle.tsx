"use client";

import { applyDesign, type Design } from "@/lib/design";
import { cn } from "@/lib/utils";
import { useDesign } from "./use-design";

const OPTIONS: { value: Design; label: string; hint: string }[] = [
  { value: "classic", label: "Classic", hint: "BizzFlow's original design" },
  { value: "arc", label: "Arc", hint: "The Arc design system from uiarc.dev" },
];

/** Classic ⇄ Arc. Two named pressed-state buttons rather than a switch: both states have a name. */
export function DesignToggle({ className }: { className?: string }) {
  const { design } = useDesign();
  return (
    <div
      role="group"
      aria-label="Design"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-line bg-wash p-0.5", className)}
    >
      {OPTIONS.map((option) => {
        const active = design === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => applyDesign(option.value)}
            className={cn(
              "min-h-8 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
              active ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

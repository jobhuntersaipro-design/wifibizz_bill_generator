"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import {
  DATE_PRESETS,
  formatDateInput,
  fromDateInput,
  presetRange,
  toDateInput,
} from "@/lib/order-types";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * From/To date filter: a trigger showing the current span, opening a two-month
 * range calendar with typed inputs and quick spans.
 *
 * The typed inputs are not a fallback — they are the faster path for a date the
 * agent already knows, and they are what makes this usable by keyboard without
 * arrowing through a grid. The calendar is for picking a span by eye. Both write
 * the same two strings, so they can never disagree.
 */
export function DateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom: string | null;
  dateTo: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = fromDateInput(dateFrom);
  const to = fromDateInput(dateTo);
  const active = !!(dateFrom || dateTo);

  const range: DateRange | undefined = from ? { from, to: to ?? undefined } : undefined;

  const label = active
    ? [formatDateInput(dateFrom) ?? "Any", formatDateInput(dateTo) ?? "Any"].join(" → ")
    : "Any time";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={active ? `Created between ${label}` : "Filter by created date"}
            className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-[13px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              active
                ? "border-brand text-ink"
                : "border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="tabular-nums">{label}</span>
          </button>
        }
      />
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-3">
          {/* Typed entry first: it is the quickest route to a known date and the
              only one that does not require pointing at a grid. */}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="drafts-date-from"
                className="text-[11px] font-medium text-ink-faint"
              >
                From
              </label>
              <input
                id="drafts-date-from"
                type="date"
                value={dateFrom ?? ""}
                max={dateTo ?? undefined}
                onChange={(e) => onChange(e.target.value || null, dateTo)}
                className="h-10 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink transition-colors duration-150 hover:border-line-strong focus:border-brand focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="drafts-date-to"
                className="text-[11px] font-medium text-ink-faint"
              >
                To
              </label>
              <input
                id="drafts-date-to"
                type="date"
                value={dateTo ?? ""}
                min={dateFrom ?? undefined}
                onChange={(e) => onChange(dateFrom, e.target.value || null)}
                className="h-10 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink transition-colors duration-150 hover:border-line-strong focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => {
                  const r = presetRange(p.days);
                  onChange(r.dateFrom, r.dateTo);
                }}
                className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-line pt-2">
            <Calendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={from ?? undefined}
              selected={range}
              onSelect={(r) =>
                onChange(
                  r?.from ? toDateInput(r.from) : null,
                  r?.to ? toDateInput(r.to) : null,
                )
              }
              // Nothing here is created in the future, so offering those days
              // would only produce empty tables.
              disabled={{ after: new Date() }}
              className="sm:hidden"
            />
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={from ?? undefined}
              selected={range}
              onSelect={(r) =>
                onChange(
                  r?.from ? toDateInput(r.from) : null,
                  r?.to ? toDateInput(r.to) : null,
                )
              }
              disabled={{ after: new Date() }}
              className="hidden sm:block"
            />
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              onClick={() => onChange(null, null)}
              disabled={!active}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-brand transition-colors duration-150 hover:bg-brand-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:text-[#B4BCC8] disabled:hover:bg-transparent"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear dates
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-9 cursor-pointer rounded-lg bg-brand px-3 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Done
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

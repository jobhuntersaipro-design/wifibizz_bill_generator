"use client";

import { Search, X } from "lucide-react";
import {
  STATUS_FILTERS,
  STATUS_LABELS,
  activeFilterCount,
  submitBlockedReason,
  type OrderFilters,
} from "@/lib/order-types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DateRangeFilter } from "./DateRangeFilter";
import { BlockedHint } from "./OrderRow";

/**
 * Search, the filter bar, and the bulk bar that appears once rows are selected.
 *
 * Purely presentational — every piece of state lives in OrdersList, which owns
 * the filtering and the batch runner.
 */

/** One labelled `<select>`. Four of these is the filter bar. */
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  const active = value !== "all";
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        /* An engaged filter is outlined in brand colour. Without it a narrowed
           table and an empty one look identical, and the usual explanation for
           "my draft disappeared" is a filter nobody remembers setting. */
        className={`select-chevron h-10 w-full max-w-[220px] cursor-pointer truncate rounded-lg border bg-white pl-3 pr-9 text-[13px] transition-colors duration-150 focus:border-[#635BFF] focus:outline-none ${
          active
            ? "border-[#635BFF] text-[#0A2540]"
            : "border-[#E3E8EF] text-[#425466] hover:border-[#CBD2DC]"
        }`}
      >
        <option value="all">{allLabel ?? `All ${label.toLowerCase()}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function OrdersToolbar({
  filters,
  onChange,
  offers,
  devices,
  selectedCount,
  batchRunning,
  serverBusy,
  serverBusyAgeS,
  serverMaxRuntimeS,
  serverBusyIsMine,
  serverBusyOrderLabel,
  serverSlots,
  serverCapacity,
  onClearSelection,
  onSubmitSelected,
}: {
  filters: OrderFilters;
  onChange: (next: OrderFilters) => void;
  offers: string[];
  devices: string[];
  selectedCount: number;
  batchRunning: boolean;
  /** The droplet is running a browser job — anyone's. See submitBlockedReason. */
  serverBusy?: boolean;
  /** Seconds the server's oldest active job has run — makes the hover text say
   *  how long, and lets a wedged lock be named as stuck rather than "please wait". */
  serverBusyAgeS?: number | null;
  /** The server's own cap on one run; past it a job cannot still be working. */
  serverMaxRuntimeS?: number | null;
  /** The blocking run is on THIS account — not necessarily this person's. */
  serverBusyIsMine?: boolean;
  /** Names the running order, e.g. "ORD-0042 (NAME)". */
  serverBusyOrderLabel?: string | null;
  /** Slots in use / total, for the capacity sentence above concurrency 1. */
  serverSlots?: number | null;
  serverCapacity?: number | null;
  onClearSelection: () => void;
  onSubmitSelected: () => void;
}) {
  const set = <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const active = activeFilterCount(filters);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="drafts-search" className="sr-only">
            Search orders by name, ID number, phone or reference
          </label>
          <input
            id="drafts-search"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search by name, ID, phone or ORD-…"
            className="h-11 w-full rounded-lg border border-[#E3E8EF] bg-white pl-9 pr-3 text-[14px] text-[#0A2540] transition-colors duration-150 placeholder:text-[#8792A2] hover:border-[#CBD2DC] focus:border-[#635BFF] focus:outline-none"
          />
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8792A2]"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Wraps rather than scrolls: a filter you cannot see is one you cannot
          clear, and this row exists to make the table less cramped, not more. */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={(dateFrom, dateTo) =>
            onChange({ ...filters, dateFrom, dateTo })
          }
        />
        <FilterSelect
          id="drafts-status"
          label="Status"
          value={filters.status}
          onChange={(v) => set("status", v)}
          allLabel="All statuses"
          options={STATUS_FILTERS.filter((s) => s !== "all").map((s) => ({
            value: s,
            label: STATUS_LABELS[s] ?? s,
          }))}
        />
        <FilterSelect
          id="drafts-package"
          label="Packages"
          value={filters.offerName}
          onChange={(v) => set("offerName", v)}
          allLabel="All packages"
          options={offers.map((o) => ({ value: o, label: o }))}
        />
        <FilterSelect
          id="drafts-device"
          label="Devices"
          value={filters.deviceName}
          onChange={(v) => set("deviceName", v)}
          allLabel="All devices"
          options={devices.map((d) => ({ value: d, label: d }))}
        />

        {active > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                query: "",
                status: "all",
                dateFrom: null,
                dateTo: null,
                offerName: "all",
                deviceName: "all",
              })
            }
            className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-[#635BFF] transition-colors duration-150 hover:bg-[#EDEBFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear {active} filter{active > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Bulk action bar — only submittable drafts are ever selectable, so this
          never offers to batch something that needs a per-order confirmation. */}
      {selectedCount > 0 && (
        <TooltipProvider delay={150} closeDelay={0}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#635BFF]/30 bg-[#635BFF]/5 px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#0A2540]">
            {selectedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearSelection}
              disabled={batchRunning}
              className="cursor-pointer rounded-md border border-[#E3E8EF] bg-white px-3 py-2 text-[12px] text-[#425466] transition-colors duration-150 hover:border-[#635BFF] disabled:opacity-50"
            >
              Clear
            </button>
            <BlockedHint reason={batchRunning ? null : submitBlockedReason({
              serverBusy, serverBusyAgeS, serverMaxRuntimeS,
              serverBusyIsMine, serverBusyOrderLabel, serverSlots, serverCapacity,
            })}>
            <button
              type="button"
              onClick={onSubmitSelected}
              disabled={batchRunning || serverBusy}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#635BFF] px-3 py-2 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchRunning ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Submitting…
                </>
              ) : (
                `Submit Selected (${selectedCount})`
              )}
            </button>
            </BlockedHint>
          </div>
        </div>
        </TooltipProvider>
      )}
    </div>
  );
}

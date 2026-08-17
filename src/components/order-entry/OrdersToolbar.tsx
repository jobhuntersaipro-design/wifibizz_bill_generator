"use client";

import { Search } from "lucide-react";
import { STATUS_FILTERS, STATUS_LABELS } from "@/lib/order-types";

/**
 * Search, status filter, and the bulk bar that appears once rows are selected.
 *
 * Purely presentational — every piece of state lives in OrdersList, which owns
 * the filtering and the batch runner.
 */
export function OrdersToolbar({
  query,
  onQueryChange,
  statusFilter,
  onStatusChange,
  selectedCount,
  batchRunning,
  onClearSelection,
  onSubmitSelected,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  selectedCount: number;
  batchRunning: boolean;
  onClearSelection: () => void;
  onSubmitSelected: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="drafts-search" className="sr-only">
            Search drafts by name or ID number
          </label>
          <input
            id="drafts-search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name or ID number"
            className="h-11 w-full rounded-lg border border-[#E3E8EF] bg-white pl-9 pr-3 text-[14px] text-[#0A2540] transition-colors duration-150 placeholder:text-[#8792A2] hover:border-[#CBD2DC] focus:border-[#635BFF] focus:outline-none"
          />
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8792A2]"
            aria-hidden="true"
          />
        </div>
        <label htmlFor="drafts-status" className="sr-only">
          Filter by status
        </label>
        <select
          id="drafts-status"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="select-chevron h-11 cursor-pointer rounded-lg border border-[#E3E8EF] bg-white pl-3 pr-9 text-[14px] text-[#0A2540] transition-colors duration-150 hover:border-[#CBD2DC] focus:border-[#635BFF] focus:outline-none"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action bar — only submittable drafts are ever selectable, so this
          never offers to batch something that needs a per-order confirmation. */}
      {selectedCount > 0 && (
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
            <button
              type="button"
              onClick={onSubmitSelected}
              disabled={batchRunning}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#635BFF] px-3 py-2 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540] disabled:opacity-50"
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
          </div>
        </div>
      )}
    </div>
  );
}

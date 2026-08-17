"use client";

import { Fragment } from "react";
import type { OrderListItem, StageDetails } from "@/lib/order-types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderCard, OrderRow, type RowActions } from "./OrderRow";
import { SubmitProgress } from "./SubmitProgress";

/**
 * Column visibility, kept in one place so the header and the colspan agree.
 *
 * `null` means always visible. The table itself only renders at ≥768px — below
 * that the card list takes over, because sliding a ten-column grid sideways
 * loses the name column that anchors every row.
 *
 * The breakpoints are deliberately one step later than the raw viewport widths
 * would suggest: the dashboard sidebar eats ~236px, so a 1280px viewport leaves
 * roughly 980px of table. Revealing the address at `xl` on that basis was what
 * pushed Full Name off the left edge in the first place.
 */
const COLUMNS: { key: string; label: string; at: string | null; align?: string }[] =
  [
    { key: "select", label: "", at: null },
    { key: "name", label: "Full Name", at: null },
    { key: "reference", label: "BizzFlow Order ID", at: "lg" },
    { key: "idNumber", label: "ID Number", at: "xl" },
    { key: "package", label: "Package", at: null },
    { key: "device", label: "Device", at: "xl" },
    { key: "address", label: "Installation Address", at: "2xl" },
    { key: "status", label: "Status", at: null },
    { key: "orderNo", label: "Order No.", at: "lg" },
    { key: "actions", label: "", at: null, align: "text-right" },
  ];

const HIDE: Record<string, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

/**
 * The two columns that stay put when the table scrolls sideways.
 *
 * Breakpoints alone cannot solve this: they measure the viewport, not the space
 * left after the sidebar, so on some widths the grid genuinely does not fit and
 * scrolls. When it does, the name is the one thing that must not leave — it is
 * what tells the agent which row they are reading.
 *
 * `bg-inherit` rather than a literal colour, so the row's hover state shows
 * through the pinned cells instead of leaving two opaque white gaps.
 */
const PIN_SELECT = "sticky left-0 z-20 bg-inherit";
const PIN_NAME = "sticky left-10 z-20 bg-inherit";

export function OrdersTable({
  orders,
  isSuperAdmin,
  selectableIds,
  allSelected,
  someSelected,
  batchRunning,
  expanded,
  stageDetails,
  actionsFor,
  onToggleAll,
}: {
  orders: OrderListItem[];
  isSuperAdmin: boolean;
  selectableIds: string[];
  allSelected: boolean;
  someSelected: boolean;
  batchRunning: boolean;
  expanded: Set<string>;
  stageDetails: Record<string, StageDetails>;
  actionsFor: (o: OrderListItem) => RowActions;
  onToggleAll: (ids: string[], checked: boolean) => void;
}) {
  // "Made By" is a superadmin-only column sitting between Device and Address.
  const columns = isSuperAdmin
    ? COLUMNS.flatMap((c) =>
        c.key === "device"
          ? [c, { key: "madeBy", label: "Made By", at: "xl" }]
          : [c],
      )
    : COLUMNS;
  const colSpan = columns.length;

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-[#E3E8EF] bg-white px-4 py-10 text-center text-[13px] text-[#697386]">
        No orders match your search.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E3E8EF] bg-white">
      {/* ── Cards (<768px) ─────────────────────────────────────────────────── */}
      <ul className="md:hidden">
        {orders.map((o) => (
          <Fragment key={o.id}>
            <OrderCard o={o} a={actionsFor(o)} isSuperAdmin={isSuperAdmin} />
            {expanded.has(o.id) && o.status === "submitting" && (
              <li className="border-b border-[#E3E8EF] last:border-0">
                <SubmitProgress
                  stage={o.stage}
                  status={o.status}
                  errorMessage={o.errorMessage}
                  orderId={o.orderId}
                  details={stageDetails[o.id]}
                />
              </li>
            )}
          </Fragment>
        ))}
      </ul>

      {/* ── Table (≥768px) ─────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <Table className="text-[13px]">
          <TableHeader>
            {/* No fill, no uppercase tracking: the header labels the columns,
                it doesn't need to compete with the data underneath. */}
            <TableRow className="border-b border-[#E3E8EF] bg-white hover:bg-white">
              {columns.map((c) =>
                c.key === "select" ? (
                  <TableHead key={c.key} className={`w-10 px-4 py-3 ${PIN_SELECT}`}>
                    <Checkbox
                      aria-label="Select all submittable drafts"
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      disabled={selectableIds.length === 0 || batchRunning}
                      onCheckedChange={(checked) =>
                        onToggleAll(selectableIds, checked === true)
                      }
                      className="cursor-pointer border-[#CBD2DC] data-checked:border-[#635BFF] data-checked:bg-[#635BFF] data-indeterminate:border-[#635BFF] data-indeterminate:bg-[#635BFF]"
                    />
                  </TableHead>
                ) : (
                  <TableHead
                    key={c.key}
                    className={`px-4 py-3 text-[11px] font-medium text-[#8792A2] ${
                      c.at ? HIDE[c.at] : ""
                    } ${c.key === "name" ? PIN_NAME : ""} ${c.align ?? ""}`}
                  >
                    {c.label}
                    {/* Named for its source: this number is the portal's, not
                        ours, and only exists once Unifi has minted it. */}
                    {c.key === "orderNo" && (
                      <span className="ml-1 text-[10px] text-[#B4BCC8]">Unifi</span>
                    )}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <Fragment key={o.id}>
                <OrderRow o={o} a={actionsFor(o)} isSuperAdmin={isSuperAdmin} />
                {expanded.has(o.id) && o.status === "submitting" && (
                  <TableRow className="border-b border-[#E3E8EF] hover:bg-transparent">
                    <TableCell colSpan={colSpan} className="p-0">
                      <SubmitProgress
                        stage={o.stage}
                        status={o.status}
                        errorMessage={o.errorMessage}
                        orderId={o.orderId}
                        details={stageDetails[o.id]}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

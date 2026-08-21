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
import { TooltipProvider } from "@/components/ui/tooltip";
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
    { key: "phone", label: "Phone Number", at: "xl" },
    { key: "package", label: "Package", at: null },
    // Device drops to 2xl so the ADDRESS can come up to xl. Both cannot be at
    // xl: bounded at their max widths the row still overruns the ~1044px a
    // 1280px viewport leaves after the sidebar, and the column that gets pushed
    // out of sight is whichever one is furthest right. The address was the one
    // asked for, and the device is still on the card and in Details.
    { key: "device", label: "Device", at: "2xl" },
    { key: "address", label: "Installation Address", at: "xl" },
    { key: "created", label: "Created At", at: "2xl" },
    // Only completed orders have one, so this column is mostly dashes — and it
    // sits beside Status and Order No. deliberately, where the rows that do
    // have a date are the rows the eye is already on. `lg`, not `2xl`: an
    // installation date is what an agent chases a customer about, so it must
    // survive further into the narrow widths than Created At does.
    { key: "installation", label: "Installation Date", at: "lg" },
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
/**
 * Actions pin to the RIGHT for the same reason Name pins to the left.
 *
 * Adding Phone, Created and the address at `xl` makes the grid genuinely wider
 * than the ~1200px a 1440px viewport leaves after the sidebar, so it scrolls —
 * and the first thing to leave was Submit and the `⋯` menu, which is where
 * every row action now lives. A row you can read but cannot act on is worse than
 * one that scrolls.
 */
const PIN_ACTIONS = "sticky right-0 z-20 bg-inherit";

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
  // "Made By" is a superadmin-only column sitting between Phone and Package.
  //
  // It MUST be spliced at the same point the row renders it. This used to be
  // attached after Device while `OrderRow` emitted the cell before Package, so
  // for superadmins every header from Package rightward labelled the wrong
  // column — a silent mislabel, since the table still rendered fine and only the
  // headings lied. Changing either side alone re-breaks it.
  const columns = isSuperAdmin
    ? COLUMNS.flatMap((c) =>
        c.key === "phone"
          ? [c, { key: "madeBy", label: "Made By", at: "2xl" }]
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
    /* One Provider for the whole table so the tooltips share a delay and a
       grouping: once one has opened, moving along a row reveals the next
       immediately instead of re-waiting. Reading across a row is the actual
       task, and a per-tooltip delay makes that feel broken. */
    <TooltipProvider delay={150} closeDelay={0}>
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
                  errorCode={o.errorCode}
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
                      aria-label="Select all submittable orders"
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
                    className={`bg-white px-4 py-3 text-[11px] font-medium text-[#8792A2] ${
                      c.at ? HIDE[c.at] : ""
                    } ${c.key === "name" ? PIN_NAME : ""} ${
                      c.key === "actions" ? PIN_ACTIONS : ""
                    } ${c.align ?? ""}`}
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
                        errorCode={o.errorCode}
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
    </TooltipProvider>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { Check, ListTree, MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  STATUS_LABELS,
  canResubmit,
  canSubmit,
  createdParts,
  formatCreated,
  formatCreatedFull,
  needsVoiding,
  type OrderListItem,
} from "@/lib/order-types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[#E3E8EF] text-[#425466]",
  submitting: "bg-amber-100 text-amber-700",
  order_entered: "bg-green-100 text-green-700",
  submitted: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

/**
 * The full installation address. Prefer the portal's own concatAddress when the
 * address was confirmed against Unifi — that string is the record of truth —
 * and otherwise rebuild it from the fields the agent typed.
 */
export function formatAddress(o: OrderListItem): string {
  if (o.addressFull?.trim()) return o.addressFull.trim();
  return [o.street, [o.postcode, o.city].filter(Boolean).join(" "), o.state]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * "Verified" means the portal returned a unit for this address and we kept its
 * resourceInstId — not merely that the agent typed something well-formed.
 */
const isVerified = (o: OrderListItem) => !!o.addressId?.trim();

/** A row shows a way into its history once there is any history to show. */
export const hasHistory = (o: OrderListItem) =>
  o.status === "submitting" ||
  ((o.status === "failed" || o.status === "warning") && !!o.stage) ||
  // Order Entered is listed on its own rather than left to `attempt > 0`: it is
  // now the ONLY route to the portal number for such a row, since the Order No.
  // column shows completed orders only. A row that reached the portal must never
  // depend on an attempt counter to offer a way in.
  o.status === "order_entered" ||
  o.attempt > 0 ||
  !!o.errorMessage;

const portalUrl = (orderId: string) =>
  `https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails?custOrderId=${orderId}&custOrderNbr=${orderId}`;

/** Everything a row needs to act, passed down from OrdersList. */
export interface RowActions {
  busy: boolean;
  batchRunning: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSubmit: () => void;
  onResubmit: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowHistory: () => void;
}

/* ── Shared cell fragments ────────────────────────────────────────────────── */

/**
 * Is this element's text actually cut off right now?
 *
 * Measured rather than assumed, because whether a value clips depends on the
 * column width at this breakpoint, not on the string. A tooltip that repeats
 * text the user can already read in full is noise, and noise on every cell of
 * every row is how people learn to ignore tooltips entirely.
 *
 * A ResizeObserver, not a one-shot measure: the columns change width when the
 * window does, so a value that fits at 1920 clips at 1440 and must gain its
 * tooltip without a remount.
 */
function useIsClipped(ref: React.RefObject<HTMLElement | null>, text: unknown) {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, text]);
  return clipped;
}

/**
 * One line, clipped, with the full value on hover AND on keyboard focus.
 *
 * `truncate` needs something to truncate against: a table cell sizes to its
 * content unless bounded, so the `max-w-*` on the CELL is what makes this work
 * at all — the class alone does nothing. Hence a component, rather than trusting
 * every call site to remember both halves.
 *
 * This used to use the native `title`. The attribute carried the right value,
 * but as a way to READ a cut-off address it failed: about a second of hover
 * before anything appears, OS-rendered text at a size the rest of the UI does
 * not control, and nothing at all for keyboard users. The Tooltip primitive
 * replaces it and closes the accessibility gap `title` was knowingly carrying.
 *
 * The tooltip is only ENABLED when the text is genuinely clipped, or when the
 * hover text differs from what is shown (Created At shows minutes and reveals
 * seconds). Repeating a value the user can already read in full, on every cell
 * of every row, is how people learn to ignore tooltips.
 *
 * The trigger is rendered unconditionally and merely disabled, rather than
 * swapped in once clipping is detected. Swapping mounts a DIFFERENT node, and
 * the ResizeObserver's closure keeps measuring the old detached one — which
 * reports 0×0, reads as "not clipped", and flips the state straight back. That
 * oscillation is what the first version of this component actually did.
 */
function OneLine({
  text,
  className = "",
  title,
}: {
  text: string | null | undefined;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clipped = useIsClipped(ref, text);
  const has = !!text?.trim();
  const full = title ?? text ?? "";
  const worthShowing = has && (clipped || (!!title && title !== text));

  if (!has) return <span className="text-[#8792A2]">—</span>;

  return (
    <Tooltip disabled={!worthShowing}>
      {/* `render` so the trigger IS the truncated line — the primitive's default
          button would put a button in every cell and restyle the text. Focusable
          only when it has something to reveal, so the table does not grow a tab
          stop on every cell that already reads in full. */}
      <TooltipTrigger
        render={
          <div
            ref={ref}
            tabIndex={worthShowing ? 0 : undefined}
            className={`truncate rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] ${className}`}
          >
            {text}
          </div>
        }
      />
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  );
}

function StatusBadge({ o }: { o: OrderListItem }) {
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
        STATUS_STYLES[o.status] ?? STATUS_STYLES.draft
      }`}
    >
      {o.status === "submitting" && (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
      )}
      {STATUS_LABELS[o.status] ?? o.status}
    </span>
  );
}

function OrderNumber({ o }: { o: OrderListItem }) {
  // The column carries COMPLETED orders only. A run that stopped part-way can
  // still have a number — the portal mints it early — but showing it here reads
  // as "this order went through", which is the opposite of true. Those rows
  // keep their "Needs voiding" flag and reach the number through Details.
  if (o.status !== "submitted") {
    return o.orderId ? (
      <span className="text-[12px] text-[#8792A2]">—</span>
    ) : (
      // Absence is meaningful: the portal has not minted a number for this draft
      // yet, which is not the same as "unknown".
      <span className="text-[12px] text-[#8792A2]">Not yet issued</span>
    );
  }
  if (!o.orderId) {
    return <span className="text-[12px] text-[#8792A2]">Not yet issued</span>;
  }
  return (
    <a
      href={portalUrl(o.orderId)}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium tabular-nums text-[#635BFF] hover:underline"
      title="Open the order on the Unifi dealer portal (may take a moment to appear after creation)"
    >
      {o.orderId}
      <svg
        className="h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 3h6v6M10 14 21 3M18 13v8H3V6h8" />
      </svg>
    </a>
  );
}

function Remarks({ text }: { text: string }) {
  return (
    <div className="mt-1 flex min-w-0 items-start gap-1 text-[11px] text-[#8792A2]">
      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <OneLine text={text} className="leading-snug" />
    </div>
  );
}

function Address({ o }: { o: OrderListItem }) {
  const address = formatAddress(o);
  if (!address) return <span className="text-[#8792A2]">—</span>;
  return (
    <div className="min-w-0">
      <OneLine text={address} className="leading-snug" />
      {/* Verification is the NORMAL state for a confirmed address, so it
          whispers. A filled pill on nearly every row trains the eye to ignore
          it — and then the rows that lack it stop standing out, which is the
          only thing this mark is for. */}
      {isVerified(o) && (
        <span
          className="badge-verified mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-green-700"
          title="This address was matched against the Unifi dealer portal"
        >
          <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.5} aria-hidden="true" />
          Verified on Unifi
        </span>
      )}
    </div>
  );
}

/**
 * The row's one visible button.
 *
 * Exactly one, or none. Three same-weight buttons is what made the old Actions
 * column unscannable — Delete sat beside Submit at identical size, differing
 * only in colour. Resubmit is deliberately NOT styled as the filled primary:
 * it is a different act from submitting a fresh draft and must not be reachable
 * by muscle memory.
 */
function PrimaryAction({ o, a }: { o: OrderListItem; a: RowActions }) {
  if (canSubmit(o)) {
    return (
      <button
        type="button"
        disabled={a.busy || a.batchRunning}
        onClick={a.onSubmit}
        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#635BFF] px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] disabled:opacity-50"
      >
        {a.busy ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Submitting…
          </>
        ) : (
          "Submit"
        )}
      </button>
    );
  }
  if (canResubmit(o)) {
    return (
      <button
        type="button"
        disabled={a.busy || a.batchRunning}
        onClick={a.onResubmit}
        title="This order already exists in the portal — resubmitting needs the old one voided first"
        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#C2740B] px-3 py-2 text-[13px] font-semibold text-[#C2740B] transition-colors duration-150 hover:bg-[#FDF6EC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2740B] disabled:opacity-50"
      >
        {a.busy ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#C2740B] border-t-transparent" />
            Submitting…
          </>
        ) : (
          "Resubmit"
        )}
      </button>
    );
  }
  return null;
}

/**
 * Every row action that is not the primary button: Details, Edit, Delete.
 *
 * Which of the three appear is decided per status, and the two exclusions are
 * load-bearing rather than tidiness:
 *
 * - **Submitted** withholds Edit and Delete — that row is a portal record, and
 *   editing or deleting our copy only desynchronises the two. It still gets
 *   Details, because the capture carousel is reachable through nothing else.
 *   Rendering no menu at all here (as this component used to) would have
 *   deleted the only route to a completed order's evidence the moment Details
 *   moved in from the Status cell.
 * - **Order Entered** withholds Edit for the same reason one step earlier: the
 *   portal has already minted a real order number against the draft, so editing
 *   our side changes nothing at Unifi and makes the two disagree. Delete stays —
 *   the agent may well want the row gone once the order is voided — and Details
 *   stays because, while `do_pay` is FALSE, it is the ONLY place that row's
 *   portal order number is shown.
 */
function RowMenu({ o, a }: { o: OrderListItem; a: RowActions }) {
  const showDetails = hasHistory(o);
  // A portal record is never ours to edit or delete.
  const isPortalRecord = o.status === "submitted";
  const showEdit = !isPortalRecord && o.status !== "order_entered";
  const showDelete = !isPortalRecord;
  // Nothing to offer — render nothing, rather than an empty menu that opens
  // onto a blank panel.
  if (!showDetails && !showEdit && !showDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={a.busy || a.batchRunning}
        aria-label={`More actions for ${o.fullName}`}
        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF] disabled:opacity-40"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {showDetails && (
          <DropdownMenuItem
            onClick={a.onShowHistory}
            className="cursor-pointer text-[13px] text-[#425466]"
          >
            <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
            Details
            {/* The attempt count rode on the old standalone button. It is the
                quickest signal that a row has been retried, so it moves with
                the action rather than being dropped. */}
            {o.attempt > 1 && (
              <span className="ml-auto tabular-nums text-[11px] text-[#8792A2]">
                {o.attempt}
              </span>
            )}
          </DropdownMenuItem>
        )}
        {showEdit && (
          <DropdownMenuItem
            onClick={a.onEdit}
            className="cursor-pointer text-[13px] text-[#425466]"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit draft
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            variant="destructive"
            onClick={a.onDelete}
            className="cursor-pointer text-[13px]"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The creation date over its time.
 *
 * Two lines rather than one so neither half has to be read past the other: the
 * date is what you scan a column for, and the time only matters once you have
 * found the day. Stacking also lets the column be narrow enough to survive
 * alongside everything else in the row.
 */
function CreatedAt({ iso }: { iso: string }) {
  const parts = createdParts(iso);
  if (!parts) return <span className="text-[12px] text-[#8792A2]">—</span>;
  return (
    <span
      className="block whitespace-nowrap text-[12px] leading-tight tabular-nums text-[#425466]"
      title={formatCreatedFull(iso)}
    >
      {parts.date}
      <span className="mt-0.5 block text-[11px] text-[#8792A2]">{parts.time}</span>
    </span>
  );
}

function NeedsVoiding() {
  return (
    <span
      className="mt-1 block whitespace-nowrap text-[10px] font-medium text-amber-700"
      title="This order exists in the portal but never completed — void it there"
    >
      Needs voiding
    </span>
  );
}

/* ── The table row (≥768px) ───────────────────────────────────────────────── */

export function OrderRow({
  o,
  a,
  isSuperAdmin,
}: {
  o: OrderListItem;
  a: RowActions;
  isSuperAdmin: boolean;
}) {
  return (
    /* An explicit `bg-white` so the pinned cells' `bg-inherit` has a colour to
       inherit — without it they are transparent and the scrolled columns show
       straight through them. */
    <TableRow className="border-b border-[#E3E8EF] bg-white transition-colors duration-150 hover:bg-[#F6F9FC]">
      <TableCell className="sticky left-0 z-20 bg-inherit px-4 py-4 align-middle">
        {canSubmit(o) && (
          <Checkbox
            aria-label={`Select ${o.fullName}`}
            checked={a.selected}
            disabled={a.batchRunning}
            onCheckedChange={a.onToggleSelect}
            className="cursor-pointer border-[#CBD2DC] data-checked:border-[#635BFF] data-checked:bg-[#635BFF]"
          />
        )}
      </TableCell>

      <TableCell className="sticky left-10 z-20 max-w-[200px] bg-inherit px-4 py-4 align-middle">
        <OneLine
          text={o.fullName}
          className="text-[14px] font-semibold leading-snug text-[#0A2540]"
        />
        {/* The reference rides under the name below lg, where its own column is
            hidden — losing the quotable id entirely would be worse. */}
        <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-[#635BFF] lg:hidden">
          {o.reference ?? "—"}
        </span>
      </TableCell>

      <TableCell className="hidden px-4 py-4 align-middle lg:table-cell">
        <span className="whitespace-nowrap text-[12px] font-medium tabular-nums text-[#635BFF]">
          {o.reference ?? "—"}
        </span>
      </TableCell>

      <TableCell className="hidden max-w-[140px] px-4 py-4 align-middle xl:table-cell">
        <OneLine
          text={o.idNumber}
          className="text-[12px] tabular-nums text-[#425466]"
        />
        <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-[#8792A2]">
          {o.idType}
        </span>
      </TableCell>

      <TableCell className="hidden max-w-[150px] px-4 py-4 align-middle xl:table-cell">
        <OneLine
          text={o.phone}
          className="text-[12px] tabular-nums text-[#425466]"
        />
      </TableCell>

      {isSuperAdmin && (
        <TableCell className="hidden max-w-[170px] px-4 py-4 align-middle text-[12px] text-[#425466] 2xl:table-cell">
          <OneLine text={o.createdByEmail} />
        </TableCell>
      )}

      <TableCell className="max-w-[220px] px-4 py-4 align-middle text-[13px] text-[#425466]">
        <OneLine text={o.offerName} className="leading-snug" />
        {o.remarks?.trim() && <Remarks text={o.remarks} />}
      </TableCell>

      <TableCell className="hidden max-w-[190px] px-4 py-4 align-middle text-[13px] text-[#425466] 2xl:table-cell">
        <OneLine text={o.deviceName} className="leading-snug" />
      </TableCell>

      <TableCell className="hidden max-w-[240px] px-4 py-4 align-middle text-[13px] text-[#425466] xl:table-cell">
        <Address o={o} />
      </TableCell>

      <TableCell className="hidden max-w-[120px] px-4 py-4 align-middle 2xl:table-cell">
        <CreatedAt iso={o.createdAt} />
      </TableCell>

      <TableCell className="px-4 py-4 align-middle">
        <StatusBadge o={o} />
        {needsVoiding(o) && <NeedsVoiding />}
      </TableCell>

      <TableCell className="hidden px-4 py-4 align-middle lg:table-cell">
        <OrderNumber o={o} />
      </TableCell>

      {/* Pinned right — see PIN_ACTIONS in OrdersTable. The left border is what
          separates it from whatever scrolls underneath; without it the pinned
          cell reads as part of the column it happens to be covering. */}
      <TableCell className="sticky right-0 z-20 border-l border-[#E3E8EF] bg-inherit px-4 py-4 align-middle">
        <div className="flex items-center justify-end gap-1">
          <PrimaryAction o={o} a={a} />
          <RowMenu o={o} a={a} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ── The card (<768px) ────────────────────────────────────────────────────── */

/**
 * Below 768px the table becomes a list of cards.
 *
 * Scrolling a ten-column grid sideways loses the name column that anchors every
 * row, which is the one thing an agent needs to keep in view — so the layout
 * changes shape rather than overflowing.
 */
export function OrderCard({
  o,
  a,
  isSuperAdmin,
}: {
  o: OrderListItem;
  a: RowActions;
  isSuperAdmin: boolean;
}) {
  const address = formatAddress(o);
  return (
    <li className="border-b border-[#E3E8EF] px-4 py-4 last:border-0">
      <div className="flex items-start gap-3">
        {canSubmit(o) && (
          <Checkbox
            aria-label={`Select ${o.fullName}`}
            checked={a.selected}
            disabled={a.batchRunning}
            onCheckedChange={a.onToggleSelect}
            className="mt-1 cursor-pointer border-[#CBD2DC] data-checked:border-[#635BFF] data-checked:bg-[#635BFF]"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-[#0A2540]">
            {o.fullName}
          </p>
          <p className="mt-0.5 text-[11px] font-medium tabular-nums text-[#635BFF]">
            {o.reference ?? "—"}
            <span className="ml-2 font-normal text-[#8792A2]">
              {o.idType} · {o.idNumber}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <StatusBadge o={o} />
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <Field label="Phone" value={o.phone} />
        <Field label="Package" value={o.offerName} />
        <Field label="Device" value={o.deviceName} />
        <Field label="Address" value={address || null} />
        <Field label="Created At" value={formatCreated(o.createdAt)} />
        {isSuperAdmin && <Field label="Made by" value={o.createdByEmail ?? null} />}
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-[#8792A2]">Order No.</dt>
          <dd className="min-w-0 flex-1">
            <OrderNumber o={o} />
          </dd>
        </div>
      </dl>

      {needsVoiding(o) && <NeedsVoiding />}

      {/* Details moved into the menu with Edit and Delete, so the card does not
          show it twice. A card has one primary button and one `⋯`, same as a
          row — the layout changes shape below 768px, the action model does not. */}
      <div className="mt-3 flex items-center gap-2">
        <PrimaryAction o={o} a={a} />
        <div className="ml-auto">
          <RowMenu o={o} a={a} />
        </div>
      </div>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-[#8792A2]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[#425466]">{value}</dd>
    </div>
  );
}

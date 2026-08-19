"use client";

import { Trash2 } from "lucide-react";
import type { OrderListItem } from "@/lib/order-types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The gate in front of deleting an order.
 *
 * Delete used to fire on a single click of a menu item, with no way back — the
 * row and its whole submit history went in one gesture.
 *
 * Two cases, and they are not equally serious. A draft is ours alone, so losing
 * it costs re-typing. A row that already carries a portal order number is a
 * RECORD of something that exists at Unifi: deleting it removes our only trace
 * of that order — its number, its captures, its attempt history — while the
 * order itself stays live in the portal. The copy below says which case the
 * agent is in rather than asking "are you sure?" twice in the same words.
 */
export function DeleteOrderDialog({
  order,
  onConfirm,
  onCancel,
}: {
  order: OrderListItem;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inPortal = !!order.orderId;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        aria-describedby="delete-warning"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100"
              aria-hidden="true"
            >
              <Trash2 className="h-3.5 w-3.5 text-[#DF1B41]" />
            </span>
            {inPortal ? "Delete this order record?" : "Delete this draft?"}
          </DialogTitle>
        </DialogHeader>

        <DialogDescription
          id="delete-warning"
          className="text-[13px] leading-relaxed text-[#425466]"
        >
          <span className="font-semibold text-[#0A2540]">{order.fullName}</span>
          {order.reference ? ` (${order.reference})` : ""}
          {inPortal ? (
            <>
              {" "}was placed in the Unifi portal as order{" "}
              <span className="font-semibold tabular-nums text-[#0A2540]">
                {order.orderId}
              </span>
              . Deleting removes it here only — the portal order stays live, and
              this is the last place its number, screenshots and submit history
              are kept.
            </>
          ) : (
            <> will be permanently removed. This can&apos;t be undone.</>
          )}
        </DialogDescription>

        <DialogFooter className="gap-2 sm:justify-end">
          <DialogClose
            render={
              <button
                type="button"
                onClick={onCancel}
                className="cursor-pointer rounded-md border border-[#E3E8EF] px-3 py-2 text-[13px] font-medium text-[#425466] transition-colors duration-150 hover:border-[#635BFF] hover:text-[#635BFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
              />
            }
          >
            Cancel
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-md bg-[#DF1B41] px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#B21533] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DF1B41]"
          >
            {inPortal ? "Delete record" : "Delete draft"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

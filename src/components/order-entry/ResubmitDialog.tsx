"use client";

import { AlertTriangle } from "lucide-react";
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
 * The gate in front of running an order the portal has already numbered.
 *
 * This is the only action in the app that can create real, chargeable duplicate
 * work in a third-party system: the portal mints an order number before the
 * device is even selectable, so a failed run leaves a genuine order behind. The
 * agent has to void that one by hand first, and nothing in BizzFlow can verify
 * they did — so the confirmation names the number, says what a second run does,
 * and is required EVERY time rather than remembered.
 */
export function ResubmitDialog({
  order,
  onConfirm,
  onCancel,
}: {
  order: OrderListItem;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        aria-describedby="resubmit-warning"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100"
              aria-hidden="true"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
            </span>
            Resubmit this order?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription
          id="resubmit-warning"
          className="text-[13px] leading-relaxed text-ink-soft"
        >
          Order{" "}
          <span className="font-semibold tabular-nums text-ink">
            {order.orderId}
          </span>{" "}
          already exists in the Unifi portal
          {order.attempt > 0 && ` from attempt ${order.attempt}`}. Running{" "}
          {order.fullName} again creates a{" "}
          <span className="font-semibold text-ink">second order</span>.
          Void the existing one in the portal first.
        </DialogDescription>

        <DialogFooter className="gap-2 sm:justify-end">
          <DialogClose
            render={
              <button
                type="button"
                onClick={onCancel}
                className="cursor-pointer rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              />
            }
          >
            Cancel
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-md bg-[#C2740B] px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#9A5C08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2740B]"
          >
            I&apos;ve voided it — resubmit
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

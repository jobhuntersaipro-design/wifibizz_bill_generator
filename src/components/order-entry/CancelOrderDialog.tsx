"use client";

import { Ban } from "lucide-react";
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
 * The gate in front of manually cancelling a submitted order.
 *
 * Two things the agent must read before confirming, because both are
 * irreversible in different directions:
 *
 * 1. Cancelling is terminal in BizzFlow — the row keeps Details and Delete and
 *    nothing else, forever. There is no un-cancel.
 * 2. Cancelling is ONLY BizzFlow bookkeeping. The order this row records still
 *    exists at Unifi, unchanged, and keeps progressing there (appointment,
 *    delivery, billing) until someone voids it on the portal — which is why
 *    the portal link is offered right here.
 */
export function CancelOrderDialog({
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
        aria-describedby="cancel-warning"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100"
              aria-hidden="true"
            >
              <Ban className="h-3.5 w-3.5 text-[#C2740B]" />
            </span>
            Cancel this submitted order?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription
          id="cancel-warning"
          className="text-[13px] leading-relaxed text-[#425466]"
        >
          <span className="font-medium text-[#0A2540]">{order.fullName}</span>
          {order.orderId && (
            <>
              {" — order "}
              <span className="tabular-nums">{order.orderId}</span>
            </>
          )}
          {" will be marked "}
          <span className="font-medium text-[#0A2540]">Cancelled</span>
          {". This cannot be undone: the row keeps its Details (history and captures) and can be deleted, but nothing else — no edit, no resubmit."}
        </DialogDescription>

        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
          This does <span className="font-semibold">not</span> void the order at Unifi — the
          portal order stays live until it is voided there.
          {order.orderId && (
            <>
              {" "}
              <a
                href={`https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails?custOrderId=${order.orderId}&custOrderNbr=${order.orderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                Open it on the dealer portal
              </a>
              .
            </>
          )}
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[#E3E8EF] px-4 text-[13px] font-medium text-[#425466] transition-colors duration-150 hover:bg-[#F6F9FC]">
            Keep order
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#C2740B] px-4 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#9A5C08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2740B]"
          >
            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel order
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

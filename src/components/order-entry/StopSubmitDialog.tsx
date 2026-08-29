"use client";

import { Square } from "lucide-react";
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
 * The gate in front of stopping a run that is in flight.
 *
 * Unlike Cancel, this really does reach the droplet: the run's browser is shut
 * down wherever it had got to. That is why it needs a confirmation at all —
 * the portal mints the Customer Order Number EARLY, before the device is even
 * selectable, so a run stopped part-way can leave a real order at Unifi that
 * nobody has voided.
 *
 * The warning is written from what this run has actually left behind. Once the
 * order number exists the stranded order is a fact rather than a possibility,
 * and the agent needs the number to act on it — so it is named, with a link.
 */
export function StopSubmitDialog({
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
        aria-describedby="stop-warning"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100"
              aria-hidden="true"
            >
              <Square className="h-3.5 w-3.5 text-red-600" />
            </span>
            Stop this submit?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription
          id="stop-warning"
          className="text-[13px] leading-relaxed text-[#425466]"
        >
          {"The portal run for "}
          <span className="font-medium text-[#0A2540]">{order.fullName}</span>
          {" will be shut down wherever it has got to. The order goes back to "}
          <span className="font-medium text-[#0A2540]">Failed</span>
          {" and can be submitted again when you are ready — it will not retry on its own."}
        </DialogDescription>

        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
          {order.orderId ? (
            <>
              Unifi has <span className="font-semibold">already issued order </span>
              <span className="font-semibold tabular-nums">{order.orderId}</span>
              {" for this customer. Stopping leaves it live in the portal — void it there if you do not want it."}{" "}
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
          ) : (
            <>
              Unifi issues the order number early in the flow, so this run may already have
              created a real order. <span className="font-semibold">Check the portal</span> for
              this customer before submitting again.
            </>
          )}
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[#E3E8EF] px-4 text-[13px] font-medium text-[#425466] transition-colors duration-150 hover:bg-[#F6F9FC]">
            Keep running
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Stop the submit
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Ban } from "lucide-react";
import { canPortalCancel, type OrderListItem } from "@/lib/order-types";
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
 * The gate in front of cancelling a submitted order.
 *
 * Confirming "Cancel at Unifi" hands over to the ROW, not to this dialog: the
 * row flips to Cancelling and shows the same live checklist a submit does,
 * the run's stages and proof captures land on the order's timeline, and the
 * row only ever becomes Cancelled once the portal itself confirmed. Anything
 * less reverts it to Submitted.
 *
 * The old bookkeeping-only cancel survives as the explicit secondary, with its
 * honest "does NOT void at Unifi" warning attached to IT rather than to the
 * whole dialog.
 */
export function CancelOrderDialog({
  order,
  onPortalCancel,
  onBookkeeping,
  onCancel,
}: {
  order: OrderListItem;
  /** Start the real portal cancel; the row's checklist takes over. */
  onPortalCancel: () => void;
  /** The explicit fallback: mark cancelled in BizzFlow only. */
  onBookkeeping: () => void;
  onCancel: () => void;
}) {
  const portalable = canPortalCancel(order);

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
          {portalable
            ? ". Cancel at Unifi drives the dealer portal for you: it finds this exact order number under the customer, clicks Cancel Order and confirms — photographing the confirmation and the result as proof on the timeline. The row follows the run live and becomes Cancelled only once the portal confirms; cancelling is terminal — no edit, no resubmit, ever."
            : ". This order has no portal order number, so the portal cancel has nothing safe to aim at — only the bookkeeping cancel below is available."}
        </DialogDescription>

        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
          &ldquo;Mark cancelled in BizzFlow only&rdquo; does{" "}
          <span className="font-semibold">not</span> void the order at Unifi — the portal
          order stays live until it is voided there.
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
            onClick={onBookkeeping}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-amber-300 px-4 text-[13px] font-medium text-amber-900 transition-colors duration-150 hover:bg-amber-50"
          >
            Mark cancelled in BizzFlow only
          </button>
          {portalable && (
            <button
              type="button"
              onClick={onPortalCancel}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#C2740B] px-4 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#9A5C08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2740B]"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel at Unifi
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

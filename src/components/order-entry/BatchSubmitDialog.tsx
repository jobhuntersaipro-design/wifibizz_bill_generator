"use client";

import { Layers } from "lucide-react";
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
 * The gate in front of a batch submit.
 *
 * Replaces a `window.confirm` that said only "Submit N orders one by one?" —
 * which was true but left out the two facts that changed with the server-side
 * runner: the batch survives this tab closing, and the results arrive by email
 * rather than by watching. Both are the reason an agent would start a ten-order
 * batch and walk away, so both are said here rather than discovered.
 */
export function BatchSubmitDialog({
  count,
  recipient,
  onConfirm,
  onCancel,
}: {
  count: number;
  /** Where the summary will land. Null when nothing is configured to send it. */
  recipient: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md" aria-describedby="batch-note">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF0FF]"
              aria-hidden="true"
            >
              <Layers className="h-3.5 w-3.5 text-[#635BFF]" />
            </span>
            Submit {count} order{count === 1 ? "" : "s"}?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription id="batch-note" className="space-y-2 text-[13px] leading-relaxed text-[#425466]">
          <span className="block">
            They run <span className="font-semibold text-[#0A2540]">one by one, oldest first</span>.
            An order that fails doesn&apos;t stop the rest.
          </span>
          <span className="block">
            {recipient ? (
              <>
                You&apos;ll get one summary email at{" "}
                <span className="font-semibold text-[#0A2540]">{recipient}</span> when the batch
                finishes — <span className="font-semibold text-[#0A2540]">you can close this tab</span>,
                the batch keeps running.
              </>
            ) : (
              <>
                <span className="font-semibold text-[#0A2540]">You can close this tab</span> — the
                batch keeps running. No summary email will be sent: no notification address is set
                (add one in Settings).
              </>
            )}
          </span>
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
            className="cursor-pointer rounded-md bg-[#635BFF] px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            Start batch
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

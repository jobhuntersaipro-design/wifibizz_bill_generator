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
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF0FF]"
              aria-hidden="true"
            >
              <Layers className="h-3.5 w-3.5 text-brand" />
            </span>
            Submit {count} order{count === 1 ? "" : "s"}?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription id="batch-note" className="space-y-2 text-[13px] leading-relaxed text-ink-soft">
          <span className="block">
            They run <span className="font-semibold text-ink">one by one, oldest first</span>.
            An order that fails doesn&apos;t stop the rest.
          </span>
          <span className="block">
            {recipient ? (
              <>
                You&apos;ll get one summary email at{" "}
                <span className="font-semibold text-ink">{recipient}</span> when the batch
                finishes — <span className="font-semibold text-ink">you can close this tab</span>,
                the batch keeps running.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">You can close this tab</span> — the
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
                className="cursor-pointer rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              />
            }
          >
            Cancel
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-md bg-brand px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Start batch
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

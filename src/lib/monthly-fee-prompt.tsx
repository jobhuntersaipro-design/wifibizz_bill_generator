"use client";
// The monthly fee for the consent chat, never blank. In order:
// 1. the price written in the plan name ("… RM189"),
// 2. the plan's admin-set fee (Plan Settings),
// 3. the agent types it in a dialog (Arc in Arc mode). Cancel = null.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { getMonthlyFee } from "@/actions/plans";
import { feeFromPackageName, formatFee, parseMonthlyFee } from "./plan-offer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const FEE_CANCELLED = "Chat not generated: the monthly fee is required.";

/** RM as the chat prints it ("189", "139.50"), or null when the agent cancels. */
export async function resolveMonthlyFee(pkg: string | null): Promise<string | null> {
  const fromName = feeFromPackageName(pkg);
  if (fromName) return formatFee(fromName);
  const fromPlan = await getMonthlyFee(pkg).catch(() => null);
  if (fromPlan) return formatFee(Number(fromPlan));
  return askFee(pkg);
}

function askFee(pkg: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (fee: string | null) => {
      root.unmount();
      host.remove();
      resolve(fee);
    };
    root.render(<FeeDialog pkg={pkg} onDone={done} />);
  });
}

function FeeDialog({ pkg, onDone }: { pkg: string | null; onDone: (fee: string | null) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseMonthlyFee(value);
    if (typeof n !== "number") {
      setError("Enter a number, e.g. 189 or 189.50.");
      return;
    }
    onDone(formatFee(n));
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Monthly subscription fee</DialogTitle>
            <DialogDescription>
              No price was found for &ldquo;{pkg ?? "this package"}&rdquo;. Enter the monthly fee to print on the chat.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monthly-fee">Monthly fee (RM)</Label>
            <Input
              id="monthly-fee"
              autoFocus
              inputMode="decimal"
              placeholder="e.g. 189"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "monthly-fee-error" : undefined}
            />
            {error && (
              <p id="monthly-fee-error" className="text-[12px] text-danger">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit">Generate chat</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

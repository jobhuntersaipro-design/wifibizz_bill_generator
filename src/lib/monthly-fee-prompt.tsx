"use client";
// The two consent-chat terms that must never be blank: the monthly fee and the contract period.
// Fee, in order: the price in the plan name ("… RM189"), the plan's admin-set fee
// (Plan Settings), else the agent types it. Months: the "(NNM)" in the plan name, else
// the agent types it. One Arc dialog asks for whatever is missing. Cancel = null.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { getMonthlyFee } from "@/actions/plans";
import { feeFromPackageName, formatFee, parseMonthlyFee } from "./plan-offer";
import { contractMonths } from "./chat-script";
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

export const FEE_CANCELLED = "Chat not generated: the monthly fee and contract period are required.";

/** RM as the chat prints it ("189", "139.50") and the contract in months ("24"). */
export interface ConsentTerms {
  fee: string;
  months: string;
}

export async function resolveConsentTerms(pkg: string | null): Promise<ConsentTerms | null> {
  const fromName = feeFromPackageName(pkg);
  let fee = fromName ? formatFee(fromName) : "";
  if (!fee) {
    const fromPlan = await getMonthlyFee(pkg).catch(() => null);
    if (fromPlan) fee = formatFee(Number(fromPlan));
  }
  const months = contractMonths(pkg);
  if (fee && months) return { fee, months };
  return askTerms(pkg, { fee, months });
}

function askTerms(pkg: string | null, known: ConsentTerms): Promise<ConsentTerms | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (terms: ConsentTerms | null) => {
      root.unmount();
      host.remove();
      resolve(terms);
    };
    root.render(<TermsDialog pkg={pkg} known={known} onDone={done} />);
  });
}

function TermsDialog({
  pkg,
  known,
  onDone,
}: {
  pkg: string | null;
  known: ConsentTerms;
  onDone: (terms: ConsentTerms | null) => void;
}) {
  const [fee, setFee] = useState("");
  const [months, setMonths] = useState("");
  const [feeError, setFeeError] = useState<string | null>(null);
  const [monthsError, setMonthsError] = useState<string | null>(null);
  const askFee = !known.fee;
  const askMonths = !known.months;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = askFee ? parseMonthlyFee(fee) : null;
    const m = months.trim();
    const feeBad = askFee && typeof n !== "number";
    const monthsBad = askMonths && !/^[1-9]\d{0,2}$/.test(m);
    setFeeError(feeBad ? "Enter a number, e.g. 189 or 189.50." : null);
    setMonthsError(monthsBad ? "Enter whole months, e.g. 24 or 36." : null);
    if (feeBad || monthsBad) return;
    onDone({
      fee: askFee ? formatFee(n as number) : known.fee,
      months: askMonths ? m : known.months,
    });
  }

  const missing = [askFee && "monthly fee", askMonths && "contract period"].filter(Boolean).join(" and ");
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{askFee && askMonths ? "Fee and contract period" : askFee ? "Monthly subscription fee" : "Contract period"}</DialogTitle>
            <DialogDescription>
              No {missing} was found for &ldquo;{pkg ?? "this package"}&rdquo;. Enter it to print on the chat.
            </DialogDescription>
          </DialogHeader>
          {askFee && (
            <Field id="monthly-fee" label="Monthly fee (RM)" placeholder="e.g. 189" inputMode="decimal"
              value={fee} error={feeError} autoFocus
              onChange={(v) => { setFee(v); setFeeError(null); }} />
          )}
          {askMonths && (
            <Field id="contract-months" label="Contract period (months)" placeholder="e.g. 24" inputMode="numeric"
              value={months} error={monthsError} autoFocus={!askFee}
              onChange={(v) => { setMonths(v); setMonthsError(null); }} />
          )}
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

function Field(props: {
  id: string;
  label: string;
  placeholder: string;
  inputMode: "decimal" | "numeric";
  value: string;
  error: string | null;
  autoFocus: boolean;
  onChange: (v: string) => void;
}) {
  const { id, label, error } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoFocus={props.autoFocus}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

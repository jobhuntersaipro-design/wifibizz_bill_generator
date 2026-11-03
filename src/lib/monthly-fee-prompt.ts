// Client helper: the monthly fee for the consent chat. The plan's admin-set price
// first; when no plan matches or none is set, the agent types it. Never blank.
import { getMonthlyFee } from "@/actions/plans";
import { parseMonthlyFee } from "./plan-offer";

/** RM with two decimals, or null when the agent cancels the prompt. */
export async function resolveMonthlyFee(pkg: string | null): Promise<string | null> {
  const fee = await getMonthlyFee(pkg).catch(() => null);
  if (fee) return fee;
  let ask = `No monthly fee is set for "${pkg ?? "this package"}".\nEnter the monthly subscription fee (RM):`;
  for (;;) {
    const raw = window.prompt(ask);
    if (raw === null) return null;
    const n = parseMonthlyFee(raw);
    if (typeof n === "number") return n.toFixed(2);
    ask = `"${raw}" is not a fee. Enter a number, e.g. 139 or 139.00 (RM):`;
  }
}

export const FEE_CANCELLED = "Chat not generated: the monthly fee is required.";

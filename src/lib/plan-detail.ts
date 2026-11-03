// Rules for a Plan Details row (/admin/plan-details), shared by the form and the server action.

import { parseMonthlyFee } from "./plan-offer";

export interface PlanDetailView {
  id: string;
  name: string;
  /** RM with two decimals, e.g. "189.00". */
  price: string;
  contractMonths: number;
}

export type PlanDetailInput = { name: string; price: string; contractMonths: string };

export type PlanDetailCheck =
  | { ok: true; name: string; price: number; contractMonths: number }
  | { ok: false; error: string };

/** Collapse spacing so the chat's name match (case and spacing ignored) finds the row. */
export function cleanPlanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function checkPlanDetail(input: PlanDetailInput): PlanDetailCheck {
  const name = cleanPlanName(input.name);
  if (!name) return { ok: false, error: "Enter the plan name." };
  if (name.length > 200) return { ok: false, error: "The plan name is too long (200 characters max)." };
  const price = parseMonthlyFee(input.price);
  if (typeof price !== "number") return { ok: false, error: "Enter the price as a number, e.g. 189 or 189.50." };
  const m = input.contractMonths.trim();
  if (!/^[1-9]\d{0,2}$/.test(m)) return { ok: false, error: "Enter the contract in whole months, e.g. 24 or 36." };
  return { ok: true, name, price, contractMonths: Number(m) };
}

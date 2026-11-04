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

/** Most rows one CSV upload may carry. */
export const PLAN_CSV_MAX_ROWS = 500;

export const PLAN_CSV_TEMPLATE = "Plan name,Price,Contract months\nUnifi Home 500Mbps,189,24\n";

/** Split CSV text into rows of cells. Handles quoted cells, "" escapes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADERS: Record<keyof PlanDetailInput, RegExp> = {
  name: /^(plan\s*name|plan|name|package)$/i,
  price: /^(price|monthly\s*fee|fee|price\s*\(rm\)|rm)$/i,
  contractMonths: /^(contract(\s*months?)?|months?|contract\s*\(months\))$/i,
};

export type PlanCsvResult =
  | { ok: true; rows: PlanDetailInput[] }
  | { ok: false; errors: string[] };

/**
 * Read a Plan Details CSV: a header row naming Plan name, Price and Contract months (any order),
 * then one plan per line. Every row is checked; any error refuses the whole file.
 */
export function readPlanCsv(text: string): PlanCsvResult {
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, errors: ["The file is empty."] };
  const col = {} as Record<keyof PlanDetailInput, number>;
  for (const key of Object.keys(HEADERS) as (keyof PlanDetailInput)[]) {
    const i = header.findIndex((h) => HEADERS[key].test(h.trim()));
    if (i < 0) {
      return { ok: false, errors: ["The first row must name the columns: Plan name, Price, Contract months."] };
    }
    col[key] = i;
  }
  if (body.length === 0) return { ok: false, errors: ["The file has no plans under the header row."] };
  if (body.length > PLAN_CSV_MAX_ROWS) {
    return { ok: false, errors: [`The file has ${body.length} plans. Upload ${PLAN_CSV_MAX_ROWS} or fewer at a time.`] };
  }
  const errors: string[] = [];
  const rows: PlanDetailInput[] = [];
  const seen = new Map<string, number>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const input: PlanDetailInput = {
      name: cells[col.name] ?? "",
      price: cells[col.price] ?? "",
      contractMonths: (cells[col.contractMonths] ?? "").trim().replace(/\s*(months?|m)$/i, ""),
    };
    const check = checkPlanDetail(input);
    if (!check.ok) return void errors.push(`Line ${line}: ${check.error}`);
    const key = check.name.toLowerCase();
    if (seen.has(key)) return void errors.push(`Line ${line}: "${check.name}" is also on line ${seen.get(key)}.`);
    seen.set(key, line);
    rows.push(input);
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

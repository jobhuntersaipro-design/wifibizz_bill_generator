/**
 * How the live run page colours a finished run.
 *
 * Mirrors `applyResult` in order-submit.ts, so the panel says what BizzFlow
 * records: `submitted` → succeeded; any `warning` outcome (an order number with
 * no e-RF, a portal error after the order was minted, a warning, a Stop-before-
 * Pay run holding an order) → attention; everything else → failed.
 */
export type LiveRunVerdict = "succeeded" | "attention" | "failed";

export interface LiveRunOutcome {
  status: string;
  result_status?: string | null;
  order_id?: string | null;
  erf?: boolean;
  warning?: string | null;
}

export function liveRunVerdict(o: LiveRunOutcome): LiveRunVerdict {
  if (o.status !== "done") return "failed";
  const finished = o.result_status === "submitted" || o.result_status === "success";
  const hasOrder = !!o.order_id;
  if (finished && hasOrder) return o.erf ? "succeeded" : "attention";
  if (o.result_status === "error") return hasOrder ? "attention" : "failed";
  if (o.warning) return "attention";
  if (hasOrder) return "attention";
  return "failed";
}

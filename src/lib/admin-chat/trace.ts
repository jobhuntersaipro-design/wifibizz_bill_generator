/**
 * The admin assistant's visible working: what each tool call looked up and
 * what it found, in one short line each. Pure, so the wording can be tested
 * and cannot drift between the route and the panel.
 *
 * These lines describe the call, not the data: counts and statuses, never a
 * customer row. The full result stays between the route and the model.
 */

/** Tools the trace does not show — bookkeeping, not work the admin asked for. */
export const HIDDEN_TOOLS = new Set(["flag_off_topic"]);

export const TOOL_LABEL: Record<string, string> = {
  search_orders: "Searched orders",
  get_order: "Read an order",
  explain_error_code: "Looked up an error code",
  list_plans: "Checked plans",
  order_stats: "Crunched submit stats",
  live_jobs: "Checked running jobs",
  escalate_to_human: "Handed off",
};

/** The same step while it is still running. */
export const TOOL_ACTIVE_LABEL: Record<string, string> = {
  search_orders: "Searching orders",
  get_order: "Reading the order",
  explain_error_code: "Looking up the error code",
  list_plans: "Checking plans",
  order_stats: "Crunching submit stats",
  live_jobs: "Checking running jobs",
  escalate_to_human: "Handing off",
};

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What the call asked for, e.g. `"ORD-0275" · failed · since 2026-09-24`. */
export function describeToolInput(name: string, raw: unknown, handoffName = ""): string {
  const i = (raw && typeof raw === "object" ? raw : {}) as Input;
  const parts: (string | null)[] = [];
  switch (name) {
    case "search_orders":
      parts.push(
        str(i.query) ? `“${str(i.query)}”` : null,
        str(i.status),
        str(i.agentEmail),
        str(i.createdFrom) && str(i.createdTo)
          ? `${i.createdFrom} → ${i.createdTo}`
          : str(i.createdFrom)
            ? `since ${i.createdFrom}`
            : str(i.createdTo)
              ? `until ${i.createdTo}`
              : null,
        i.includeDeleted ? "incl. deleted" : null,
      );
      return parts.filter(Boolean).join(" · ") || "newest orders";
    case "get_order":
      return str(i.order) ?? "";
    case "explain_error_code":
      return str(i.code) ?? "all known codes";
    case "list_plans":
      parts.push(
        str(i.speed) ? `${str(i.speed)}` : null,
        str(i.nameContains) ? `“${str(i.nameContains)}”` : null,
        i.publishedOnly ? "published only" : null,
      );
      return parts.filter(Boolean).join(" · ") || "all plans";
    case "order_stats":
      parts.push(
        str(i.from) || str(i.to) ? `${str(i.from) ?? "…"} → ${str(i.to) ?? "today"}` : "last 30 days",
        str(i.agentEmail),
      );
      return parts.filter(Boolean).join(" · ");
    case "live_jobs":
      return "submit server";
    case "escalate_to_human":
      return [handoffName ? `to ${handoffName}` : null, str(i.orderRef)].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the call found, e.g. `3 matches` or `ORD-0275 · Failed`. */
export function describeToolResult(name: string, content: string, isError: boolean): string {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return isError ? "failed" : "done";
  }
  if (typeof r.error === "string") return r.error.length > 80 ? `${r.error.slice(0, 80)}…` : r.error;
  if (r.truncated) return "large result";
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  switch (name) {
    case "search_orders":
      return plural(n(r.matched), "match", "matches");
    case "get_order":
      return [r.ref ?? "order", r.status].filter(Boolean).join(" · ");
    case "explain_error_code":
      if (Array.isArray(r.knownCodes)) return plural(r.knownCodes.length, "code");
      return String(r.title ?? r.label ?? r.code ?? "explained");
    case "list_plans":
      return `${plural(n(r.matched), "plan")} · ${n(r.publishedCount)} published`;
    case "order_stats": {
      const t = (r.totals ?? {}) as Record<string, unknown>;
      return `${n(t.submitted)} submitted · ${plural(n(t.failedAttempts), "failed attempt")}`;
    }
    case "live_jobs":
      return n(r.running) === 0 ? "nothing running" : `${n(r.running)} running`;
    case "escalate_to_human":
      return r.emailed ? "recorded · e-mailed" : "recorded";
    default:
      return "done";
  }
}

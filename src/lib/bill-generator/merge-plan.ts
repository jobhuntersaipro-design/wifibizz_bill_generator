/**
 * Turning a case selection into an ordered list of documents to merge.
 *
 * Kept pure and away from the dialog because a merge that silently omits a
 * document looks exactly like a merge that worked: what is included, what is
 * unavailable and in which order are the decisions worth pinning down in tests.
 */

export type MergeDocType = "internet" | "utility" | "letter" | "time" | "chat";

/** The document types, in the order they appear for a case by default. */
export const MERGE_DOC_TYPES: MergeDocType[] = ["internet", "utility", "letter", "time", "chat"];

export const MERGE_DOC_LABELS: Record<MergeDocType, string> = {
  internet: "Internet Bill",
  utility: "Utility Bill",
  letter: "Authorization Letter",
  time: "TIME Invoice",
  chat: "Closing Script (Chat)",
};

/** The fields of a case row a merge plan actually depends on. */
export interface MergeCase {
  case_no: string;
  full_name: string | null;
  id_no: string | null;
  internet_bill_url: string | null;
  utility_bill_url: string | null;
}

export interface MergeItem {
  /** Stable identity across re-derivations, so manual ordering survives. */
  id: string;
  caseNo: string;
  type: MergeDocType;
  /** What the row (and any error naming it) calls this document. */
  label: string;
  /** Null when the document can be included; otherwise why it cannot. */
  unavailable: string | null;
  /**
   * True when the document does not exist yet and the merge has to generate it
   * first — an Internet or Utility Bill this case has never had generated.
   * Kept apart from `unavailable` because these rows ARE included: they cost
   * time, and possibly a case credit, but they end up in the PDF.
   */
  needsGeneration: boolean;
}

export function mergeItemId(caseNo: string, type: MergeDocType): string {
  return `${caseNo}::${type}`;
}

/**
 * Where the browser fetches this document's bytes from, or null when there is
 * nothing to fetch — the closing script is rasterised from the DOM in the
 * browser, so it has no endpoint at all.
 */
export function mergeItemUrl(item: MergeItem): string | null {
  const q = `case_no=${encodeURIComponent(item.caseNo)}`;
  switch (item.type) {
    case "internet":
      return `/api/bills/download?${q}&type=internet`;
    case "utility":
      return `/api/bills/download?${q}&type=utility`;
    case "letter":
      return `/api/bills/authorization-letter?${q}`;
    case "time":
      return `/api/bills/time-invoice?${q}`;
    case "chat":
      return null;
  }
}

/**
 * A document is unavailable when it can never be included for a reason we can
 * see from the row — a letter with no resident IC, which its route refuses.
 * An ungenerated bill is NOT unavailable: it is generated on the way (see
 * `needsGeneration`), which is why this no longer reports one.
 */
function unavailableReason(c: MergeCase, type: MergeDocType): string | null {
  if (type === "letter" && !(c.id_no || "").trim()) return "Case has no ID number";
  return null;
}

/**
 * Whether this document has to be generated before it can be fetched. Only the
 * two stored bills can be in this state: the letter, the TIME invoice and the
 * closing script are produced per request and never stored.
 */
function needsGeneration(c: MergeCase, type: MergeDocType): boolean {
  if (type === "internet") return !c.internet_bill_url;
  if (type === "utility") return !c.utility_bill_url;
  return false;
}

/**
 * One row per case × selected type, grouped per case in selection order — the
 * order an agent bundling a customer's paperwork wants. Drag-and-drop overrides
 * it afterwards.
 */
export function buildMergeItems(cases: MergeCase[], types: MergeDocType[]): MergeItem[] {
  const chosen = MERGE_DOC_TYPES.filter((t) => types.includes(t));
  const items: MergeItem[] = [];
  for (const c of cases) {
    for (const type of chosen) {
      const who = (c.full_name || "").trim();
      items.push({
        id: mergeItemId(c.case_no, type),
        caseNo: c.case_no,
        type,
        label: `${c.case_no}${who ? ` · ${who}` : ""} — ${MERGE_DOC_LABELS[type]}`,
        unavailable: unavailableReason(c, type),
        needsGeneration: needsGeneration(c, type),
      });
    }
  }
  return items;
}

/**
 * Re-derive the list after a type checkbox changes without discarding the
 * agent's work: rows still wanted keep their current position, rows removed by
 * hand stay removed, and newly-ticked rows are appended.
 */
export function reconcileMergeItems(current: MergeItem[], next: MergeItem[]): MergeItem[] {
  const nextById = new Map(next.map((i) => [i.id, i]));
  const kept = current.filter((i) => nextById.has(i.id)).map((i) => nextById.get(i.id)!);
  const keptIds = new Set(kept.map((i) => i.id));
  return [...kept, ...next.filter((i) => !keptIds.has(i.id))];
}

/** Move the item at `from` to sit at `to`, returning a new array. */
export function moveMergeItem(items: MergeItem[], from: number, to: number): MergeItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The document types among these rows that have to be generated first, in the
 * canonical order. The warning shown to the agent and the work the merge
 * actually does both read this, so they cannot disagree about what will be
 * generated.
 */
export function pendingGenerationTypes(items: MergeItem[]): MergeDocType[] {
  const wanted = new Set(
    items.filter((i) => !i.unavailable && i.needsGeneration).map((i) => i.type)
  );
  return MERGE_DOC_TYPES.filter((t) => wanted.has(t));
}

/**
 * How many case credits generating those bills will consume.
 *
 * The bill route charges per CASE, not per bill: the first bill on a case logs
 * one `CaseUsageLog` row and the second bill type is then free. So a case that
 * already carries either bill costs nothing more, and a case with neither costs
 * exactly one however many bills are generated — provided they are generated
 * one after another, which is why the merge never runs them concurrently.
 */
export function generationCreditCost(c: MergeCase, pending: MergeDocType[]): number {
  if (pending.length === 0) return 0;
  return c.internet_bill_url || c.utility_bill_url ? 0 : 1;
}

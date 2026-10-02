"use client";
import { Select } from "@/components/ui/select";

import LottieSpot from "@/components/order-entry/LottieSpot";
import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { initialsFor } from "@/lib/order-types";
import { createPortal } from "react-dom";
import { toast } from "@/lib/toast";
import {
  type CaseRow, type SortState, PAGE_SIZE, COLUMNS,
  formatDateTime, getStatusStyle,
} from "./shared";
import {
  SearchIcon, EmptyIcon, CloseIcon, ExternalLinkIcon, SortIcon,
  InternetBillIcon, UtilityBillIcon, DownloadIcon,
  MessageSquareIcon, AuthLetterIcon, SyncSheetIcon, TimeBillIcon, TenancyAgreementIcon, MergeIcon,
} from "./icons";
import ChatImageGenerator from "./ChatImageGenerator";
import type { ChatScriptVariant } from "@/lib/chat-script";
import { AUTH_LETTER_LABEL, UMOBILE_BILL_LABEL, UMOBILE_BILL_SHORT, authLetterVariant, closingScriptVariant } from "@/lib/case-kind";
import MergePdfDialog from "./MergePdfDialog";
import { directorDisplay } from "@/lib/director-id";
import { syncCasesToSheet } from "@/actions/settings";
import { billDownloadPath, revisionFromPublicUrl } from "@/lib/bill-object";
import {
  type CaseDateField,
  CASE_DATE_RANGE_ERROR,
  isInvalidCaseDateRange,
  setCaseListQueryParams,
} from "@/lib/case-list-filters";
import { Segmented } from "@/components/ui/segmented";

// ── Case Detail Panel ──

function CaseDetailPanel({ caseData, onClose, cacheBuster, onGenerateChat, chatLoading, onGenerateLetter, letterLoading, onCombine }: { caseData: CaseRow; onClose: () => void; cacheBuster: number; onGenerateChat: (c: CaseRow, variant: ChatScriptVariant) => void; chatLoading: ChatScriptVariant | null; onGenerateLetter: (c: CaseRow) => void; letterLoading: boolean; onCombine: (c: CaseRow) => void }) {
  // The Sheet owns Escape, outside-click, the focus trap and scroll lock, all of
  // which the old hand-rolled panel declared via markup and never implemented.
  // It also owns the enter/exit transitions — but the parent mounts this panel
  // conditionally, so we close the Sheet first and only tell the parent to drop
  // us once the exit has played out.
  const [open, setOpen] = useState(true);
  const CLOSE_MS = 300; // must match data-[side=right]:duration-300 below
  const requestClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  // What the Biz Auth Letter and the Bizz Chat print for the director — the
  // same rule, so the screen can never promise a value the letter leaves blank.
  const director = directorDisplay(caseData);
  const sections = [
    { title: "Case Information", fields: [
      { label: "Case No.", value: caseData.case_no },
      { label: "Order ID", value: caseData.order_no },
      { label: "Status", value: caseData.status, isStatus: true },
    ]},
    // Business cases only — crawled from the list row (company, reg no.) and the
    // case's detail page (director). A residential case has none of these.
    ...(closingScriptVariant(caseData) === "bizz" ? [{ title: "Business", fields: [
      { label: "Company Name", value: caseData.company_name ?? null },
      { label: "Company Reg No.", value: caseData.company_reg ?? null },
      { label: "Director", value: director.name || null },
      { label: "Director IC / Passport", value: director.id || null },
    ]}] : []),
    { title: "Customer Details", fields: [
      { label: "Full Name", value: caseData.full_name },
      { label: "Full Address", value: caseData.full_address },
      { label: "Mobile", value: caseData.mobile },
      { label: "Email", value: caseData.email },
      { label: "ID No.", value: caseData.id_no },
      // On a business case the ID No. is often the company's reg no. (type
      // passport), not a person's IC — the type is what says which.
      { label: "ID Type", value: caseData.id_type ?? null },
    ]},
    { title: "Service", fields: [
      { label: "Provider", value: caseData.provider },
      { label: "Package", value: caseData.package },
    ]},
    { title: "Agent", fields: [
      { label: "Agent", value: caseData.agent },
      { label: "Agent Remark", value: caseData.agent_remark },
    ]},
    { title: "Timestamps", fields: [
      { label: "Created At", value: formatDateTime(caseData.case_created_at) },
      { label: "Updated At", value: formatDateTime(caseData.updated_at) },
    ]},
  ];

  return (
    <Sheet open={open} onOpenChange={(next) => !next && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 border-l border-line bg-white p-0 sm:max-w-md data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=right]:duration-300"
      >
        <SheetTitle className="sr-only">Case details for {caseData.case_no}</SheetTitle>
        <SheetDescription className="sr-only">Customer, package, agent and bill details for this case.</SheetDescription>
        <div className="flex items-start gap-3 px-6 py-4 border-b border-line">
          <span className="panel-item-in flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[13px] font-semibold text-brand" aria-hidden="true">
            {initialsFor(caseData.full_name ?? "")}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="panel-item-in truncate text-[15px] font-semibold leading-tight text-ink" style={{ animationDelay: "40ms" }}>
              {caseData.full_name || "Case details"}
            </h2>
            <div className="panel-item-in mt-1 flex flex-wrap items-center gap-1.5" style={{ animationDelay: "80ms" }}>
              <span className="rounded-md bg-brand-wash px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-brand transition-colors duration-150 hover:bg-[#DEDAFF]">{caseData.case_no}</span>
              {caseData.status && (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${getStatusStyle(caseData.status)}`}>{caseData.status}</span>
              )}
            </div>
          </div>
          <Button unstyled variant="ghost" size="icon-sm" onClick={requestClose} aria-label="Close case details" className="group -mr-2.5 -mt-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
            <CloseIcon className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sections.map((section, sectionIndex) => {
            const visibleFields = section.fields.filter((f) => f.value);
            if (visibleFields.length === 0) return null;
            const delay = 200 + sectionIndex * 80;
            return (
              <div key={section.title}>
                {sectionIndex > 0 && (<div className="border-t border-line my-5 panel-item-in"  style={{ animationDelay: `${delay}ms` }} />)}
                <div className="panel-item-in" style={{ animationDelay: `${delay}ms` }}>
                  <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">{section.title}</h3>
                  <div className="space-y-3">
                    {visibleFields.map((field, fieldIndex) => (
                      <div key={field.label} className="panel-item-in" style={{ animationDelay: `${delay + 40 + fieldIndex * 40}ms` }}>
                        <dt className="text-xs text-ink-muted mb-0.5">{field.label}</dt>
                        <dd className="text-sm text-ink">
                          {field.isStatus ? (<span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(field.value ?? null)}`}>{field.value}</span>) : (<span className="wrap-break-word">{field.value}</span>)}
                        </dd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="border-t border-line my-5 panel-item-in"  style={{ animationDelay: "600ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "650ms" }}>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">{UMOBILE_BILL_LABEL}</h3>
            {caseData.internet_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-line overflow-hidden bg-wash">
                  <iframe src={billDownloadPath(caseData.case_no, "internet", `${revisionFromPublicUrl(caseData.internet_bill_url)}-${cacheBuster}`, { preview: true })} className="w-full h-100" title="Umobile Bill Preview" />
                </div>
                <a href={billDownloadPath(caseData.case_no, "internet", `${revisionFromPublicUrl(caseData.internet_bill_url)}-${cacheBuster}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:text-ink transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download {UMOBILE_BILL_LABEL}
                </a>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No bill generated yet. Click the {UMOBILE_BILL_SHORT} icon in this case&rsquo;s Bills column.</p>
            )}
          </div>

          {/* Utility Bill Preview */}
          <div className="border-t border-line my-5 panel-item-in"  style={{ animationDelay: "700ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "750ms" }}>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Utility Bill</h3>
            {caseData.utility_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-line overflow-hidden bg-wash">
                  <iframe src={billDownloadPath(caseData.case_no, "utility", `${revisionFromPublicUrl(caseData.utility_bill_url)}-${cacheBuster}`, { preview: true })} className="w-full h-100" title="Utility Bill Preview" />
                </div>
                <a href={billDownloadPath(caseData.case_no, "utility", `${revisionFromPublicUrl(caseData.utility_bill_url)}-${cacheBuster}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#FF6B35] hover:text-ink transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download Utility Bill
                </a>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No bill generated yet. Click the Utility icon in this case&rsquo;s Bills column.</p>
            )}
          </div>

          {/* Authorization Letter */}
          <div className="border-t border-line my-5 panel-item-in"  style={{ animationDelay: "780ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "800ms" }}>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">{AUTH_LETTER_LABEL[authLetterVariant(caseData)]}</h3>
            <button
              onClick={() => onGenerateLetter(caseData)}
              disabled={letterLoading}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#0E9384] hover:text-ink transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {letterLoading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#0E9384] border-t-transparent animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <AuthLetterIcon className="w-3.5 h-3.5" />Download {AUTH_LETTER_LABEL[authLetterVariant(caseData)]}
                </>
              )}
            </button>
            <p className="mt-2 text-xs text-ink-muted">Generated fresh each time and not stored. The property owner is generated; the resident is this customer.</p>
          </div>

          {/* Combine documents */}
          <div className="border-t border-line my-5 panel-item-in" style={{ animationDelay: "820ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "840ms" }}>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Combine Documents</h3>
            <button
              onClick={() => onCombine(caseData)}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:text-ink transition-colors duration-200"
            >
              <MergeIcon className="w-3.5 h-3.5" />Combine into one PDF
            </button>
            <p className="mt-2 text-xs text-ink-muted">Pick which of this case&rsquo;s documents to combine, in the order you want them.</p>
          </div>

          {/* Generate Chat */}
          <div className="border-t border-line my-5 panel-item-in"  style={{ animationDelay: "860ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "880ms" }}>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Closing Script</h3>
            {closingScriptVariant(caseData) === "conversation" && (
            <button
              onClick={() => onGenerateChat(caseData, "conversation")}
              disabled={chatLoading !== null}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#25D366] hover:text-[#1DA851] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {chatLoading === "conversation" ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#25D366] border-t-transparent animate-spin" />
                  Fetching address…
                </>
              ) : (
                <>
                  <MessageSquareIcon className="w-3.5 h-3.5" />Generate Chat Image
                </>
              )}
            </button>
            )}
            {closingScriptVariant(caseData) === "bizz" && (
            <button
              onClick={() => onGenerateChat(caseData, "bizz")}
              disabled={chatLoading !== null}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#0D9488] hover:text-ink transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {chatLoading === "bizz" ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin" />
                  Fetching address…
                </>
              ) : (
                <>
                  <MessageSquareIcon className="w-3.5 h-3.5" />Generate Bizz Chat
                </>
              )}
            </button>
            )}
          </div>
        </div>
        {caseData.case_url && (
          <div className="px-6 py-4 border-t border-line panel-item-in"  style={{ animationDelay: "700ms" }}>
            <a href={caseData.case_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:text-ink transition-colors duration-200">
              Open in WifiBizz
              <ExternalLinkIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main Case Management Section ──

// Bulk bill download scrapes and generates each case, so it is capped per run.
const MAX_BILL_CASES = 30;

export default function CaseManagementSection() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<CaseDateField>("case_created_at");
  const [casesLoading, setCasesLoading] = useState(true);
  const [lastCrawlAt, setLastCrawlAt] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: "case_created_at", dir: "desc" });
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);
  const [billCacheBuster, setBillCacheBuster] = useState(0);
  // Ticked rows. Tagged with the filters they were picked under, so changing a
  // filter drops the selection instead of acting on rows no longer listed.
  const [selection, setSelection] = useState<{ key: string; caseNos: Set<string>; all: boolean }>({ key: "", caseNos: new Set(), all: false });
  const [bulkBusy, setBulkBusy] = useState<"csv" | "internet" | "utility" | null>(null);
  // The case whose documents are being combined into one PDF.
  const [mergeCase, setMergeCase] = useState<CaseRow | null>(null);
  // Per-row single-bill generation in flight, keyed `${caseNo}:${type}`.
  const [generatingCell, setGeneratingCell] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  // The chat open in the modal, and which template it prints.
  const [chatCase, setChatCase] = useState<{ caseData: CaseRow; variant: ChatScriptVariant } | null>(null);
  // Case whose installation address is being fetched before the chat opens,
  // keyed with the variant so only the button that was clicked spins.
  const [chatLoadingCase, setChatLoadingCase] = useState<{ caseNo: string; variant: ChatScriptVariant } | null>(null);
  const chatBusy = (caseNo: string, variant: ChatScriptVariant) =>
    chatLoadingCase?.caseNo === caseNo && chatLoadingCase.variant === variant;
  // Case whose authorization letter is being generated.
  const [letterCase, setLetterCase] = useState<string | null>(null);
  const [timeCase, setTimeCase] = useState<string | null>(null);
  const [taCase, setTaCase] = useState<string | null>(null);
  const taAuthSeeds = useRef<Record<string, number>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<"success" | "error" | null>(null);
  const [syncCount, setSyncCount] = useState(0);
  const invalidDateRange = isInvalidCaseDateRange(dateFrom, dateTo);

  const fetchCases = useCallback(async () => {
    if (isInvalidCaseDateRange(dateFrom, dateTo)) {
      setCasesLoading(false);
      return;
    }
    setCasesLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort_by: sort.column,
      sort_dir: sort.dir,
    });
    setCaseListQueryParams(params, { search, status, dateFrom, dateTo, dateField });

    const res = await fetch(`/api/cases?${params}`);
    const json = await res.json();
    setCases(json.data ?? []);
    setCount(json.count ?? 0);
    if (json.statuses) setStatuses(json.statuses);
    if (json.last_crawl_at !== undefined) setLastCrawlAt(json.last_crawl_at);
    setCasesLoading(false);
  }, [page, search, status, dateFrom, dateTo, dateField, sort]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  function applySearch() {
    if (isInvalidCaseDateRange(dateFrom, dateTo)) {
      toast.error(CASE_DATE_RANGE_ERROR);
      return;
    }
    setPage(0);
    setSearch(searchDraft.trim());
  }

  function applyDateRange(nextFrom: string, nextTo: string) {
    setDateFrom(nextFrom);
    setDateTo(nextTo);
    if (!isInvalidCaseDateRange(nextFrom, nextTo)) setPage(0);
  }

  function clearFilters() {
    setSearchDraft("");
    setSearch("");
    setStatus("Activated");
    setDateFrom("");
    setDateTo("");
    setDateField("case_created_at");
    setPage(0);
  }

  const filterKey = [search, status, dateFrom, dateTo, dateField].join("|");
  const selected = selection.key === filterKey ? selection.caseNos : new Set<string>();
  const allSelected = selection.key === filterKey && selection.all;
  const pageAllTicked = cases.length > 0 && cases.every((c) => selected.has(c.case_no));

  function setSelected(caseNos: Set<string>, all = false) {
    setSelection({ key: filterKey, caseNos, all });
  }

  function toggleCase(caseNo: string) {
    const next = new Set(selected);
    if (!next.delete(caseNo)) next.add(caseNo);
    setSelected(next);
  }

  function togglePage() {
    const next = new Set(selected);
    for (const c of cases) {
      if (pageAllTicked) next.delete(c.case_no);
      else next.add(c.case_no);
    }
    setSelected(next);
  }

  async function selectAllMatching() {
    const params = new URLSearchParams();
    setCaseListQueryParams(params, { search, status, dateFrom, dateTo, dateField });
    const res = await fetch(`/api/cases/ids?${params}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not select all cases.");
      return;
    }
    setSelected(new Set(json.case_nos as string[]), true);
  }

  // Bills: fetch every ticked case's address from the portal, generate the bills
  // the cases don't have yet, then ZIP them. Both endpoints take 20 cases a call.
  // ponytail: sequential batches in the browser; closing the tab stops the run.
  async function prepareBills(caseNos: string[], type: "internet" | "utility", label: string, toastId: string | number) {
    const post = (url: string, body: object) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const batches: string[][] = [];
    for (let i = 0; i < caseNos.length; i += 20) batches.push(caseNos.slice(i, i + 20));
    const done = (i: number) => Math.min((i + 1) * 20, caseNos.length);

    for (const [i, batch] of batches.entries()) {
      toast.loading(`Fetching addresses… ${done(i - 1)} of ${caseNos.length}`, { id: toastId });
      await post("/api/cases/address", { caseNos: batch }).catch(() => null); // best-effort, like the row button
    }
    let failed = 0;
    for (const [i, batch] of batches.entries()) {
      toast.loading(`Generating ${label}… ${done(i - 1)} of ${caseNos.length}`, { id: toastId });
      const res = await post("/api/bills/generate", { caseNos: batch, type, onlyMissing: true }).catch(() => null);
      const body = await res?.json().catch(() => ({}));
      if (body?.error === "case_limit_reached") return { limitHit: true, failed };
      if (!res?.ok) failed += batch.length;
      else failed += (body.results ?? []).filter((r: { status: string }) => r.status !== "success").length;
    }
    return { limitHit: false, failed };
  }

  // CSV, or a ZIP of the ticked cases' bills (generated first where missing).
  async function downloadSelected(kind: "csv" | "internet" | "utility") {
    if (selected.size === 0 || bulkBusy) return;
    if (kind !== "csv" && selected.size > MAX_BILL_CASES) {
      toast.error(`Select up to ${MAX_BILL_CASES} cases to generate bills (${selected.size} selected).`);
      return;
    }
    setBulkBusy(kind);
    const label = kind === "csv" ? "CSV" : kind === "internet" ? `${UMOBILE_BILL_LABEL}s` : "Utility Bills";
    const toastId = toast.loading(`Preparing ${label}…`);
    try {
      if (kind !== "csv") {
        const { limitHit, failed } = await prepareBills([...selected], kind, label, toastId);
        window.dispatchEvent(new Event("usage-updated"));
        void fetchCases();
        if (limitHit) toast.warning("Case limit reached — downloading the bills that were generated. Top up to generate the rest.", { duration: 8000 });
        else if (failed > 0) toast.warning(`${failed} bill${failed === 1 ? "" : "s"} could not be generated and ${failed === 1 ? "is" : "are"} left out.`, { duration: 8000 });
        toast.loading(`Zipping ${label}…`, { id: toastId });
      }
      const res = await fetch(kind === "csv" ? "/api/cases/export" : "/api/bills/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNos: [...selected], type: kind }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? `${label} download failed.`, { id: toastId });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `cases.${kind === "csv" ? "csv" : "zip"}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${label} downloaded.`, { id: toastId });
    } catch {
      toast.error(`${label} download failed.`, { id: toastId });
    } finally {
      setBulkBusy(null);
    }
  }

  function handleSort(column: string) {
    setSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === "desc" ? "asc" : "desc",
    }));
    setPage(0);
  }

  // Generate a single bill straight from its row icon (no need to select first),
  // then open it right away. Address is lazily fetched server-side during generation.
  // Internet always regenerates: a stored URL can still be the old slot-stamped
  // 3-page PDF, and POST /api/bills/generate is free when the case already has a bill.
  async function handleGenerateSingle(caseNo: string, type: "internet" | "utility") {
    const key = `${caseNo}:${type}`;
    if (generatingCell) return;
    setGeneratingCell(key);
    const toastId = toast.loading(
      type === "internet" ? "Building Umobile bill…" : "Building utility bill…",
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const row = cases.find((c) => c.case_no === caseNo);
      const alreadyStored = type === "internet" ? !!row?.internet_bill_url : !!row?.utility_bill_url;

      // Internet with a stored URL: one rebuild via GET download. Do not POST
      // generate first — that crawls the portal (can hang) and then opened a
      // second rebuild in a tab (inline, so nothing new landed in Downloads).
      if (!(type === "internet" && alreadyStored)) {
        const res = await fetch("/api/bills/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos: [caseNo], type }),
          signal: ctrl.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
          toast.error(
            body.error === "case_limit_reached"
              ? "Case limit reached. Please top up your usage to generate more bills."
              : body.error || "Bill generation failed.",
            { id: toastId, duration: 5000 },
          );
          return;
        }
        const result = body.results?.[0];
        if (!result || result.status !== "success" || typeof result.url !== "string") {
          toast.error(result?.error || "Bill generation failed.", { id: toastId });
          return;
        }
      }

      const stamp = Date.now();
      const dl = await fetch(billDownloadPath(caseNo, type, String(stamp)), {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!dl.ok) {
        const errBody = await dl.json().catch(() => ({}));
        toast.error(
          typeof errBody.error === "string" ? errBody.error : "Bill download failed.",
          { id: toastId, duration: 5000 },
        );
        return;
      }
      const blob = await dl.blob();
      if (blob.size < 500) {
        toast.error("Bill download failed.", { id: toastId });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${type === "internet" ? "internetBill" : "utilityBill"}_${caseNo}_${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      setBillCacheBuster((prev) => prev + 1);
      window.dispatchEvent(new Event("usage-updated"));
      toast.success(`${type === "internet" ? "Umobile" : "Utility"} bill ready`, { id: toastId });
      void fetchCases();
    } catch (err) {
      console.error("Bill generation failed:", err);
      toast.error(
        err instanceof DOMException && err.name === "AbortError"
          ? "Bill timed out. Try again."
          : "Bill generation failed. Please try again.",
        { id: toastId },
      );
    } finally {
      clearTimeout(timer);
      setGeneratingCell(null);
    }
  }

  // The crawler stores cases list-only, so full_address is often blank. Resolve it
  // from the portal first (same lazy fill the bill generator does) so the closing
  // script carries the real installation address.
  async function handleGenerateChat(c: CaseRow, variant: ChatScriptVariant) {
    if (chatLoadingCase) return;
    if (variant !== closingScriptVariant(c)) return;
    const open = (caseData: CaseRow) => setChatCase({ caseData, variant });
    const needsAddress = !(c.full_address && c.full_address.trim()) && !!c.case_url;
    // NULL = the detail page has never been read. '' means it was, and the portal
    // has no name there — asking again would only fetch the same dash.
    const needsBizzFields = variant === "bizz" && !!c.case_url && c.director_name == null;
    if (!needsAddress && !needsBizzFields) {
      open(c);
      return;
    }
    setChatLoadingCase({ caseNo: c.case_no, variant });
    try {
      const res = await fetch("/api/cases/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNos: [c.case_no], includeBizzFields: needsBizzFields }),
      });
      const body = await res.json().catch(() => ({}));
      const address: string | undefined = body?.addresses?.[c.case_no];
      const bizz = body?.bizzFields?.[c.case_no] as
        | { companyName?: string; companyReg?: string; customerName?: string }
        | undefined;
      const merged: CaseRow = {
        ...c,
        full_address: address || c.full_address,
        company_name: bizz?.companyName || c.company_name,
        company_reg: bizz?.companyReg || c.company_reg,
        director_name: bizz ? bizz.customerName ?? "" : c.director_name,
      };
      if (address) {
        setCases((prev) => prev.map((r) => (r.case_no === c.case_no ? { ...r, full_address: address } : r)));
        setSelectedCase((prev) => (prev && prev.case_no === c.case_no ? { ...prev, full_address: address } : prev));
      }
      if (needsAddress && !address) {
        toast.error("Couldn't fetch the installation address — generating chat without it.");
      }
      open(merged);
    } catch (err) {
      console.error("Address fetch failed:", err);
      toast.error("Couldn't fetch the installation address — generating chat without it.");
      open(c);
    } finally {
      setChatLoadingCase(null);
    }
  }

  /**
   * Fetch a generated document as a blob and save it.
   *
   * Deliberately not a plain link or a new tab: these documents are generated on
   * demand and can legitimately answer 400 — a case with no ID number, or none
   * with an address — and a tab would render that raw JSON where the agent
   * expected a PDF.
   */
  async function downloadDocument(opts: {
    caseNo: string;
    endpoint: string;
    filePrefix: string;
    failureMessage: string;
    setBusy: (caseNo: string | null) => void;
    busy: string | null;
    extraQuery?: Record<string, string>;
  }) {
    if (opts.busy) return;
    opts.setBusy(opts.caseNo);
    try {
      const qs = new URLSearchParams({
        case_no: opts.caseNo,
        ...(opts.extraQuery ?? {}),
      });
      const res = await fetch(`${opts.endpoint}?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error || opts.failureMessage);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${opts.filePrefix}_${opts.caseNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`${opts.filePrefix} failed:`, err);
      toast.error(opts.failureMessage);
    } finally {
      opts.setBusy(null);
    }
  }

  function partiesSeedFor(caseNo: string): string {
    if (taAuthSeeds.current[caseNo] == null) {
      taAuthSeeds.current[caseNo] = Math.floor(Math.random() * 0xffffffff);
    }
    return String(taAuthSeeds.current[caseNo]);
  }

  /**
   * One button, two different letters. A business case gets the company
   * authorisation letter and a normal one the residential letter — they share
   * this handler only so the busy state and the download plumbing stay in one
   * place; the documents themselves have nothing in common.
   *
   * The business letter takes no `partiesSeed`: that seed generates a property
   * owner and witnesses, and this letter invents nobody — the director is the
   * real one on the case, and the agent, signature and chop stay blank.
   */
  function handleAuthorizationLetter(c: CaseRow) {
    const biz = authLetterVariant(c) === "biz";
    return downloadDocument({
      caseNo: c.case_no,
      endpoint: biz ? "/api/bills/biz-authorization-letter" : "/api/bills/authorization-letter",
      filePrefix: biz ? "biz_authorization_letter" : "authorization_letter",
      failureMessage: `Couldn't generate the ${AUTH_LETTER_LABEL[authLetterVariant(c)].toLowerCase()}.`,
      setBusy: setLetterCase,
      busy: letterCase,
      ...(biz ? {} : { extraQuery: { partiesSeed: partiesSeedFor(c.case_no) } }),
    });
  }

  function handleTimeInvoice(caseNo: string) {
    return downloadDocument({
      caseNo,
      endpoint: "/api/bills/time-invoice",
      filePrefix: "time_invoice",
      failureMessage: "Couldn't generate the TIME invoice.",
      setBusy: setTimeCase,
      busy: timeCase,
    });
  }

  function handleTenancyAgreement(caseNo: string) {
    return downloadDocument({
      caseNo,
      endpoint: "/api/bills/tenancy-agreement",
      filePrefix: "tenancy_agreement",
      failureMessage: "Couldn't generate the tenancy agreement.",
      setBusy: setTaCase,
      busy: taCase,
      extraQuery: { partiesSeed: partiesSeedFor(caseNo) },
    });
  }


  async function handleSyncToSheet() {
    setSyncing(true);
    setSyncResult(null);
    setSyncCount(0);
    const result = await syncCasesToSheet(selected.size > 0 ? [...selected] : undefined);
    setSyncing(false);
    if (result.success) {
      setSyncResult("success");
      setSyncCount(result.synced ?? 0);
      const addr = result.addressesUpdated ?? 0;
      if (!result.synced && !addr) {
        toast.info("All cases already synced to Google Sheet.");
      } else {
        const parts: string[] = [];
        if (result.synced) parts.push(`synced ${result.synced} case(s)`);
        if (addr) parts.push(`updated ${addr} address(es)`);
        toast.success(`${parts.join(", ")} to Google Sheet.`);
      }
    } else {
      setSyncResult("error");
      toast.error(result.error ?? "Sync failed");
    }
    setTimeout(() => setSyncResult(null), 2500);
  }

  const totalPages = Math.ceil(count / PAGE_SIZE);
  const showingFrom = count === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, count);
  const hasFilters = search || (status && status !== "Activated") || dateFrom || dateTo;

  return (
    <>
      {/* Section divider */}
      <div className="border-t border-line pt-6" />

      <div className="space-y-4">
        <div className="animate-fade-in-up" style={{ animationDelay: "500ms" }}>
          <h2 className="text-lg font-semibold text-ink">Case List</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {count} case{count !== 1 ? "s" : ""} in total
            {lastCrawlAt && (
              <span className="ml-3 italic text-ink-muted">
                Last crawl: {new Date(lastCrawlAt).toLocaleString(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(",", "")}
              </span>
            )}
          </p>
        </div>

        {/* Filters bar. Search applies on the button or Enter (form submit). */}
        <div className="bg-white rounded-lg border border-line p-4 animate-fade-in-up" style={{ animationDelay: "550ms" }}>
          <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); applySearch(); }}>
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-55 max-w-lg">
              <div className="relative group min-w-0 flex-1">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted transition-colors group-focus-within:text-brand" />
                <Input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Search name, case no, order ID, mobile…"
                  title="Press Enter or click Search"
                  aria-label="Search cases. Press Enter or click Search to apply."
                  className="pl-9 h-9 bg-wash border-line rounded-lg text-sm text-ink placeholder:text-ink-muted focus:bg-white focus:border-brand transition-all"
                />
              </div>
              <Button type="submit" disabled={invalidDateRange} className="h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50">
                Search
              </Button>
            </div>
            <div className="relative">
              <Select className="h-9 rounded-lg border border-line bg-white pl-3 pr-9 text-sm text-ink-soft focus:border-brand focus:ring-1 focus:ring-brand/20 transition-all outline-none appearance-none" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
                <option value="">All Statuses</option>
                {statuses.map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </div>
            <Segmented
              label="Filter dates by"
              options={[{ value: "case_created_at", label: "Created At" }, { value: "updated_at", label: "Updated At" }]}
              value={dateField}
              onValueChange={(v) => { setDateField(v as typeof dateField); setPage(0); }}
              classic={
                <div role="group" aria-label="Date filter field" className="inline-flex h-9 rounded-lg border border-line bg-wash p-0.5">
                  <button
                    type="button"
                    aria-pressed={dateField === "case_created_at"}
                    onClick={() => { setDateField("case_created_at"); setPage(0); }}
                    className={`rounded-md px-2.5 text-xs font-medium transition-colors ${dateField === "case_created_at" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                  >
                    Created At
                  </button>
                  <button
                    type="button"
                    aria-pressed={dateField === "updated_at"}
                    onClick={() => { setDateField("updated_at"); setPage(0); }}
                    className={`rounded-md px-2.5 text-xs font-medium transition-colors ${dateField === "updated_at" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                  >
                    Updated At
                  </button>
                </div>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-ink-muted whitespace-nowrap font-medium hidden sm:inline">From</label>
              <Input unstyled type="date" aria-label="From date" aria-invalid={invalidDateRange} max={dateTo || undefined} className={`h-9 rounded-lg border bg-white px-2 sm:px-3 text-sm text-ink-soft focus:ring-1 transition-all outline-none max-w-37.5 ${invalidDateRange ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line focus:border-brand focus:ring-brand/20"}`} value={dateFrom} onChange={(e) => applyDateRange(e.target.value, dateTo)} />
              <label className="text-xs text-ink-muted whitespace-nowrap font-medium hidden sm:inline">To</label>
              <Input unstyled type="date" aria-label="To date" aria-invalid={invalidDateRange} aria-describedby={invalidDateRange ? "case-list-date-range-error" : undefined} min={dateFrom || undefined} className={`h-9 rounded-lg border bg-white px-2 sm:px-3 text-sm text-ink-soft focus:ring-1 transition-all outline-none max-w-37.5 ${invalidDateRange ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line focus:border-brand focus:ring-brand/20"}`} value={dateTo} onChange={(e) => applyDateRange(dateFrom, e.target.value)} />
              {invalidDateRange && (
                <p id="case-list-date-range-error" role="alert" className="w-full text-xs font-medium text-danger">
                  {CASE_DATE_RANGE_ERROR}
                </p>
              )}
            </div>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" className="text-xs rounded-lg text-danger hover:bg-red-50 hover:text-danger transition-colors" onClick={clearFilters}>
                Clear all
              </Button>
            )}
          </form>
        </div>

        {/* Generate Bill Buttons + Selection Info */}
        <div className="animate-fade-in-up space-y-2">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3">
            <Button
              onClick={handleSyncToSheet}
              disabled={syncing || syncResult !== null}
              className={`rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all duration-300 press-effect disabled:cursor-not-allowed overflow-hidden ${
                syncResult === "success"
                  ? "bg-[#34A853] border-[#34A853] text-white shadow-[0_0_12px_rgba(52,168,83,0.4)]"
                  : syncResult === "error"
                  ? "bg-[#EA4335] border-[#EA4335] text-white shadow-[0_0_12px_rgba(234,67,53,0.4)]"
                  : "bg-white border border-line text-ink-soft hover:text-[#34A853] hover:border-[#34A853] disabled:opacity-50"
              }`}
            >
              {syncing ? (
                <span className="flex items-center">
                  <span className="relative h-4 w-4 mr-1 sm:mr-2 shrink-0">
                    <span className="absolute inset-0 rounded-full border-2 border-[#34A853]/30" />
                    <span className="absolute inset-0 rounded-full border-2 border-[#34A853] border-t-transparent animate-spin" />
                  </span>
                  <span className="truncate animate-pulse">Syncing...</span>
                </span>
              ) : syncResult === "success" ? (
                <span className="flex items-center animate-[scaleIn_0.3s_ease-out]">
                  <svg className="w-4 h-4 mr-1 sm:mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" className="animate-[drawCheck_0.4s_ease-out_0.1s_both]" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "drawCheck 0.4s ease-out 0.1s forwards" }} />
                  </svg>
                  <span className="truncate">{syncCount > 0 ? `Synced ${syncCount}!` : "All synced!"}</span>
                </span>
              ) : syncResult === "error" ? (
                <span className="flex items-center animate-[shakeX_0.4s_ease-out]">
                  <svg className="w-4 h-4 mr-1 sm:mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  <span className="truncate">Sync failed</span>
                </span>
              ) : (
                <span className="flex items-center">
                  <SyncSheetIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0 transition-transform duration-300 group-hover:rotate-12" />
                  <span className="truncate">{selected.size > 0 ? `Sync ${selected.size} to Sheet` : "Sync to Sheet"}</span>
                </span>
              )}
            </Button>
            {selected.size > 0 && ([
              ["csv", "Download CSV"],
              ["internet", `Download ${UMOBILE_BILL_LABEL}s`],
              ["utility", "Download Utility Bills"],
            ] as const).map(([kind, text]) => (
              <Button key={kind} onClick={() => downloadSelected(kind)} disabled={bulkBusy !== null} className="bg-white border border-line text-ink-soft hover:text-ink hover:border-brand rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all press-effect disabled:opacity-50 disabled:cursor-not-allowed">
                {bulkBusy === kind
                  ? <span className="w-4 h-4 mr-1 sm:mr-2 shrink-0 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  : <DownloadIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />}
                <span className="truncate">{text} ({selected.size})</span>
              </Button>
            ))}
          </div>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-ink-muted tabular-nums">{allSelected ? `All ${selected.size} cases selected` : `${selected.size} selected`}</span>
              {!allSelected && selected.size < count && (
                <button type="button" onClick={selectAllMatching} className="font-medium text-brand hover:underline">Select all {count} cases</button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-danger hover:underline">Clear selection</button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-line overflow-hidden animate-fade-in-up" style={{ animationDelay: "600ms" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className="pl-4 pr-1 py-3 w-8">
                    <input type="checkbox" aria-label="Select all cases on this page" className="cursor-pointer accent-brand" checked={pageAllTicked} onChange={togglePage} />
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} aria-sort={sort.column === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-4 py-3 text-left text-[11px] font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-ink transition-colors ${col.hideOnMobile ? "hidden lg:table-cell" : ""}`} onClick={() => handleSort(col.key)}>
                      <span className="inline-flex items-center gap-1">{col.label}<SortIcon column={col.key} sort={sort} /></span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-[11px] font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap border-l border-line">Bills</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 row-stagger">
                {casesLoading ? (
                  <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-3"><div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" /><span className="text-sm text-ink-muted">Loading cases...</span></div></td></tr>
                ) : cases.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-2"><LottieSpot name="empty-orders" size={96} className="mb-1" fallback={<div className="w-10 h-10 rounded-lg bg-wash flex items-center justify-center mb-2"><EmptyIcon className="w-5 h-5 text-ink-muted" /></div>} /><p className="text-sm font-medium text-ink">No cases found</p><p className="text-xs text-ink-muted">{hasFilters ? "Try adjusting your filters" : "Run a crawl to get started"}</p></div></td></tr>
                ) : (
                  cases.map((c) => (
                    <tr key={c.case_no} className={`hover:bg-wash transition-colors duration-100 cursor-pointer ${selected.has(c.case_no) ? "bg-brand-wash" : selectedCase?.case_no === c.case_no ? "bg-wash" : ""}`} onClick={() => setSelectedCase(c)}>
                      <td className="pl-4 pr-1 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select case ${c.case_no}`} className="cursor-pointer accent-brand" checked={selected.has(c.case_no)} onChange={() => toggleCase(c.case_no)} />
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular-nums whitespace-nowrap">
                        {c.case_url ? (<a href={c.case_url} target="_blank" rel="noopener noreferrer" className="text-brand font-medium hover:underline transition-colors" onClick={(e) => e.stopPropagation()}>{c.case_no}</a>) : (<span className="font-medium text-ink-soft">{c.case_no}</span>)}
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap hidden lg:table-cell"><span className="block truncate max-w-35 text-ink-soft">{c.order_no || "—"}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(c.status)}`}>{c.status ?? "Unknown"}</span></td>
                      <td className="px-4 py-3"><span className="block truncate max-w-40 text-[13px] font-medium text-ink">{c.full_name || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="block truncate max-w-45 text-[13px] text-ink" title={c.company_name || undefined}>{c.company_name || "—"}</span>
                        {c.company_reg && <span className="block truncate max-w-45 text-[11px] text-ink-muted tabular-nums">{c.company_reg}</span>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {(() => {
                          const d = directorDisplay(c);
                          return (
                            <>
                              <span className="block truncate max-w-40 text-[13px] text-ink-soft" title={d.name || undefined}>{d.name || "—"}</span>
                              {d.id && <span className="block truncate max-w-40 text-[11px] text-ink-muted tabular-nums">{d.id}</span>}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block min-w-56 max-w-72 whitespace-normal leading-snug text-[13px] text-ink-muted">{c.full_address || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-ink-soft tabular-nums whitespace-nowrap">{c.mobile || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-35 text-[13px] text-ink-soft">{c.provider || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-40 text-[13px] text-ink-soft">{c.package || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-40 text-[13px] text-ink-muted">{c.agent_remark || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-ink-muted tabular-nums whitespace-nowrap">{formatDateTime(c.case_created_at)}</td>
                      <td className="px-4 py-3 text-[13px] text-ink-muted tabular-nums whitespace-nowrap hidden lg:table-cell">{formatDateTime(c.updated_at)}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {/* Five w-14 buttons + 4 gaps = 296px. Wrap so TA (5th) stays
                            on the first row; a nowrap strip hid it in the last-column
                            clip when the table is scrolled to Bills. */}
                        <div className="flex flex-wrap items-start gap-1 border-l border-line pl-2 w-[296px]">
                          {closingScriptVariant(c) === "conversation" && (
                          <button
                            title="Generate Chat"
                            aria-label={`Generate closing script chat for ${c.case_no}`}
                            disabled={chatBusy(c.case_no, "conversation")}
                            onClick={() => handleGenerateChat(c, "conversation")}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#25D366] hover:bg-[#E8FFF3] disabled:cursor-not-allowed"
                          >
                            {chatBusy(c.case_no, "conversation")
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#25D366] border-t-transparent animate-spin" />
                              : <MessageSquareIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">Chat</span>
                          </button>
                          )}
                          {closingScriptVariant(c) === "bizz" && (
                          <button
                            title="Generate Bizz Chat"
                            aria-label={`Generate bizz chat for ${c.case_no}`}
                            disabled={chatBusy(c.case_no, "bizz")}
                            onClick={() => handleGenerateChat(c, "bizz")}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#0D9488] hover:bg-[#E6FFFA] disabled:cursor-not-allowed"
                          >
                            {chatBusy(c.case_no, "bizz")
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin" />
                              : <MessageSquareIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted text-center">Bizz Chat</span>
                          </button>
                          )}
                          <button
                            title={c.internet_bill_url ? `Download ${UMOBILE_BILL_LABEL}` : `Generate ${UMOBILE_BILL_LABEL}`}
                            aria-label={c.internet_bill_url ? `Download umobile bill for ${c.case_no}` : `Generate umobile bill for ${c.case_no}`}
                            disabled={generatingCell === `${c.case_no}:internet`}
                            onClick={() => handleGenerateSingle(c.case_no, "internet")}
                            className={`w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors disabled:cursor-not-allowed ${c.internet_bill_url ? "text-brand hover:bg-[#F0EEFF]" : "text-[#9CA3AF] hover:text-brand hover:bg-[#F0EEFF]"}`}
                          >
                            {generatingCell === `${c.case_no}:internet`
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-brand border-t-transparent animate-spin" />
                              : <InternetBillIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">{UMOBILE_BILL_SHORT}</span>
                          </button>
                          <button
                            title={c.utility_bill_url ? "Download Utility Bill" : "Generate Utility Bill"}
                            aria-label={c.utility_bill_url ? `Download utility bill for ${c.case_no}` : `Generate utility bill for ${c.case_no}`}
                            disabled={generatingCell === `${c.case_no}:utility`}
                            onClick={() => c.utility_bill_url
                              ? window.open(`/api/bills/download?case_no=${c.case_no}&type=utility&t=${billCacheBuster}`, "_blank")
                              : handleGenerateSingle(c.case_no, "utility")}
                            className={`w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors disabled:cursor-not-allowed ${c.utility_bill_url ? "text-[#FF6B35] hover:bg-[#FFF0EB]" : "text-[#9CA3AF] hover:text-[#FF6B35] hover:bg-[#FFF0EB]"}`}
                          >
                            {generatingCell === `${c.case_no}:utility`
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#FF6B35] border-t-transparent animate-spin" />
                              : <UtilityBillIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">Utility</span>
                          </button>
                          <button
                            data-action="tenancy-agreement"
                            title={c.full_name?.trim() ? "Download Tenancy Agreement" : "Tenancy Agreement needs a customer name"}
                            aria-label={c.full_name?.trim() ? `Download tenancy agreement for ${c.case_no}` : `Tenancy agreement unavailable for ${c.case_no}: no customer name`}
                            disabled={!c.full_name?.trim() || taCase === c.case_no}
                            onClick={() => handleTenancyAgreement(c.case_no)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#7C3AED] hover:bg-[#F3E8FF] disabled:cursor-not-allowed disabled:text-[#9CA3AF] disabled:hover:bg-transparent"
                          >
                            {taCase === c.case_no
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#7C3AED] border-t-transparent animate-spin" />
                              : <TenancyAgreementIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">TA</span>
                          </button>
                          <button
                            title={`Generate ${AUTH_LETTER_LABEL[authLetterVariant(c)]}`}
                            aria-label={`Generate ${AUTH_LETTER_LABEL[authLetterVariant(c)].toLowerCase()} for ${c.case_no}`}
                            disabled={letterCase === c.case_no}
                            onClick={() => handleAuthorizationLetter(c)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#0E9384] hover:bg-[#E6FAF7] disabled:cursor-not-allowed"
                          >
                            {letterCase === c.case_no
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#0E9384] border-t-transparent animate-spin" />
                              : <AuthLetterIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">{AUTH_LETTER_LABEL[authLetterVariant(c)]}</span>
                          </button>
                          <button
                            title="Generate TIME Invoice"
                            aria-label={`Generate TIME invoice for ${c.case_no}`}
                            disabled={timeCase === c.case_no}
                            onClick={() => handleTimeInvoice(c.case_no)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#EC008C] hover:bg-[#FFEBF6] disabled:cursor-not-allowed"
                          >
                            {timeCase === c.case_no
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#EC008C] border-t-transparent animate-spin" />
                              : <TimeBillIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-ink-muted">TIME</span>
                          </button>
                          <button
                            title="Combine this case's documents into one PDF"
                            aria-label={`Combine documents for ${c.case_no} into one PDF`}
                            onClick={() => setMergeCase(c)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-ink hover:bg-[#EEF0FF] hover:text-brand"
                          >
                            <MergeIcon className="w-4 h-4" />
                            <span className="text-[10px] leading-none font-medium text-ink-muted">Combine</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-line bg-wash">
            <span className="text-xs text-ink-muted">Showing{" "}<span className="font-medium text-ink tabular-nums">{showingFrom}–{showingTo}</span>{" "}of <span className="font-medium text-ink tabular-nums">{count}</span> cases</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-8 px-2 sm:px-3 text-xs rounded-md border-line text-ink-soft">Prev</Button>
              <span className="hidden sm:contents">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) pageNum = i;
                else if (page < 3) pageNum = i;
                else if (page > totalPages - 4) pageNum = totalPages - 5 + i;
                else pageNum = page - 2 + i;
                return (
                  <Button key={pageNum} variant={pageNum === page ? "default" : "outline"} size="sm" className={`h-8 w-8 p-0 text-xs rounded-md tabular-nums ${pageNum === page ? "bg-brand text-white border-brand" : "border-line text-ink-soft"}`} onClick={() => setPage(pageNum)}>{pageNum + 1}</Button>
                );
              })}
              </span>
              <span className="sm:hidden text-xs text-ink-muted tabular-nums px-2">{page + 1}/{totalPages || 1}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="h-8 px-2 sm:px-3 text-xs rounded-md border-line text-ink-soft">Next</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-in detail panel */}
      {selectedCase && createPortal(
        <CaseDetailPanel caseData={selectedCase} onClose={() => setSelectedCase(null)} cacheBuster={billCacheBuster} onGenerateChat={handleGenerateChat} chatLoading={chatLoadingCase?.caseNo === selectedCase.case_no ? chatLoadingCase.variant : null} onGenerateLetter={handleAuthorizationLetter} letterLoading={letterCase === selectedCase.case_no} onCombine={setMergeCase} />,
        document.body
      )}

      {chatCase && (
        <ChatImageGenerator
          key={`${chatCase.caseData.case_no}-${chatCase.variant}`}
          caseData={chatCase.caseData}
          variant={chatCase.variant}
          onClose={() => setChatCase(null)}
        />
      )}

      {/* Combine one case's documents into a single PDF */}
      {mergeCase && (
        <MergePdfDialog
          caseData={mergeCase}
          // An address the dialog had to look up for the chat is written back,
          // so the table and any open panel stop showing a blank one.
          onAddressResolved={(caseNo, address) => {
            setCases((prev) => prev.map((r) => (r.case_no === caseNo ? { ...r, full_address: address } : r)));
            setSelectedCase((prev) => (prev && prev.case_no === caseNo ? { ...prev, full_address: address } : prev));
            setMergeCase((prev) => (prev && prev.case_no === caseNo ? { ...prev, full_address: address } : prev));
          }}
          // Bills generated on the way to a merge are real, stored bills: the
          // table's icons and the case's own row are otherwise a step behind.
          onBillsGenerated={async () => {
            setBillCacheBuster((prev) => prev + 1);
            await fetchCases();
          }}
          onClose={() => setMergeCase(null)}
        />
      )}
    </>
  );
}

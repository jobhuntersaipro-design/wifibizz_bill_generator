"use client";

import LottieSpot from "@/components/order-entry/LottieSpot";
import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { initialsFor } from "@/lib/order-types";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  type CaseRow, type SortState, PAGE_SIZE, COLUMNS,
  formatDateTime, getStatusStyle,
} from "./shared";
import {
  SearchIcon, EmptyIcon, CloseIcon, ExternalLinkIcon, SortIcon,
  InternetBillIcon, UtilityBillIcon, DownloadIcon, CheckCircleIcon,
  MessageSquareIcon, AuthLetterIcon, SyncSheetIcon, TimeBillIcon, TenancyAgreementIcon, MergeIcon,
} from "./icons";
import ChatImageGenerator from "./ChatImageGenerator";
import MergePdfDialog from "./MergePdfDialog";
import { syncCasesToSheet } from "@/actions/settings";
import { billDownloadPath, revisionFromPublicUrl } from "@/lib/bill-object";

// ── Case Detail Panel ──

function CaseDetailPanel({ caseData, onClose, cacheBuster, onGenerateChat, chatLoading, onGenerateLetter, letterLoading, onCombine }: { caseData: CaseRow; onClose: () => void; cacheBuster: number; onGenerateChat: (c: CaseRow) => void; chatLoading: boolean; onGenerateLetter: (caseNo: string) => void; letterLoading: boolean; onCombine: (c: CaseRow) => void }) {
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

  const sections = [
    { title: "Case Information", fields: [
      { label: "Case No.", value: caseData.case_no },
      { label: "Order ID", value: caseData.order_no },
      { label: "Status", value: caseData.status, isStatus: true },
    ]},
    { title: "Customer Details", fields: [
      { label: "Full Name", value: caseData.full_name },
      { label: "Full Address", value: caseData.full_address },
      { label: "Mobile", value: caseData.mobile },
      { label: "Email", value: caseData.email },
      { label: "ID No.", value: caseData.id_no },
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
        className="flex w-full flex-col gap-0 border-l border-[#E3E8EF] bg-white p-0 sm:max-w-md data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=right]:duration-300"
      >
        <SheetTitle className="sr-only">Case details for {caseData.case_no}</SheetTitle>
        <SheetDescription className="sr-only">Customer, package, agent and bill details for this case.</SheetDescription>
        <div className="flex items-start gap-3 px-6 py-4 border-b border-[#E3E8EF]">
          <span className="panel-item-in flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EDEBFF] text-[13px] font-semibold text-[#635BFF]" aria-hidden="true">
            {initialsFor(caseData.full_name ?? "")}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="panel-item-in truncate text-[15px] font-semibold leading-tight text-[#0A2540]" style={{ animationDelay: "40ms" }}>
              {caseData.full_name || "Case details"}
            </h2>
            <div className="panel-item-in mt-1 flex flex-wrap items-center gap-1.5" style={{ animationDelay: "80ms" }}>
              <span className="rounded-md bg-[#EDEBFF] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#635BFF] transition-colors duration-150 hover:bg-[#DEDAFF]">{caseData.case_no}</span>
              {caseData.status && (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${getStatusStyle(caseData.status)}`}>{caseData.status}</span>
              )}
            </div>
          </div>
          <button onClick={requestClose} aria-label="Close case details" className="group -mr-2.5 -mt-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]">
            <CloseIcon className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sections.map((section, sectionIndex) => {
            const visibleFields = section.fields.filter((f) => f.value);
            if (visibleFields.length === 0) return null;
            const delay = 200 + sectionIndex * 80;
            return (
              <div key={section.title}>
                {sectionIndex > 0 && (<div className="border-t border-[#E3E8EF] my-5 panel-item-in"  style={{ animationDelay: `${delay}ms` }} />)}
                <div className="panel-item-in" style={{ animationDelay: `${delay}ms` }}>
                  <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">{section.title}</h3>
                  <div className="space-y-3">
                    {visibleFields.map((field, fieldIndex) => (
                      <div key={field.label} className="panel-item-in" style={{ animationDelay: `${delay + 40 + fieldIndex * 40}ms` }}>
                        <dt className="text-xs text-[#697386] mb-0.5">{field.label}</dt>
                        <dd className="text-sm text-[#0A2540]">
                          {field.isStatus ? (<span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(field.value ?? null)}`}>{field.value}</span>) : (<span className="wrap-break-word">{field.value}</span>)}
                        </dd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Internet Bill Preview */}
          <div className="border-t border-[#E3E8EF] my-5 panel-item-in"  style={{ animationDelay: "600ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "650ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Internet Bill</h3>
            {caseData.internet_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#E3E8EF] overflow-hidden bg-[#F6F9FC]">
                  <iframe src={billDownloadPath(caseData.case_no, "internet", `${revisionFromPublicUrl(caseData.internet_bill_url)}-${cacheBuster}`, { preview: true })} className="w-full h-100" title="Internet Bill Preview" />
                </div>
                <a href={billDownloadPath(caseData.case_no, "internet", `${revisionFromPublicUrl(caseData.internet_bill_url)}-${cacheBuster}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download Internet Bill
                </a>
              </div>
            ) : (
              <p className="text-sm text-[#697386]">No bill generated yet. Select this case and click &ldquo;Generate Internet Bill&rdquo;.</p>
            )}
          </div>

          {/* Utility Bill Preview */}
          <div className="border-t border-[#E3E8EF] my-5 panel-item-in"  style={{ animationDelay: "700ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "750ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Utility Bill</h3>
            {caseData.utility_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#E3E8EF] overflow-hidden bg-[#F6F9FC]">
                  <iframe src={billDownloadPath(caseData.case_no, "utility", `${revisionFromPublicUrl(caseData.utility_bill_url)}-${cacheBuster}`)} className="w-full h-100" title="Utility Bill Preview" />
                </div>
                <a href={billDownloadPath(caseData.case_no, "utility", `${revisionFromPublicUrl(caseData.utility_bill_url)}-${cacheBuster}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#FF6B35] hover:text-[#0A2540] transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download Utility Bill
                </a>
              </div>
            ) : (
              <p className="text-sm text-[#697386]">No bill generated yet. Select this case and click &ldquo;Generate Utility Bill&rdquo;.</p>
            )}
          </div>

          {/* Authorization Letter */}
          <div className="border-t border-[#E3E8EF] my-5 panel-item-in"  style={{ animationDelay: "780ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "800ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Authorization Letter</h3>
            <button
              onClick={() => onGenerateLetter(caseData.case_no)}
              disabled={letterLoading}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#0E9384] hover:text-[#0A2540] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {letterLoading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#0E9384] border-t-transparent animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <AuthLetterIcon className="w-3.5 h-3.5" />Download Authorization Letter
                </>
              )}
            </button>
            <p className="mt-2 text-xs text-[#697386]">Generated fresh each time and not stored. The property owner is generated; the resident is this customer.</p>
          </div>

          {/* Combine documents */}
          <div className="border-t border-[#E3E8EF] my-5 panel-item-in" style={{ animationDelay: "820ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "840ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Combine Documents</h3>
            <button
              onClick={() => onCombine(caseData)}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200"
            >
              <MergeIcon className="w-3.5 h-3.5" />Combine into one PDF
            </button>
            <p className="mt-2 text-xs text-[#697386]">Pick which of this case&rsquo;s documents to combine, in the order you want them.</p>
          </div>

          {/* Generate Chat */}
          <div className="border-t border-[#E3E8EF] my-5 panel-item-in"  style={{ animationDelay: "860ms" }} />
          <div className="panel-item-in" style={{ animationDelay: "880ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Closing Script</h3>
            <button
              onClick={() => onGenerateChat(caseData)}
              disabled={chatLoading}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#25D366] hover:text-[#1DA851] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {chatLoading ? (
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
          </div>
        </div>
        {caseData.case_url && (
          <div className="px-6 py-4 border-t border-[#E3E8EF] panel-item-in"  style={{ animationDelay: "700ms" }}>
            <a href={caseData.case_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200">
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

export default function CaseManagementSection() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [casesLoading, setCasesLoading] = useState(true);
  const [lastCrawlAt, setLastCrawlAt] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ column: "case_created_at", dir: "desc" });
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set());
  const [allCasesSelected, setAllCasesSelected] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0, type: "" });
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, type: "" });
  const [downloadConfirm, setDownloadConfirm] = useState<{ type: "internet" | "utility"; withBills: number; total: number } | null>(null);
  const [billCacheBuster, setBillCacheBuster] = useState(0);
  // The case whose documents are being combined into one PDF.
  const [mergeCase, setMergeCase] = useState<CaseRow | null>(null);
  // Per-row single-bill generation in flight, keyed `${caseNo}:${type}`.
  const [generatingCell, setGeneratingCell] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [chatCase, setChatCase] = useState<CaseRow | null>(null);
  // Case whose installation address is being fetched before the chat opens.
  const [chatLoadingCase, setChatLoadingCase] = useState<string | null>(null);
  // Case whose authorization letter is being generated.
  const [letterCase, setLetterCase] = useState<string | null>(null);
  const [timeCase, setTimeCase] = useState<string | null>(null);
  const [taCase, setTaCase] = useState<string | null>(null);
  const taAuthSeeds = useRef<Record<string, number>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<"success" | "error" | null>(null);
  const [syncCount, setSyncCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCases = useCallback(async () => {
    setCasesLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort_by: sort.column,
      sort_dir: sort.dir,
    });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    const res = await fetch(`/api/cases?${params}`);
    const json = await res.json();
    setCases(json.data ?? []);
    setCount(json.count ?? 0);
    if (json.statuses) setStatuses(json.statuses);
    if (json.last_crawl_at !== undefined) setLastCrawlAt(json.last_crawl_at);
    setCasesLoading(false);
  }, [page, search, status, dateFrom, dateTo, sort]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      setSearch(value);
      setSelectedCases(new Set());
    }, 300);
  }

  function handleSort(column: string) {
    setSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === "desc" ? "asc" : "desc",
    }));
    setPage(0);
  }

  function toggleCaseSelection(caseNo: string) {
    setSelectedCases((prev) => {
      const next = new Set(prev);
      if (next.has(caseNo)) next.delete(caseNo);
      else next.add(caseNo);
      return next;
    });
  }

  function toggleSelectAll() {
    const allOnPage = cases.map((c) => c.case_no);
    const allSelected = allOnPage.every((cn) => selectedCases.has(cn));
    if (allSelected) {
      setSelectedCases((prev) => {
        const next = new Set(prev);
        allOnPage.forEach((cn) => next.delete(cn));
        return next;
      });
      setAllCasesSelected(false);
    } else {
      setSelectedCases((prev) => {
        const next = new Set(prev);
        allOnPage.forEach((cn) => next.add(cn));
        return next;
      });
    }
  }

  async function selectAllCases() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const res = await fetch(`/api/cases/ids?${params}`);
    const json = await res.json();
    const allNos = (json.case_nos ?? []) as string[];
    setSelectedCases(new Set(allNos));
    setAllCasesSelected(true);
  }

  function clearSelection() {
    setSelectedCases(new Set());
    setAllCasesSelected(false);
  }

  async function handleGenerateBills(type: "internet" | "utility") {
    if (selectedCases.size === 0 || generating) return;

    // Pre-check usage limit before generating
    try {
      const usageRes = await fetch("/api/cases/usage");
      const usage = await usageRes.json();
      if (usage.remaining === 0) {
        toast.error("Case limit reached. Please top up your usage to generate more bills.", { duration: 5000 });
        return;
      }
    } catch {
      // Fail open — let the API enforce the limit
    }

    const caseNos = Array.from(selectedCases);
    const total = caseNos.length;
    setGenerating(true);
    setGenerateProgress({ current: 0, total, type });

    const BATCH_SIZE = 5;
    let totalGenerated = 0;
    let totalFailed = 0;
    let limitReached = false;

    try {
      for (let i = 0; i < caseNos.length; i += BATCH_SIZE) {
        const batch = caseNos.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (caseNo) => {
            const res = await fetch("/api/bills/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ caseNos: [caseNo], type }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              if (body.error === "case_limit_reached") {
                limitReached = true;
              }
              throw new Error(body.error || `Failed for ${caseNo}`);
            }
            return res.json();
          })
        );
        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.filter((r) => r.status === "rejected").length;
        totalGenerated += succeeded;
        totalFailed += failed;
        setGenerateProgress({ current: Math.min(i + BATCH_SIZE, total), total, type });

        // Stop processing further batches if limit reached
        if (limitReached) break;
      }

      if (limitReached) {
        toast.error("Case limit reached. Please top up your usage to generate more bills.", { duration: 5000 });
      } else if (totalFailed > 0) {
        toast.error(`${totalFailed} bill(s) failed to generate`);
      } else {
        toast.success(`Generated ${totalGenerated} ${type} bill(s)`);
      }

      setBillCacheBuster((prev) => prev + 1);
      await fetchCases();
      // Notify AnalyticsSection to refresh usage
      window.dispatchEvent(new Event("usage-updated"));
    } catch (err) {
      console.error("Bill generation failed:", err);
      toast.error("Bill generation failed. Please try again.");
    } finally {
      setGenerating(false);
      setGenerateProgress({ current: 0, total: 0, type: "" });
    }
  }

  // Generate a single bill straight from its row icon (no need to select first),
  // then open it right away. Address is lazily fetched server-side during generation.
  // Internet always regenerates: a stored URL can still be the old slot-stamped
  // 3-page PDF, and POST /api/bills/generate is free when the case already has a bill.
  async function handleGenerateSingle(caseNo: string, type: "internet" | "utility") {
    const key = `${caseNo}:${type}`;
    if (generatingCell || generating) return;
    setGeneratingCell(key);
    const toastId = toast.loading(
      type === "internet" ? "Building internet bill…" : "Building utility bill…",
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
      toast.success(`${type === "internet" ? "Internet" : "Utility"} bill ready`, { id: toastId });
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
  async function handleGenerateChat(c: CaseRow) {
    if (chatLoadingCase) return;
    if ((c.full_address && c.full_address.trim()) || !c.case_url) {
      setChatCase(c);
      return;
    }
    setChatLoadingCase(c.case_no);
    try {
      const res = await fetch("/api/cases/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNos: [c.case_no] }),
      });
      const body = await res.json().catch(() => ({}));
      const address: string | undefined = body?.addresses?.[c.case_no];
      if (address) {
        setCases((prev) => prev.map((r) => (r.case_no === c.case_no ? { ...r, full_address: address } : r)));
        setSelectedCase((prev) => (prev && prev.case_no === c.case_no ? { ...prev, full_address: address } : prev));
        setChatCase({ ...c, full_address: address });
      } else {
        toast.error("Couldn't fetch the installation address — generating chat without it.");
        setChatCase(c);
      }
    } catch (err) {
      console.error("Address fetch failed:", err);
      toast.error("Couldn't fetch the installation address — generating chat without it.");
      setChatCase(c);
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

  function handleAuthorizationLetter(caseNo: string) {
    return downloadDocument({
      caseNo,
      endpoint: "/api/bills/authorization-letter",
      filePrefix: "authorization_letter",
      failureMessage: "Couldn't generate the authorization letter.",
      setBusy: setLetterCase,
      busy: letterCase,
      extraQuery: { partiesSeed: partiesSeedFor(caseNo) },
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

  function handleDownloadClick(type: "internet" | "utility") {
    if (selectedCases.size === 0 || downloading) return;
    const billKey = type === "internet" ? "internet_bill_url" : "utility_bill_url";
    const source = cases;
    const withBills = source.filter((c) => selectedCases.has(c.case_no) && c[billKey]).length;
    setDownloadConfirm({ type, withBills, total: selectedCases.size });
  }

  async function handleBulkDownload(type: "internet" | "utility") {
    setDownloadConfirm(null);
    if (selectedCases.size === 0 || downloading) return;
    setDownloading(true);
    setDownloadProgress({ current: 0, total: 100, type });

    try {
      setDownloadProgress({ current: 10, total: 100, type });

      const res = await fetch("/api/bills/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNos: Array.from(selectedCases), type }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Download failed");
        return;
      }

      setDownloadProgress({ current: 50, total: 100, type });

      const reader = res.body?.getReader();
      const chunks: BlobPart[] = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      }

      setDownloadProgress({ current: 90, total: 100, type });

      const blob = new Blob(chunks, { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_bills_${new Date().toISOString().split("T")[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await new Promise((resolve) => setTimeout(resolve, 800));
      toast.success(`Downloaded ${type} bills as ZIP`);
    } catch (err) {
      console.error("Bulk download failed:", err);
      toast.error("Download failed. Please try again.");
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0, type: "" });
    }
  }

  async function handleSyncToSheet() {
    setSyncing(true);
    setSyncResult(null);
    setSyncCount(0);
    const result = await syncCasesToSheet();
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
      <div className="border-t border-[#E3E8EF] pt-6" />

      <div className="space-y-4">
        <div className="animate-fade-in-up" style={{ animationDelay: "500ms" }}>
          <h2 className="text-lg font-semibold text-[#0A2540]">Case List</h2>
          <p className="text-sm text-[#697386] mt-0.5">
            {count} case{count !== 1 ? "s" : ""} in total
            {lastCrawlAt && (
              <span className="ml-3 italic text-[#697386]">
                Last crawl: {new Date(lastCrawlAt).toLocaleString(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(",", "")}
              </span>
            )}
          </p>
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-lg border border-[#E3E8EF] p-4 animate-fade-in-up" style={{ animationDelay: "550ms" }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0 sm:min-w-55 max-w-sm relative group">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#697386] transition-colors group-focus-within:text-[#635BFF]" />
              <Input placeholder="Search name, case no, mobile, provider..." defaultValue="" onChange={(e) => handleSearchChange(e.target.value)} className="pl-9 h-9 bg-[#F6F9FC] border-[#E3E8EF] rounded-lg text-sm text-[#0A2540] placeholder:text-[#697386] focus:bg-white focus:border-[#635BFF] transition-all" />
            </div>
            <div className="relative">
              <select className="h-9 rounded-lg border border-[#E3E8EF] bg-white pl-3 pr-9 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none appearance-none" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
                <option value="">All Statuses</option>
                {statuses.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#697386]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium hidden sm:inline">From</label>
              <input type="date" aria-label="From date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-2 sm:px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none max-w-37.5" value={dateFrom} onChange={(e) => { setPage(0); setDateFrom(e.target.value); }} />
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium hidden sm:inline">To</label>
              <input type="date" aria-label="To date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-2 sm:px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none max-w-37.5" value={dateTo} onChange={(e) => { setPage(0); setDateTo(e.target.value); }} />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="text-xs rounded-lg text-[#DF1B41] hover:bg-red-50 hover:text-[#DF1B41] transition-colors" onClick={() => { setSearch(""); setStatus("Activated"); setDateFrom(""); setDateTo(""); setPage(0); }}>
                Clear all
              </Button>
            )}
          </div>
        </div>

        {/* Generate Bill Buttons + Selection Info */}
        <div className="animate-fade-in-up space-y-2">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3">
            <Button onClick={() => handleGenerateBills("internet")} disabled={generating || selectedCases.size === 0} className="bg-[#635BFF] hover:bg-[#5851DB] text-white rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all hover-glow press-effect disabled:opacity-50 disabled:cursor-not-allowed">
              <InternetBillIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Generate Internet Bill{selectedCases.size > 0 ? ` (${selectedCases.size})` : ""}</span>
            </Button>
            <Button onClick={() => handleGenerateBills("utility")} disabled={generating || selectedCases.size === 0} className="bg-[#FF6B35] hover:bg-[#E55A2B] text-white rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all hover-glow press-effect disabled:opacity-50 disabled:cursor-not-allowed">
              <UtilityBillIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Generate Utility Bill{selectedCases.size > 0 ? ` (${selectedCases.size})` : ""}</span>
            </Button>
            <Button onClick={() => handleDownloadClick("internet")} disabled={downloading || generating || selectedCases.size === 0} className="bg-white border border-[#E3E8EF] text-[#425466] hover:text-[#0A2540] hover:border-[#635BFF] rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all press-effect disabled:opacity-50 disabled:cursor-not-allowed">
              <DownloadIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Download Internet Bill{selectedCases.size > 0 ? ` (${selectedCases.size})` : ""}</span>
            </Button>
            <Button onClick={() => handleDownloadClick("utility")} disabled={downloading || generating || selectedCases.size === 0} className="bg-white border border-[#E3E8EF] text-[#425466] hover:text-[#0A2540] hover:border-[#FF6B35] rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all press-effect disabled:opacity-50 disabled:cursor-not-allowed">
              <DownloadIcon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
              <span className="truncate">Download Utility Bill{selectedCases.size > 0 ? ` (${selectedCases.size})` : ""}</span>
            </Button>
            <Button
              onClick={handleSyncToSheet}
              disabled={syncing || generating || downloading || syncResult !== null}
              className={`rounded-lg h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium transition-all duration-300 press-effect disabled:cursor-not-allowed overflow-hidden ${
                syncResult === "success"
                  ? "bg-[#34A853] border-[#34A853] text-white shadow-[0_0_12px_rgba(52,168,83,0.4)]"
                  : syncResult === "error"
                  ? "bg-[#EA4335] border-[#EA4335] text-white shadow-[0_0_12px_rgba(234,67,53,0.4)]"
                  : "bg-white border border-[#E3E8EF] text-[#425466] hover:text-[#34A853] hover:border-[#34A853] disabled:opacity-50"
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
                  <span className="truncate">Sync to Sheet</span>
                </span>
              )}
            </Button>
          </div>
          {selectedCases.size > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {!allCasesSelected && (
                <button onClick={selectAllCases} className="text-xs text-[#635BFF] hover:text-[#5851DB] font-medium transition-colors">
                  Select all {count} cases
                </button>
              )}
              <button onClick={clearSelection} className="text-xs text-[#DF1B41] hover:text-red-700 font-medium transition-colors">
                Clear selection
              </button>
              {allCasesSelected && (
                <span className="text-xs text-[#697386]">All {selectedCases.size} cases selected</span>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {generating && generateProgress.total > 0 && (() => {
          const pct = Math.round((generateProgress.current / generateProgress.total) * 100);
          const isComplete = generateProgress.current === generateProgress.total;
          return (
            <div className="animate-fade-in-up bg-white rounded-lg border border-[#E3E8EF] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isComplete ? (<CheckCircleIcon className="w-4 h-4 text-[#09825D]" />) : (<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />)}
                  <span className="text-sm font-medium text-[#0A2540]">{isComplete ? "Generation complete!" : `Generating ${generateProgress.type} bills...`}</span>
                </div>
                <span className="text-xs tabular-nums font-semibold text-[#0A2540]">{pct}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#E3E8EF] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? "bg-[#09825D]" : "bg-[#635BFF] progress-bar-glow"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-[#697386] tabular-nums">{generateProgress.current} of {generateProgress.total} bill{generateProgress.total !== 1 ? "s" : ""} processed</p>
            </div>
          );
        })()}

        {/* Download Progress Bar */}
        {downloading && downloadProgress.total > 0 && (() => {
          const pct = downloadProgress.current;
          const isComplete = pct >= 100;
          return (
            <div className="animate-fade-in-up bg-white rounded-lg border border-[#E3E8EF] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isComplete ? (<CheckCircleIcon className="w-4 h-4 text-[#09825D]" />) : (<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />)}
                  <span className="text-sm font-medium text-[#0A2540]">{isComplete ? "Download complete!" : `Downloading ${downloadProgress.type} bills...`}</span>
                </div>
                <span className="text-xs tabular-nums font-semibold text-[#0A2540]">{pct}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#E3E8EF] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? "bg-[#09825D]" : "bg-[#635BFF] progress-bar-glow"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-[#697386]">{isComplete ? "Preparing ZIP file..." : "Fetching bills from storage..."}</p>
            </div>
          );
        })()}

        {/* Download Confirmation Modal */}
        {downloadConfirm && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-fade-in" onClick={() => setDownloadConfirm(null)}>
            <div className="bg-white rounded-xl shadow-2xl border border-[#E3E8EF] w-full max-w-sm mx-4 animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-[#F0EEFF] flex items-center justify-center">
                    <DownloadIcon className="w-5 h-5 text-[#635BFF]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#0A2540]">Download {downloadConfirm.type === "internet" ? "Internet" : "Utility"} Bills</h3>
                    <p className="text-xs text-[#697386]">{downloadConfirm.total} case{downloadConfirm.total !== 1 ? "s" : ""} selected</p>
                  </div>
                </div>
                <div className="bg-[#F6F9FC] rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#425466]">Bills generated</span>
                    <span className="text-sm font-semibold tabular-nums text-[#0A2540]">{downloadConfirm.withBills} / {downloadConfirm.total}</span>
                  </div>
                  <div className="w-full h-1.5 bg-[#E3E8EF] rounded-full overflow-hidden">
                    <div className="h-full bg-[#09825D] rounded-full transition-all duration-500" style={{ width: `${downloadConfirm.total > 0 ? (downloadConfirm.withBills / downloadConfirm.total) * 100 : 0}%` }} />
                  </div>
                  {downloadConfirm.withBills === 0 ? (
                    <p className="text-xs text-[#DF1B41]">No bills have been generated yet. Generate bills first before downloading.</p>
                  ) : downloadConfirm.withBills < downloadConfirm.total ? (
                    <p className="text-xs text-[#D97706]">Only {downloadConfirm.withBills} of {downloadConfirm.total} selected cases have bills generated. Only generated bills will be downloaded.</p>
                  ) : (
                    <p className="text-xs text-[#09825D]">All selected cases have bills generated.</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 px-6 py-4 border-t border-[#E3E8EF]">
                <Button variant="outline" size="sm" className="flex-1 rounded-lg border-[#E3E8EF] text-[#425466]" onClick={() => setDownloadConfirm(null)}>Cancel</Button>
                <Button size="sm" disabled={downloadConfirm.withBills === 0} className="flex-1 rounded-lg bg-[#635BFF] hover:bg-[#5851DB] text-white disabled:opacity-50" onClick={() => handleBulkDownload(downloadConfirm.type)}>Download ({downloadConfirm.withBills})</Button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Table */}
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden animate-fade-in-up" style={{ animationDelay: "600ms" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#E3E8EF]">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" aria-label="Select all cases" className="rounded border-[#E3E8EF] text-[#635BFF] focus:ring-[#635BFF]/20 cursor-pointer" checked={cases.length > 0 && cases.every((c) => selectedCases.has(c.case_no))} onChange={toggleSelectAll} />
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} aria-sort={sort.column === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-4 py-3 text-left text-[11px] font-semibold text-[#697386] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-[#0A2540] transition-colors ${col.hideOnMobile ? "hidden lg:table-cell" : ""}`} onClick={() => handleSort(col.key)}>
                      <span className="inline-flex items-center gap-1">{col.label}<SortIcon column={col.key} sort={sort} /></span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-[11px] font-semibold text-[#697386] uppercase tracking-wider whitespace-nowrap border-l border-[#E3E8EF]">Bills</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E8EF]/60 row-stagger">
                {casesLoading ? (
                  <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-3"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" /><span className="text-sm text-[#697386]">Loading cases...</span></div></td></tr>
                ) : cases.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-2"><LottieSpot name="empty-orders" size={96} className="mb-1" fallback={<div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-2"><EmptyIcon className="w-5 h-5 text-[#697386]" /></div>} /><p className="text-sm font-medium text-[#0A2540]">No cases found</p><p className="text-xs text-[#697386]">{hasFilters ? "Try adjusting your filters" : "Run a crawl to get started"}</p></div></td></tr>
                ) : (
                  cases.map((c) => (
                    <tr key={c.case_no} className={`hover:bg-[#F6F9FC] transition-colors duration-100 cursor-pointer ${selectedCase?.case_no === c.case_no ? "bg-[#F6F9FC]" : ""} ${selectedCases.has(c.case_no) ? "bg-[#F0EEFF]" : ""}`} onClick={() => setSelectedCase(c)}>
                      <td className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select case ${c.case_no}`} className="rounded border-[#E3E8EF] text-[#635BFF] focus:ring-[#635BFF]/20 cursor-pointer" checked={selectedCases.has(c.case_no)} onChange={() => toggleCaseSelection(c.case_no)} />
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular-nums whitespace-nowrap">
                        {c.case_url ? (<a href={c.case_url} target="_blank" rel="noopener noreferrer" className="text-[#635BFF] font-medium hover:underline transition-colors" onClick={(e) => e.stopPropagation()}>{c.case_no}</a>) : (<span className="font-medium text-[#425466]">{c.case_no}</span>)}
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap hidden lg:table-cell"><span className="block truncate max-w-35 text-[#425466]">{c.order_no || "—"}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(c.status)}`}>{c.status ?? "Unknown"}</span></td>
                      <td className="px-4 py-3"><span className="block truncate max-w-40 text-[13px] font-medium text-[#0A2540]">{c.full_name || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-45 text-[13px] text-[#697386]">{c.full_address || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#425466] tabular-nums whitespace-nowrap">{c.mobile || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-35 text-[13px] text-[#425466]">{c.provider || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-40 text-[13px] text-[#425466]">{c.package || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-40 text-[13px] text-[#697386]">{c.agent_remark || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap">{formatDateTime(c.case_created_at)}</td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap hidden lg:table-cell">{formatDateTime(c.updated_at)}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {/* Four w-14 buttons + 3 gaps = 236px. Wrap so TA (4th) stays
                            on the first row; a nowrap 480px strip hid it in the
                            last-column clip when the table is scrolled to Bills. */}
                        <div className="flex flex-wrap items-start gap-1 border-l border-[#E3E8EF] pl-2 w-[236px]">
                          <button
                            title="Generate Chat"
                            aria-label={`Generate closing script chat for ${c.case_no}`}
                            disabled={chatLoadingCase === c.case_no}
                            onClick={() => handleGenerateChat(c)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#25D366] hover:bg-[#E8FFF3] disabled:cursor-not-allowed"
                          >
                            {chatLoadingCase === c.case_no
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#25D366] border-t-transparent animate-spin" />
                              : <MessageSquareIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-[#697386]">Chat</span>
                          </button>
                          <button
                            title={c.internet_bill_url ? "Download Internet Bill" : "Generate Internet Bill"}
                            aria-label={c.internet_bill_url ? `Download internet bill for ${c.case_no}` : `Generate internet bill for ${c.case_no}`}
                            disabled={generatingCell === `${c.case_no}:internet`}
                            onClick={() => handleGenerateSingle(c.case_no, "internet")}
                            className={`w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors disabled:cursor-not-allowed ${c.internet_bill_url ? "text-[#635BFF] hover:bg-[#F0EEFF]" : "text-[#9CA3AF] hover:text-[#635BFF] hover:bg-[#F0EEFF]"}`}
                          >
                            {generatingCell === `${c.case_no}:internet`
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#635BFF] border-t-transparent animate-spin" />
                              : <InternetBillIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-[#697386]">Internet</span>
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
                            <span className="text-[10px] leading-none font-medium text-[#697386]">Utility</span>
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
                            <span className="text-[10px] leading-none font-medium text-[#697386]">TA</span>
                          </button>
                          <button
                            title="Generate Auth Letter"
                            aria-label={`Generate auth letter for ${c.case_no}`}
                            disabled={letterCase === c.case_no}
                            onClick={() => handleAuthorizationLetter(c.case_no)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#0E9384] hover:bg-[#E6FAF7] disabled:cursor-not-allowed"
                          >
                            {letterCase === c.case_no
                              ? <span className="w-3.5 h-3.5 my-[1px] rounded-full border-2 border-[#0E9384] border-t-transparent animate-spin" />
                              : <AuthLetterIcon className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium text-[#697386]">Auth Letter</span>
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
                            <span className="text-[10px] leading-none font-medium text-[#697386]">TIME</span>
                          </button>
                          <button
                            title="Combine this case's documents into one PDF"
                            aria-label={`Combine documents for ${c.case_no} into one PDF`}
                            onClick={() => setMergeCase(c)}
                            className="w-14 flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors text-[#0A2540] hover:bg-[#EEF0FF] hover:text-[#635BFF]"
                          >
                            <MergeIcon className="w-4 h-4" />
                            <span className="text-[10px] leading-none font-medium text-[#697386]">Combine</span>
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-[#E3E8EF] bg-[#F6F9FC]">
            <span className="text-xs text-[#697386]">Showing{" "}<span className="font-medium text-[#0A2540] tabular-nums">{showingFrom}–{showingTo}</span>{" "}of <span className="font-medium text-[#0A2540] tabular-nums">{count}</span> cases</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-8 px-2 sm:px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]">Prev</Button>
              <span className="hidden sm:contents">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) pageNum = i;
                else if (page < 3) pageNum = i;
                else if (page > totalPages - 4) pageNum = totalPages - 5 + i;
                else pageNum = page - 2 + i;
                return (
                  <Button key={pageNum} variant={pageNum === page ? "default" : "outline"} size="sm" className={`h-8 w-8 p-0 text-xs rounded-md tabular-nums ${pageNum === page ? "bg-[#635BFF] text-white border-[#635BFF]" : "border-[#E3E8EF] text-[#425466]"}`} onClick={() => setPage(pageNum)}>{pageNum + 1}</Button>
                );
              })}
              </span>
              <span className="sm:hidden text-xs text-[#697386] tabular-nums px-2">{page + 1}/{totalPages || 1}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="h-8 px-2 sm:px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]">Next</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-in detail panel */}
      {selectedCase && createPortal(
        <CaseDetailPanel caseData={selectedCase} onClose={() => setSelectedCase(null)} cacheBuster={billCacheBuster} onGenerateChat={handleGenerateChat} chatLoading={chatLoadingCase === selectedCase.case_no} onGenerateLetter={handleAuthorizationLetter} letterLoading={letterCase === selectedCase.case_no} onCombine={setMergeCase} />,
        document.body
      )}

      {/* Chat image generator modal */}
      {chatCase && (
        <ChatImageGenerator caseData={chatCase} onClose={() => setChatCase(null)} />
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

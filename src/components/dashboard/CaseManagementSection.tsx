"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  type CaseRow, type SortState, PAGE_SIZE, COLUMNS,
  formatDateTime, getStatusStyle,
} from "./shared";
import {
  SearchIcon, EmptyIcon, CloseIcon, ExternalLinkIcon, SortIcon,
  InternetBillIcon, UtilityBillIcon, DownloadIcon, CheckCircleIcon,
  MessageSquareIcon,
} from "./icons";
import ChatImageGenerator from "./ChatImageGenerator";

// ── Case Detail Panel ──

function CaseDetailPanel({ caseData, onClose, cacheBuster, onGenerateChat }: { caseData: CaseRow; onClose: () => void; cacheBuster: number; onGenerateChat: (c: CaseRow) => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)); }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") handleClose(); }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function handleClose() { setIsVisible(false); setTimeout(onClose, 300); }
  function handleBackdropClick(e: React.MouseEvent) { if (e.target === e.currentTarget) handleClose(); }

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
    <div className={`fixed inset-0 z-50 transition-colors duration-300 ${isVisible ? "bg-black/20" : "bg-transparent"}`} onClick={handleBackdropClick}>
      <div ref={panelRef} className="absolute top-0 right-0 h-full w-full sm:max-w-md bg-white shadow-2xl flex flex-col max-h-screen" style={{ transform: isVisible ? "translateX(0)" : "translateX(100%)", transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E8EF]" style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(-8px)", transition: "opacity 400ms ease-out 150ms, transform 400ms ease-out 150ms" }}>
          <div>
            <h2 className="text-lg font-semibold text-[#0A2540]">Case Details</h2>
            <p className="text-xs text-[#697386] mt-0.5 font-mono tabular-nums">{caseData.case_no}</p>
          </div>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F6F9FC] text-[#697386] hover:text-[#0A2540] transition-colors duration-200">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sections.map((section, sectionIndex) => {
            const visibleFields = section.fields.filter((f) => f.value);
            if (visibleFields.length === 0) return null;
            const delay = 200 + sectionIndex * 80;
            return (
              <div key={section.title}>
                {sectionIndex > 0 && (<div className="border-t border-[#E3E8EF] my-5" style={{ opacity: isVisible ? 1 : 0, transition: `opacity 500ms ease-out ${delay}ms` }} />)}
                <div style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(12px)", transition: `opacity 400ms ease-out ${delay}ms, transform 400ms ease-out ${delay}ms` }}>
                  <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">{section.title}</h3>
                  <div className="space-y-3">
                    {visibleFields.map((field, fieldIndex) => (
                      <div key={field.label} style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(8px)", transition: `opacity 350ms ease-out ${delay + 40 + fieldIndex * 40}ms, transform 350ms ease-out ${delay + 40 + fieldIndex * 40}ms` }}>
                        <dt className="text-xs text-[#697386] mb-0.5">{field.label}</dt>
                        <dd className="text-sm text-[#0A2540]">
                          {field.isStatus ? (<span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(field.value ?? null)}`}>{field.value}</span>) : (<span className="break-words">{field.value}</span>)}
                        </dd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Internet Bill Preview */}
          <div className="border-t border-[#E3E8EF] my-5" style={{ opacity: isVisible ? 1 : 0, transition: "opacity 500ms ease-out 600ms" }} />
          <div style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(12px)", transition: "opacity 400ms ease-out 650ms, transform 400ms ease-out 650ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Internet Bill</h3>
            {caseData.internet_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#E3E8EF] overflow-hidden bg-[#F6F9FC]">
                  <iframe src={`/api/bills/download?case_no=${caseData.case_no}&type=internet&t=${cacheBuster}`} className="w-full h-[400px]" title="Internet Bill Preview" />
                </div>
                <a href={`/api/bills/download?case_no=${caseData.case_no}&type=internet&t=${cacheBuster}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download Internet Bill
                </a>
              </div>
            ) : (
              <p className="text-sm text-[#697386]">No bill generated yet. Select this case and click &ldquo;Generate Internet Bill&rdquo;.</p>
            )}
          </div>

          {/* Utility Bill Preview */}
          <div className="border-t border-[#E3E8EF] my-5" style={{ opacity: isVisible ? 1 : 0, transition: "opacity 500ms ease-out 700ms" }} />
          <div style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(12px)", transition: "opacity 400ms ease-out 750ms, transform 400ms ease-out 750ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Utility Bill</h3>
            {caseData.utility_bill_url ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#E3E8EF] overflow-hidden bg-[#F6F9FC]">
                  <iframe src={`/api/bills/download?case_no=${caseData.case_no}&type=utility&t=${cacheBuster}`} className="w-full h-[400px]" title="Utility Bill Preview" />
                </div>
                <a href={`/api/bills/download?case_no=${caseData.case_no}&type=utility&t=${cacheBuster}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#FF6B35] hover:text-[#0A2540] transition-colors duration-200">
                  <DownloadIcon className="w-3.5 h-3.5" />Download Utility Bill
                </a>
              </div>
            ) : (
              <p className="text-sm text-[#697386]">No bill generated yet. Select this case and click &ldquo;Generate Utility Bill&rdquo;.</p>
            )}
          </div>

          {/* Generate Chat */}
          <div className="border-t border-[#E3E8EF] my-5" style={{ opacity: isVisible ? 1 : 0, transition: "opacity 500ms ease-out 800ms" }} />
          <div style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(12px)", transition: "opacity 400ms ease-out 850ms, transform 400ms ease-out 850ms" }}>
            <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">Closing Script</h3>
            <button
              onClick={() => onGenerateChat(caseData)}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#25D366] hover:text-[#1DA851] transition-colors duration-200"
            >
              <MessageSquareIcon className="w-3.5 h-3.5" />Generate Chat Image
            </button>
          </div>
        </div>
        {caseData.case_url && (
          <div className="px-6 py-4 border-t border-[#E3E8EF]" style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(8px)", transition: "opacity 400ms ease-out 700ms, transform 400ms ease-out 700ms" }}>
            <a href={caseData.case_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200">
              Open in WifiBizz
              <ExternalLinkIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Case Management Section ──

export default function CaseManagementSection() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Activated");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
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
  const [chatCase, setChatCase] = useState<CaseRow | null>(null);
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
            <div className="flex-1 min-w-0 sm:min-w-[220px] max-w-sm relative group">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#697386] transition-colors group-focus-within:text-[#635BFF]" />
              <Input placeholder="Search name, case no, mobile, provider..." defaultValue="" onChange={(e) => handleSearchChange(e.target.value)} className="pl-9 h-9 bg-[#F6F9FC] border-[#E3E8EF] rounded-lg text-sm text-[#0A2540] placeholder:text-[#697386] focus:bg-white focus:border-[#635BFF] transition-all" />
            </div>
            <select className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
              <option value="">All Statuses</option>
              {(statuses.includes("Activated") ? statuses : ["Activated", ...statuses]).map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium hidden sm:inline">From</label>
              <input type="date" aria-label="From date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-2 sm:px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none max-w-[150px]" value={dateFrom} onChange={(e) => { setPage(0); setDateFrom(e.target.value); }} />
              <label className="text-xs text-[#697386] whitespace-nowrap font-medium hidden sm:inline">To</label>
              <input type="date" aria-label="To date" className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-2 sm:px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none max-w-[150px]" value={dateTo} onChange={(e) => { setPage(0); setDateTo(e.target.value); }} />
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
                  <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-20 text-center"><div className="flex flex-col items-center gap-2"><div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-2"><EmptyIcon className="w-5 h-5 text-[#697386]" /></div><p className="text-sm font-medium text-[#0A2540]">No cases found</p><p className="text-xs text-[#697386]">{hasFilters ? "Try adjusting your filters" : "Run a crawl to get started"}</p></div></td></tr>
                ) : (
                  cases.map((c) => (
                    <tr key={c.case_no} className={`hover:bg-[#F6F9FC] transition-colors duration-100 cursor-pointer ${selectedCase?.case_no === c.case_no ? "bg-[#F6F9FC]" : ""} ${selectedCases.has(c.case_no) ? "bg-[#F0EEFF]" : ""}`} onClick={() => setSelectedCase(c)}>
                      <td className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select case ${c.case_no}`} className="rounded border-[#E3E8EF] text-[#635BFF] focus:ring-[#635BFF]/20 cursor-pointer" checked={selectedCases.has(c.case_no)} onChange={() => toggleCaseSelection(c.case_no)} />
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular-nums whitespace-nowrap">
                        {c.case_url ? (<a href={c.case_url} target="_blank" rel="noopener noreferrer" className="text-[#635BFF] font-medium hover:underline transition-colors" onClick={(e) => e.stopPropagation()}>{c.case_no}</a>) : (<span className="font-medium text-[#425466]">{c.case_no}</span>)}
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap hidden lg:table-cell"><span className="block truncate max-w-[140px] text-[#425466]">{c.order_no || "—"}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(c.status)}`}>{c.status ?? "Unknown"}</span></td>
                      <td className="px-4 py-3"><span className="block truncate max-w-[160px] text-[13px] font-medium text-[#0A2540]">{c.full_name || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[180px] text-[13px] text-[#697386]">{c.full_address || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#425466] tabular-nums whitespace-nowrap">{c.mobile || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[140px] text-[13px] text-[#425466]">{c.provider || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[160px] text-[13px] text-[#425466]">{c.package || "—"}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="block truncate max-w-[160px] text-[13px] text-[#697386]">{c.agent_remark || "—"}</span></td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap">{formatDateTime(c.case_created_at)}</td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap hidden lg:table-cell">{formatDateTime(c.updated_at)}</td>
                      <td className="px-3 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 border-l border-[#E3E8EF] pl-2">
                          <button
                            title="Generate Chat"
                            aria-label={`Generate closing script chat for ${c.case_no}`}
                            onClick={() => setChatCase(c)}
                            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-[#25D366] hover:bg-[#E8FFF3]"
                          >
                            <MessageSquareIcon className="w-4 h-4" />
                          </button>
                          <button
                            title={c.internet_bill_url ? "Download Internet Bill" : "Internet bill not generated"}
                            aria-label={c.internet_bill_url ? `Download internet bill for ${c.case_no}` : `Internet bill not generated for ${c.case_no}`}
                            disabled={!c.internet_bill_url}
                            onClick={() => c.internet_bill_url && window.open(`/api/bills/download?case_no=${c.case_no}&type=internet&t=${billCacheBuster}`, "_blank")}
                            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${c.internet_bill_url ? "text-[#635BFF] hover:bg-[#F0EEFF]" : "text-[#D1D5DB] opacity-40 cursor-not-allowed"}`}
                          >
                            <InternetBillIcon className="w-4 h-4" />
                          </button>
                          <button
                            title={c.utility_bill_url ? "Download Utility Bill" : "Utility bill not generated"}
                            aria-label={c.utility_bill_url ? `Download utility bill for ${c.case_no}` : `Utility bill not generated for ${c.case_no}`}
                            disabled={!c.utility_bill_url}
                            onClick={() => c.utility_bill_url && window.open(`/api/bills/download?case_no=${c.case_no}&type=utility&t=${billCacheBuster}`, "_blank")}
                            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${c.utility_bill_url ? "text-[#FF6B35] hover:bg-[#FFF0EB]" : "text-[#D1D5DB] opacity-40 cursor-not-allowed"}`}
                          >
                            <UtilityBillIcon className="w-4 h-4" />
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
        <CaseDetailPanel caseData={selectedCase} onClose={() => setSelectedCase(null)} cacheBuster={billCacheBuster} onGenerateChat={(c) => setChatCase(c)} />,
        document.body
      )}

      {/* Chat image generator modal */}
      {chatCase && (
        <ChatImageGenerator caseData={chatCase} onClose={() => setChatCase(null)} />
      )}
    </>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";

interface CaseRow {
  case_no: string;
  case_url: string | null;
  full_name: string | null;
  full_address: string | null;
  mobile: string | null;
  email: string | null;
  id_no: string | null;
  provider: string | null;
  package: string | null;
  order_no: string | null;
  agent: string | null;
  agent_remark: string | null;
  status: string | null;
  case_created_at: string | null;
  updated_at: string | null;
}

type SortDir = "asc" | "desc";

interface SortState {
  column: string;
  dir: SortDir;
}

const PAGE_SIZE = 10;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_STYLES: Record<string, string> = {
  Activated: "bg-emerald-50 text-[#09825D] ring-emerald-600/10",
  Processed: "bg-blue-50 text-blue-700 ring-blue-600/10",
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/10",
  Rejected: "bg-red-50 text-[#DF1B41] ring-red-600/10",
  Cancelled: "bg-gray-50 text-[#697386] ring-gray-500/10",
};

function getStatusStyle(status: string | null): string {
  if (!status) return "bg-gray-50 text-[#697386] ring-gray-400/10";
  return STATUS_STYLES[status] ?? "bg-violet-50 text-violet-700 ring-violet-600/10";
}

const COLUMNS: { key: string; label: string; hideOnMobile?: boolean }[] = [
  { key: "case_no", label: "Case No." },
  { key: "order_no", label: "Order ID", hideOnMobile: true },
  { key: "status", label: "Status" },
  { key: "full_name", label: "Full Name" },
  { key: "full_address", label: "Full Address", hideOnMobile: true },
  { key: "mobile", label: "Mobile" },
  { key: "provider", label: "Provider", hideOnMobile: true },
  { key: "package", label: "Package", hideOnMobile: true },
  { key: "agent_remark", label: "Agent Remark", hideOnMobile: true },
  { key: "case_created_at", label: "Created At" },
  { key: "updated_at", label: "Updated At", hideOnMobile: true },
];

export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortState>({
    column: "case_created_at",
    dir: "desc",
  });
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCases = useCallback(async () => {
    setLoading(true);
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
    setLoading(false);
  }, [page, search, status, dateFrom, dateTo, sort]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      setSearch(value);
    }, 300);
  }

  function handleSort(column: string) {
    setSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === "desc" ? "asc" : "desc",
    }));
    setPage(0);
  }

  const totalPages = Math.ceil(count / PAGE_SIZE);
  const showingFrom = count === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, count);
  const hasFilters = search || status || dateFrom || dateTo;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Case List</h1>
        <p className="text-sm text-[#697386] mt-1">
          {count} case{count !== 1 ? "s" : ""} in total
        </p>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-4 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] max-w-sm relative group">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#697386] transition-colors group-focus-within:text-[#635BFF]" />
            <Input
              placeholder="Search name, case no, mobile, provider..."
              defaultValue=""
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-9 bg-[#F6F9FC] border-[#E3E8EF] rounded-lg text-sm text-[#0A2540] placeholder:text-[#697386] focus:bg-white focus:border-[#635BFF] transition-all"
            />
          </div>

          <select
            className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none"
            value={status}
            onChange={(e) => {
              setPage(0);
              setStatus(e.target.value);
            }}
          >
            <option value="">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[#697386] whitespace-nowrap font-medium">
              From
            </label>
            <input
              type="date"
              className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none"
              value={dateFrom}
              onChange={(e) => {
                setPage(0);
                setDateFrom(e.target.value);
              }}
            />
            <label className="text-xs text-[#697386] whitespace-nowrap font-medium">
              To
            </label>
            <input
              type="date"
              className="h-9 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#425466] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20 transition-all outline-none"
              value={dateTo}
              onChange={(e) => {
                setPage(0);
                setDateTo(e.target.value);
              }}
            />
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs rounded-lg text-[#DF1B41] hover:bg-red-50 hover:text-[#DF1B41] transition-colors"
              onClick={() => {
                setSearch("");
                setStatus("");
                setDateFrom("");
                setDateTo("");
                setPage(0);
              }}
            >
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden animate-fade-in-up" style={{ animationDelay: "300ms" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E3E8EF]">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left text-[11px] font-semibold text-[#697386] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-[#0A2540] transition-colors ${col.hideOnMobile ? "hidden lg:table-cell" : ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <SortIcon column={col.key} sort={sort} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E8EF]/60">
              {loading ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
                      <span className="text-sm text-[#697386]">Loading cases...</span>
                    </div>
                  </td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-20 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-2">
                        <EmptyIcon className="w-5 h-5 text-[#697386]" />
                      </div>
                      <p className="text-sm font-medium text-[#0A2540]">No cases found</p>
                      <p className="text-xs text-[#697386]">
                        {hasFilters ? "Try adjusting your filters" : "Run a crawl to get started"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                    <tr
                      key={c.case_no}
                      className={`hover:bg-[#F6F9FC] transition-colors duration-100 cursor-pointer ${selectedCase?.case_no === c.case_no ? "bg-[#F6F9FC]" : ""}`}
                      onClick={() => setSelectedCase(c)}
                    >
                      <td className="px-4 py-3 text-[13px] tabular-nums whitespace-nowrap">
                        {c.case_url ? (
                          <a
                            href={c.case_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#635BFF] font-medium hover:underline transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.case_no}
                          </a>
                        ) : (
                          <span className="font-medium text-[#425466]">{c.case_no}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap hidden lg:table-cell">
                        <span className="block truncate max-w-[140px] text-[#425466]">{c.order_no || "—"}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(c.status)}`}>
                          {c.status ?? "Unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block truncate max-w-[160px] text-[13px] font-medium text-[#0A2540]">
                          {c.full_name || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="block truncate max-w-[180px] text-[13px] text-[#697386]">
                          {c.full_address || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#425466] tabular-nums whitespace-nowrap">
                        {c.mobile || "—"}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="block truncate max-w-[140px] text-[13px] text-[#425466]">{c.provider || "—"}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="block truncate max-w-[160px] text-[13px] text-[#425466]">{c.package || "—"}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="block truncate max-w-[160px] text-[13px] text-[#697386]">
                          {c.agent_remark || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap">
                        {formatDateTime(c.case_created_at)}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#697386] tabular-nums whitespace-nowrap hidden lg:table-cell">
                        {formatDateTime(c.updated_at)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E3E8EF] bg-[#F6F9FC]">
          <span className="text-xs text-[#697386]">
            Showing{" "}
            <span className="font-medium text-[#0A2540] tabular-nums">
              {showingFrom}–{showingTo}
            </span>{" "}
            of <span className="font-medium text-[#0A2540] tabular-nums">{count}</span> cases
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="h-8 px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]"
            >
              Previous
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 5 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={pageNum === page ? "default" : "outline"}
                  size="sm"
                  className={`h-8 w-8 p-0 text-xs rounded-md tabular-nums ${pageNum === page ? "bg-[#635BFF] text-white border-[#635BFF]" : "border-[#E3E8EF] text-[#425466]"}`}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum + 1}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 px-3 text-xs rounded-md border-[#E3E8EF] text-[#425466]"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Slide-in detail panel */}
      {selectedCase && createPortal(
        <CaseDetailPanel caseData={selectedCase} onClose={() => setSelectedCase(null)} />,
        document.body
      )}
    </div>
  );
}

function CaseDetailPanel({ caseData, onClose }: { caseData: CaseRow; onClose: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function handleClose() {
    setIsVisible(false);
    setTimeout(onClose, 300);
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleClose();
  }

  const sections = [
    {
      title: "Case Information",
      fields: [
        { label: "Case No.", value: caseData.case_no },
        { label: "Order ID", value: caseData.order_no },
        { label: "Status", value: caseData.status, isStatus: true },
      ],
    },
    {
      title: "Customer Details",
      fields: [
        { label: "Full Name", value: caseData.full_name },
        { label: "Full Address", value: caseData.full_address },
        { label: "Mobile", value: caseData.mobile },
        { label: "Email", value: caseData.email },
        { label: "ID No.", value: caseData.id_no },
      ],
    },
    {
      title: "Service",
      fields: [
        { label: "Provider", value: caseData.provider },
        { label: "Package", value: caseData.package },
      ],
    },
    {
      title: "Agent",
      fields: [
        { label: "Agent", value: caseData.agent },
        { label: "Agent Remark", value: caseData.agent_remark },
      ],
    },
    {
      title: "Timestamps",
      fields: [
        { label: "Created At", value: formatDateTime(caseData.case_created_at) },
        { label: "Updated At", value: formatDateTime(caseData.updated_at) },
      ],
    },
  ];

  return (
    <div
      className={`fixed inset-0 z-50 transition-colors duration-300 ${isVisible ? "bg-black/20" : "bg-transparent"}`}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={`absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col`}
        style={{
          transform: isVisible ? "translateX(0)" : "translateX(100%)",
          transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-[#E3E8EF]"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 400ms ease-out 150ms, transform 400ms ease-out 150ms",
          }}
        >
          <div>
            <h2 className="text-lg font-semibold text-[#0A2540]">Case Details</h2>
            <p className="text-xs text-[#697386] mt-0.5 font-mono tabular-nums">{caseData.case_no}</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F6F9FC] text-[#697386] hover:text-[#0A2540] transition-colors duration-200"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {sections.map((section, sectionIndex) => {
            const visibleFields = section.fields.filter((f) => f.value);
            if (visibleFields.length === 0) return null;
            const delay = 200 + sectionIndex * 80;
            return (
              <div key={section.title}>
                {sectionIndex > 0 && (
                  <div
                    className="border-t border-[#E3E8EF] my-5"
                    style={{
                      opacity: isVisible ? 1 : 0,
                      transition: `opacity 500ms ease-out ${delay}ms`,
                    }}
                  />
                )}
                <div
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? "translateY(0)" : "translateY(12px)",
                    transition: `opacity 400ms ease-out ${delay}ms, transform 400ms ease-out ${delay}ms`,
                  }}
                >
                  <h3 className="text-[11px] font-semibold text-[#697386] uppercase tracking-wider mb-3">
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {visibleFields.map((field, fieldIndex) => (
                      <div
                        key={field.label}
                        style={{
                          opacity: isVisible ? 1 : 0,
                          transform: isVisible ? "translateY(0)" : "translateY(8px)",
                          transition: `opacity 350ms ease-out ${delay + 40 + fieldIndex * 40}ms, transform 350ms ease-out ${delay + 40 + fieldIndex * 40}ms`,
                        }}
                      >
                        <dt className="text-xs text-[#697386] mb-0.5">{field.label}</dt>
                        <dd className="text-sm text-[#0A2540]">
                          {field.isStatus ? (
                            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${getStatusStyle(field.value ?? null)}`}>
                              {field.value}
                            </span>
                          ) : (
                            <span className="break-words">{field.value}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {caseData.case_url && (
          <div
            className="px-6 py-4 border-t border-[#E3E8EF]"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 400ms ease-out 600ms, transform 400ms ease-out 600ms",
            }}
          >
            <a
              href={caseData.case_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors duration-200"
            >
              Open in WifiBizz
              <ExternalLinkIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function SortIcon({ column, sort }: { column: string; sort: SortState }) {
  if (sort.column !== column) {
    return <span className="text-[#E3E8EF] text-[10px]">&#8597;</span>;
  }
  return (
    <span className="text-[#635BFF] text-[10px]">
      {sort.dir === "asc" ? "\u25B2" : "\u25BC"}
    </span>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function EmptyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v4" />
      <path d="M12 18h.01" />
    </svg>
  );
}

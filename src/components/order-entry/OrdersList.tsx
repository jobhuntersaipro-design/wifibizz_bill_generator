"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { listOrders, submitOrder, deleteOrder } from "@/actions/order";
import type { OrderListItem } from "@/lib/order-types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[#E3E8EF] text-[#425466]",
  submitting: "bg-amber-100 text-amber-700",
  order_entered: "bg-green-100 text-green-700",
  submitted: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitting: "Submitting",
  order_entered: "Order Entered",
  submitted: "Submitted",
  warning: "Warning",
  failed: "Failed",
};

const STATUS_FILTERS = ["all", "draft", "order_entered", "warning", "failed", "submitted"];

export function OrdersList({ onEdit }: { onEdit: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Fetch on mount — setState happens in the async callback (not synchronously
  // in the effect body), so it doesn't cause a cascading render.
  useEffect(() => {
    let active = true;
    listOrders().then((res) => {
      if (!active) return;
      if (res.success) setOrders(res.data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    const res = await listOrders();
    if (res.success) setOrders(res.data);
  }

  async function handleSubmit(id: string, name: string) {
    setBusyId(id);
    // Optimistically reflect the in-progress state while the portal runs.
    setOrders((o) => o.map((x) => (x.id === id ? { ...x, status: "submitting" } : x)));
    const res = await submitOrder(id);
    setBusyId(null);
    // Toasts show the customer name as the title with the detail below it.
    if (res.success) {
      if (res.warning) toast.warning(name, { description: res.warning });
      else if (res.orderId) toast.success(name, { description: `Order No. ${res.orderId}` });
      else toast.success(name, { description: res.message ?? "Order entered." });
    } else {
      toast.error(name, { description: res.error ?? "Submit failed" });
    }
    reload();
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const res = await deleteOrder(id);
    setBusyId(null);
    if (res.success) {
      setOrders((o) => o.filter((x) => x.id !== id));
      toast.success("Draft deleted.");
    } else {
      toast.error("Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-12 flex flex-col items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
        <p className="text-sm text-[#697386]">Loading orders…</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-dashed border-[#E3E8EF] p-10 text-center">
        <p className="text-sm font-medium text-[#425466]">No orders yet</p>
        <p className="text-xs text-[#697386] mt-1">Fill in the New Order tab to create a draft.</p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (o.fullName ?? "").toLowerCase().includes(q) ||
      (o.idNumber ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      {/* Search + status filter */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or ID number here"
            className="w-full h-10 rounded-lg border border-[#E3E8EF] bg-white pl-9 pr-3 text-sm text-[#0A2540] hover:border-[#635BFF]/60 focus:border-[#635BFF] focus:outline-none transition-colors"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#697386]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select-chevron h-10 rounded-lg border border-[#CBD2DC] bg-white pl-3 pr-9 text-sm text-[#0A2540] hover:border-[#635BFF] focus:border-[#635BFF] focus:outline-none cursor-pointer transition-colors"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E3E8EF] bg-[#F6F9FC] text-left text-[11px] uppercase tracking-wide text-[#697386]">
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Package</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Order No.</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#697386]">
                  No orders match your search.
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-[#E3E8EF] last:border-0 hover:bg-[#F6F9FC]/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-[#0A2540]">{o.fullName}</div>
                  <div className="text-[11px] text-[#697386] tabular-nums">{o.idType} · {o.idNumber}</div>
                </td>
                <td className="px-4 py-3 text-[#425466] max-w-55">{o.offerName ?? "—"}</td>
                <td className="px-4 py-3 text-[#425466]">{[o.city, o.state].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-3 align-top">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[o.status] ?? STATUS_STYLES.draft}`}>
                    {o.status === "submitting" && (
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent inline-block" />
                    )}
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                  {(o.status === "failed" || o.status === "warning") && o.errorMessage && (
                    <div
                      className={`text-[10px] mt-1 max-w-60 leading-snug ${o.status === "warning" ? "text-amber-700" : "text-red-600"}`}
                    >
                      {o.errorMessage}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-[#0A2540]">{o.orderId ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {o.status !== "submitted" && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => onEdit(o.id)}
                        className="rounded-md border border-[#E3E8EF] px-3 py-1.5 text-[12px] font-medium text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] disabled:opacity-50 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {(o.status === "draft" || o.status === "failed" || o.status === "warning") && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleSubmit(o.id, o.fullName)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0A2540] disabled:opacity-50 transition-colors"
                      >
                        {busyId === o.id ? (
                          <>
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                            Submitting…
                          </>
                        ) : (
                          "Submit"
                        )}
                      </button>
                    )}
                    {o.status !== "submitted" && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleDelete(o.id)}
                        className="rounded-md border border-[#E3E8EF] px-3 py-1.5 text-[12px] text-[#DF1B41] hover:border-[#DF1B41] disabled:opacity-50 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}

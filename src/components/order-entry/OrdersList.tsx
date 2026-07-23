"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { listOrders, submitOrder, deleteOrder } from "@/actions/order";
import type { OrderListItem } from "@/lib/order-types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[#E3E8EF] text-[#425466]",
  submitting: "bg-amber-100 text-amber-700",
  submitted: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export function OrdersList() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function handleSubmit(id: string) {
    setBusyId(id);
    const res = await submitOrder(id);
    setBusyId(null);
    if (res.success) {
      toast.success("Order submitted.");
      reload();
    } else {
      toast.error(res.error ?? "Submit failed");
    }
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

  return (
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
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-[#E3E8EF] last:border-0 hover:bg-[#F6F9FC]/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-[#0A2540]">{o.fullName}</div>
                  <div className="text-[11px] text-[#697386] tabular-nums">{o.idType} · {o.idNumber}</div>
                </td>
                <td className="px-4 py-3 text-[#425466] max-w-55">{o.offerName ?? "—"}</td>
                <td className="px-4 py-3 text-[#425466]">{[o.city, o.state].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[o.status] ?? STATUS_STYLES.draft}`}>
                    {o.status}
                  </span>
                  {o.status === "failed" && o.errorMessage && (
                    <div className="text-[10px] text-red-600 mt-0.5 max-w-40 truncate" title={o.errorMessage}>{o.errorMessage}</div>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-[#0A2540]">{o.orderId ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {(o.status === "draft" || o.status === "failed") && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleSubmit(o.id)}
                        className="rounded-md bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0A2540] disabled:opacity-50 transition-colors"
                      >
                        {busyId === o.id ? "…" : "Submit"}
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
  );
}

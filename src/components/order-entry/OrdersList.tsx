"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { toast } from "sonner";
import { listOrders, startSubmit, deleteOrder } from "@/actions/order";
import {
  needsVoiding,
  type OrderListItem,
  type StageDetails,
} from "@/lib/order-types";
import { SubmitProgress } from "./SubmitProgress";
import { OrderHistoryPanel } from "./OrderHistoryPanel";

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

// A draft is submittable (and so batch-selectable) in these states.
// Submittable until we actually have a portal order id — a customer profile may
// be "entered" without the order id yet, so it must stay re-submittable. Only an
// in-flight ("submitting") row or one that already has an order id is locked.
const canSubmit = (o: { status: string; orderId?: string | null }) =>
  !o.orderId && o.status !== "submitting";

// The full installation address. Prefer the portal's own concatAddress when the
// address was confirmed against Unifi — that string is the record of truth —
// and otherwise rebuild it from the fields the agent typed.
function formatAddress(o: OrderListItem): string {
  if (o.addressFull?.trim()) return o.addressFull.trim();
  return [o.street, [o.postcode, o.city].filter(Boolean).join(" "), o.state]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
}

// "Verified" means the portal returned a unit for this address and we kept its
// resourceInstId — not merely that the agent typed something well-formed.
const isVerified = (o: OrderListItem) => !!o.addressId?.trim();

// One poll's view of an in-flight submit, as returned by the progress route.
interface ProgressState {
  status: string;
  stage: string | null;
  orderId: string | null;
  errorMessage: string | null;
  done: boolean;
  details?: StageDetails;
  screenshotKey?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A row shows its step checklist while it runs, and keeps it after a failure so
// the agent can see which step stopped it.
const hasProgress = (o: OrderListItem) =>
  o.status === "submitting" || ((o.status === "failed" || o.status === "warning") && !!o.stage);

export function OrdersList({ onEdit }: { onEdit: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the list itself couldn't be fetched — shown instead of an empty
  // table, so a server-side failure never masquerades as "no drafts".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // Rows whose submit checklist is open. Opens itself when a submit starts.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // What the portal resolved per step, per order, for the live checklist. Kept
  // out of `orders` because it belongs to the RUN, not the draft: a refetched
  // list has no details, and merging them in would blank the checklist mid-run.
  const [stageDetails, setStageDetails] = useState<Record<string, StageDetails>>({});
  // The order whose full status history panel is open, if any.
  const [historyId, setHistoryId] = useState<string | null>(null);
  // Superadmins see everyone's drafts + a "Made By" column.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Fetch on mount — setState happens in the async callback (not synchronously
  // in the effect body), so it doesn't cause a cascading render.
  //
  // The catch is load-bearing, not defensive habit: a rejected server action
  // skips .then entirely, so without it `loading` stays true and the user waits
  // on a spinner forever with the real error invisible in the console.
  useEffect(() => {
    let active = true;
    listOrders()
      .then((res) => {
        if (!active) return;
        if (res.success) {
          setOrders(res.data);
          setIsSuperAdmin(!!res.isSuperAdmin);
        } else {
          setLoadError(res.error ?? "Couldn't load drafts.");
        }
      })
      .catch((e) => {
        if (!active) return;
        console.error("[OrdersList] listOrders failed:", e);
        setLoadError("Couldn't load drafts. Reload the page — if it keeps failing, the server is erroring.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    try {
      const res = await listOrders();
      if (res.success) {
        setOrders(res.data);
        setIsSuperAdmin(!!res.isSuperAdmin);
        setLoadError(null);
      }
    } catch (e) {
      console.error("[OrdersList] reload failed:", e);
      toast.error("Couldn't refresh the drafts list.");
      // Also record it, so a failed "Try again" shows the error state again
      // rather than silently falling through to "No orders yet".
      setLoadError("Couldn't load drafts. Reload the page — if it keeps failing, the server is erroring.");
    }
  }

  // Ids this tab is already following, so two loops never poll the same order.
  const followingRef = useRef<Set<string>>(new Set());

  // Follow one in-flight submit to completion, writing each stage into the row
  // as it arrives. The server does the finalizing, so abandoning this loop (a
  // closed tab, a navigation) can't strand the order — the next listOrders
  // reconciles it.
  async function followProgress(id: string): Promise<ProgressState | null> {
    // Generous: the full portal flow can run ~10 minutes at 2s per poll.
    for (let i = 0; i < 400; i++) {
      await sleep(2000);
      let state: ProgressState;
      try {
        const res = await fetch(`/api/orders/${id}/progress`, { cache: "no-store" });
        if (!res.ok) continue; // transient — the run is still the server's to finish
        state = (await res.json()) as ProgressState;
      } catch {
        continue;
      }
      setOrders((o) =>
        o.map((x) =>
          x.id === id
            ? {
                ...x,
                status: state.status,
                stage: state.stage,
                orderId: state.orderId,
                errorMessage: state.errorMessage,
                screenshotUrl: state.screenshotKey ?? x.screenshotUrl,
              }
            : x,
        ),
      );
      // Merge rather than replace: a poll that raced a stage still holds the
      // earlier steps' values, and dropping them would make resolved lines
      // flicker away mid-run.
      if (state.details) {
        setStageDetails((d) => ({ ...d, [id]: { ...d[id], ...state.details } }));
      }
      if (state.done) return state;
    }
    return null;
  }

  // Pick up any order that is mid-flight but unfollowed here — one started in
  // another tab, or one still running when this page was opened. Without this,
  // such a row would sit on "Submitting" until a manual refresh.
  const submittingIds = orders
    .filter((o) => o.status === "submitting")
    .map((o) => o.id)
    .join(",");
  useEffect(() => {
    for (const id of submittingIds ? submittingIds.split(",") : []) {
      if (followingRef.current.has(id)) continue;
      followingRef.current.add(id);
      // set-state-in-effect can't see that followProgress awaits a 2s sleep
      // before it ever calls setOrders — nothing here renders synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void followProgress(id).finally(() => followingRef.current.delete(id));
    }
    // Keyed on the id list only: followProgress closes over setOrders alone, so
    // re-running on every render would just churn.
  }, [submittingIds]);

  // Core submit for one order. Returns true on success (used by both the per-row
  // button and the batch runner). Toasts show the customer name + detail.
  async function runSubmit(id: string, name: string): Promise<boolean> {
    // Claim it BEFORE the row flips to "submitting" — otherwise the pick-up
    // effect sees an unfollowed in-flight row and starts a second poll loop.
    followingRef.current.add(id);
    setOrders((o) =>
      o.map((x) =>
        x.id === id
          ? { ...x, status: "submitting", stage: "creating_customer", errorMessage: null }
          : x,
      ),
    );
    setExpanded((prev) => new Set(prev).add(id));

    const res = await startSubmit(id);
    if (!res.success) {
      followingRef.current.delete(id);
      // The preflight already wrote the failure (and its stage) to the row.
      setOrders((o) =>
        o.map((x) =>
          x.id === id ? { ...x, status: "failed", errorMessage: res.error ?? null } : x,
        ),
      );
      toast.error(name, { description: res.error ?? "Submit failed" });
      return false;
    }

    const final = await followProgress(id).finally(() =>
      followingRef.current.delete(id),
    );
    if (!final) {
      toast.message(name, {
        description: "Still running — it will finish on its own; reopen the list to check.",
      });
      return false;
    }
    if (final.status === "submitted") {
      toast.success(name, {
        description: final.orderId ? `Order No. ${final.orderId}` : "Submitted.",
      });
      return true;
    }
    if (final.status === "warning") {
      toast.warning(name, { description: final.errorMessage ?? "Needs checking in the portal." });
      return false;
    }
    if (final.status === "order_entered") {
      toast.success(name, { description: "Customer profile created." });
      return true;
    }
    toast.error(name, { description: final.errorMessage ?? "Submit failed" });
    return false;
  }

  async function handleSubmit(id: string, name: string) {
    setBusyId(id);
    await runSubmit(id, name);
    setBusyId(null);
    reload();
  }

  // Batch: submit the selected drafts ONE AT A TIME. A single dealer session
  // can't safely run concurrent order flows, so we process sequentially and
  // stop early if the session dies.
  async function handleSubmitSelected() {
    const targets = filtered.filter((o) => selected.has(o.id) && canSubmit(o));
    if (targets.length === 0) return;
    if (!window.confirm(`Submit ${targets.length} order${targets.length === 1 ? "" : "s"} one by one?`)) {
      return;
    }
    setBatchRunning(true);
    let ok = 0;
    for (const o of targets) {
      setBusyId(o.id);
      const success = await runSubmit(o.id, o.fullName);
      if (success) ok += 1;
    }
    setBusyId(null);
    setBatchRunning(false);
    setSelected(new Set());
    toast.message(`Batch complete: ${ok}/${targets.length} submitted.`);
    reload();
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
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

  // Checked BEFORE the empty state: a failed fetch also leaves `orders` empty,
  // and "No orders yet" would be a lie that hides a broken server.
  if (loadError) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-10 text-center">
        <p className="text-sm font-medium text-red-700">Couldn&apos;t load drafts</p>
        <p className="text-xs text-[#697386] mt-1 max-w-md mx-auto leading-snug">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setLoadError(null);
            reload().finally(() => setLoading(false));
          }}
          className="mt-4 rounded-md bg-[#635BFF] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#0A2540] transition-colors"
        >
          Try again
        </button>
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

  // Read live from `orders` so the panel updates as the run progresses.
  const historyOrder = orders.find((o) => o.id === historyId) ?? null;

  const q = query.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (o.fullName ?? "").toLowerCase().includes(q) ||
      (o.idNumber ?? "").toLowerCase().includes(q)
    );
  });

  // Batch selection is scoped to the currently-filtered, submittable rows.
  const selectableIds = filtered.filter((o) => canSubmit(o)).map((o) => o.id);
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;

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

      {/* Bulk action bar — appears once submittable drafts are selected. */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#635BFF]/30 bg-[#635BFF]/5 px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#0A2540]">
            {selectedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={batchRunning}
              className="rounded-md border border-[#E3E8EF] bg-white px-3 py-1.5 text-[12px] text-[#425466] hover:border-[#635BFF] disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleSubmitSelected}
              disabled={batchRunning}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0A2540] disabled:opacity-50 transition-colors"
            >
              {batchRunning ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                  Submitting…
                </>
              ) : (
                `Submit Selected (${selectedCount})`
              )}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E3E8EF] bg-[#F6F9FC] text-left text-[11px] uppercase tracking-wide text-[#697386]">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all submittable drafts"
                  checked={allSelected}
                  disabled={selectableIds.length === 0 || batchRunning}
                  onChange={(e) => toggleAll(selectableIds, e.target.checked)}
                  className="h-4 w-4 rounded border-[#CBD2DC] accent-[#635BFF] cursor-pointer disabled:opacity-40"
                />
              </th>
              <th className="px-4 py-3 font-medium">Ref</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              {isSuperAdmin && <th className="px-4 py-3 font-medium">Made By</th>}
              <th className="px-4 py-3 font-medium">Package &amp; device</th>
              <th className="px-4 py-3 font-medium">Installation Address</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Order No.</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isSuperAdmin ? 9 : 8} className="px-4 py-8 text-center text-sm text-[#697386]">
                  No orders match your search.
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <Fragment key={o.id}>
              <tr className={`border-b border-[#E3E8EF] last:border-0 hover:bg-[#F6F9FC]/60 ${expanded.has(o.id) && o.status === "submitting" ? "border-b-0" : ""}`}>
                <td className="px-4 py-3 align-middle">
                  {canSubmit(o) ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${o.fullName}`}
                      checked={selected.has(o.id)}
                      disabled={batchRunning}
                      onChange={() => toggleOne(o.id)}
                      className="h-4 w-4 rounded border-[#CBD2DC] accent-[#635BFF] cursor-pointer disabled:opacity-40"
                    />
                  ) : null}
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className="text-[11px] font-medium text-[#635BFF] tabular-nums whitespace-nowrap">
                    {o.reference ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="font-medium text-[#0A2540]">{o.fullName}</div>
                  <div className="text-[11px] text-[#697386] tabular-nums">{o.idType} · {o.idNumber}</div>
                </td>
                {isSuperAdmin && (
                  <td className="px-4 py-3 align-middle text-[#425466] text-[12px]">{o.createdByEmail ?? "—"}</td>
                )}
                <td className="px-4 py-3 align-top text-[#425466] max-w-64">
                  <div className="leading-snug">{o.offerName ?? "—"}</div>
                  {o.deviceName && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-[#697386]">
                      <svg className="mt-0.5 h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                      <span className="leading-snug break-words">{o.deviceName}</span>
                    </div>
                  )}
                  {o.remarks?.trim() && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-[#8792A2]" title={o.remarks}>
                      <svg className="mt-0.5 h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="leading-snug break-words line-clamp-2">{o.remarks}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-[#425466]">
                  {(() => {
                    const address = formatAddress(o);
                    if (!address) return <span className="text-[#697386]">—</span>;
                    return (
                      <div className="max-w-72 min-w-45">
                        <div className="leading-snug break-words" title={address}>
                          {address}
                        </div>
                        {isVerified(o) && (
                          <span
                            className="badge-verified mt-1.5 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 ring-1 ring-green-600/20"
                            title="This address was matched against the Unifi dealer portal"
                          >
                            <svg
                              className="h-3 w-3 shrink-0"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                            Verified on Unifi
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium text-center whitespace-nowrap ${STATUS_STYLES[o.status] ?? STATUS_STYLES.draft}`}>
                    {o.status === "submitting" && (
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent inline-block" />
                    )}
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                  {needsVoiding(o) && (
                    <span
                      className="mt-1 block text-[10px] font-medium text-amber-700"
                      title="This order exists in the portal but never completed — void it there"
                    >
                      Needs voiding
                    </span>
                  )}
                  {/* One link to the full picture, rather than a checklist
                      squeezed into a table cell. */}
                  {(hasProgress(o) || o.attempt > 0) && (
                    <button
                      type="button"
                      onClick={() => setHistoryId(o.id)}
                      className="mt-1 block text-[10px] font-medium text-[#635BFF] hover:underline cursor-pointer"
                    >
                      View status{o.attempt > 1 ? ` (${o.attempt} attempts)` : ""}
                    </button>
                  )}
                  {/* When the checklist is open it already carries the message,
                      so don't print it twice. */}
                  {(o.status === "failed" || o.status === "warning") &&
                    o.errorMessage &&
                    !(expanded.has(o.id) && hasProgress(o)) && (
                      <div
                        className={`text-[10px] mt-1 max-w-60 leading-snug ${o.status === "warning" ? "text-amber-700" : "text-red-600"}`}
                      >
                        {o.errorMessage}
                      </div>
                    )}
                </td>
                <td className="px-4 py-3 align-middle tabular-nums text-[#0A2540]">
                  {o.orderId ? (
                    <a
                      href={`https://dealer.unifi.com.my/esales/h5/onBoarding/OrderDetails?custOrderId=${o.orderId}&custOrderNbr=${o.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#635BFF] hover:underline"
                      title="Open the order on the dealer portal (may take a moment to appear after creation)"
                    >
                      {o.orderId}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
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
                    {canSubmit(o) && (
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
              {expanded.has(o.id) && o.status === "submitting" && (
                <tr className="border-b border-[#E3E8EF] last:border-0">
                  <td colSpan={isSuperAdmin ? 9 : 8} className="p-0">
                    <SubmitProgress
                      stage={o.stage}
                      status={o.status}
                      errorMessage={o.errorMessage}
                      orderId={o.orderId}
                      details={stageDetails[o.id]}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {historyOrder && (
        <>
          {/* Above the sidebar's z-50 — at z-30 the scrim only dimmed the table
              area and the nav stayed live next to an open dialog. */}
          <div
            className="fixed inset-0 z-[60] bg-[#0A2540]/20 animate-fade-in"
            onClick={() => setHistoryId(null)}
            aria-hidden="true"
          />
          <OrderHistoryPanel order={historyOrder} onClose={() => setHistoryId(null)} />
        </>
      )}
    </div>
  );
}

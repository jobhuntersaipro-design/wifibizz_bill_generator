"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  listOrders,
  startSubmit,
  deleteOrder,
  cancelOrder,
  startBatchSubmit,
  pollBatch,
  activeBatch,
} from "@/actions/order";
import { getNotificationSettings } from "@/actions/settings";
import {
  EMPTY_FILTERS,
  canCancel,
  canResubmit,
  canSubmit,
  filterOptions,
  filterOrders,
  submitErrorCopy,
  type OrderFilters,
  type OrderListItem,
  type StageDetails,
} from "@/lib/order-types";
import { OrderHistoryPanel } from "./OrderHistoryPanel";
import type { RowActions } from "./OrderRow";
import { OrdersTable } from "./OrdersTable";
import { OrdersToolbar } from "./OrdersToolbar";
import LottieSpot from "./LottieSpot";
import { ResubmitDialog } from "./ResubmitDialog";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { DeleteOrderDialog } from "./DeleteOrderDialog";
import { BatchSubmitDialog } from "./BatchSubmitDialog";

/** One poll's view of an in-flight submit, as returned by the progress route. */
interface ProgressState {
  status: string;
  stage: string | null;
  orderId: string | null;
  errorMessage: string | null;
  errorCode?: string | null;
  done: boolean;
  details?: StageDetails;
  screenshotKey?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function OrdersList({ onEdit }: { onEdit: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the list itself couldn't be fetched — shown instead of an empty
  // table, so a server-side failure never masquerades as "no drafts".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Search + the four filter dropdowns, as one value. One object rather than
  // five useStates so `filterOrders` takes exactly what the toolbar edits, and
  // adding a filter later cannot forget to wire itself into the predicate.
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // Set when the confirmation dialog is open, holding the ids it will submit —
  // captured at open time so a filter change behind the dialog can't silently
  // change what "Start batch" submits.
  const [batchConfirmIds, setBatchConfirmIds] = useState<string[] | null>(null);
  // Where a summary email would go. Shown in the dialog so the promise it makes
  // is checkable before the agent walks away from the tab.
  const [notifyTo, setNotifyTo] = useState<string | null>(null);
  // Rows whose submit checklist is open. Opens itself when a submit starts.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // What the portal resolved per step, per order, for the live checklist. Kept
  // out of `orders` because it belongs to the RUN, not the draft: a refetched
  // list has no details, and merging them in would blank the checklist mid-run.
  const [stageDetails, setStageDetails] = useState<Record<string, StageDetails>>({});
  // The order whose full status history panel is open, if any.
  const [historyId, setHistoryId] = useState<string | null>(null);
  // The order awaiting a resubmit confirmation, if any.
  const [resubmitId, setResubmitId] = useState<string | null>(null);
  // …and the one awaiting a delete confirmation. Delete is irreversible and,
  // for a row the portal has numbered, destroys the only local record of a real
  // order — so it asks first, every time.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
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
          setLoadError(res.error ?? "Couldn't load orders.");
        }
      })
      .catch((e) => {
        if (!active) return;
        console.error("[OrdersList] listOrders failed:", e);
        setLoadError("Couldn't load orders. Reload the page — if it keeps failing, the server is erroring.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Rejoin a batch that is already running, and learn where its summary goes.
  //
  // The batch outlives the tab by design, so a page opened (or reopened) while
  // one is in flight must pick the progress display back up — otherwise the
  // rows sit on "Submitting" with no indication anything is still happening.
  useEffect(() => {
    let active = true;
    getNotificationSettings()
      .then((res) => {
        if (!active || !res.success || !res.data) return;
        const to = res.data.notificationEmail || res.data.loginEmail;
        // No point promising an email the environment cannot send.
        setNotifyTo(res.data.configured ? to || null : null);
      })
      .catch(() => {});
    activeBatch()
      .then((res) => {
        if (!active || !res.success || !res.batchRunId) return;
        void followBatch(res.batchRunId);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // Mount only: followBatch closes over setState alone, and re-running this
    // would start a second poll loop against the same batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.error("Couldn't refresh the orders list.");
      // Also record it, so a failed "Try again" shows the error state again
      // rather than silently falling through to "No orders yet".
      setLoadError("Couldn't load orders. Reload the page — if it keeps failing, the server is erroring.");
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
                errorCode: state.errorCode ?? null,
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
    // Held back during a batch. Every member sits in `submitting` from the
    // moment the batch starts, so following them all would mean one poll loop
    // per order — a ten-order batch would put ~5 requests a second on a 1GB
    // droplet that is mid-submit, and the progress display would become the
    // thing that wedges the run it is reporting on. followBatch follows the one
    // member that is actually running instead.
    if (batchRunning) return;
    for (const id of submittingIds ? submittingIds.split(",") : []) {
      if (followingRef.current.has(id)) continue;
      followingRef.current.add(id);
      // Nothing here renders synchronously: followProgress awaits a 2s sleep
      // before it ever calls setOrders.
      void followProgress(id).finally(() => followingRef.current.delete(id));
    }
    // Keyed on the id list only: followProgress closes over setOrders alone, so
    // re-running on every render would just churn.
  }, [submittingIds, batchRunning]);

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
      // A classified failure leads with what to DO. The toast is the only part of
      // this an agent mid-batch reliably reads, so the remedy goes in it rather
      // than only in the panel they would have to open.
      const copy = submitErrorCopy(final.errorCode);
      toast.warning(copy ? `${name} — ${copy.title}` : name, {
        description: copy ? copy.fix : final.errorMessage ?? "Needs checking in the portal.",
      });
      return false;
    }
    if (final.status === "order_entered") {
      toast.success(name, { description: "Customer profile created." });
      return true;
    }
    const failCopy = submitErrorCopy(final.errorCode);
    toast.error(failCopy ? `${name} — ${failCopy.title}` : name, {
      description: failCopy ? failCopy.fix : final.errorMessage ?? "Submit failed",
    });
    return false;
  }

  async function handleSubmit(id: string, name: string) {
    setBusyId(id);
    await runSubmit(id, name);
    setBusyId(null);
    reload();
  }

  // ── Batch submit ───────────────────────────────────────────────────────────
  // The loop used to live HERE: this component called startSubmit for each
  // selected draft and polled each job to completion. A closed tab or a dropped
  // connection mid-batch left every remaining order unsubmitted with nobody
  // told, and rows ran in filtered display order rather than by age.
  //
  // Now the whole selection goes to the droplet in one call and the loop runs
  // there. What is left here is a progress poll — pure display, which the batch
  // does not depend on. Abandoning it costs the live view, not the run.

  /** Follow a server-side batch until it reports finished. Display only. */
  async function followBatch(id: string) {
    setBatchRunning(true);
    // ~40 minutes at 3s. A ten-order batch of full portal runs is genuinely
    // long; running out here stops the polling, never the batch.
    for (let i = 0; i < 800; i++) {
      await sleep(3000);
      let res: Awaited<ReturnType<typeof pollBatch>>;
      try {
        res = await pollBatch(id);
      } catch {
        continue; // transient — the run is the droplet's to finish
      }
      if (!res.success) break;
      // Push each member's latest state into its row. The per-order checklist
      // keeps working on its own, through the same progress route as a single
      // submit — batch members carry a real job id from the moment they start.
      setOrders((list) =>
        list.map((x) => {
          const r = res.success ? res.results.find((o) => o.orderId === x.id) : undefined;
          return r
            ? {
                ...x,
                status: r.status,
                orderId: r.portalOrderNo,
                errorMessage: r.errorMessage,
                errorCode: r.errorCode,
              }
            : x;
        }),
      );
      setBusyId(res.currentOrderId);
      // Follow only the member the droplet is actually running, so the
      // step-by-step checklist still fills in without one poll loop per order.
      // `followingRef` keeps this to a single loop per member across the batch.
      const running = res.currentOrderId;
      if (running && !followingRef.current.has(running)) {
        followingRef.current.add(running);
        void followProgress(running).finally(() => followingRef.current.delete(running));
      }
      if (res.status === "finished") {
        const ok = res.results.filter((r) => r.status === "submitted").length;
        if (res.errorMessage) toast.error("Batch stopped", { description: res.errorMessage });
        else toast.message(`Batch finished: ${ok}/${res.total} submitted.`);
        break;
      }
    }
    setBusyId(null);
    setBatchRunning(false);
    reload();
  }

  /**
   * Hand the selection to the droplet.
   *
   * Only `canSubmit` rows are ever selectable, and `startBatchSubmit` filters
   * again server-side — a stranded order needs its own confirmation naming its
   * portal order number, one at a time, because a second run against an
   * un-voided order creates a real duplicate.
   */
  async function handleStartBatch(ids: string[]) {
    setBatchRunning(true);
    const res = await startBatchSubmit(ids);
    if (!res.success) {
      setBatchRunning(false);
      toast.error("Couldn't start the batch", { description: res.error });
      reload();
      return;
    }
    setSelected(new Set());
    // Open every member's checklist: the batch runs unattended, so the one thing
    // a watching agent wants is to see which step each order reached.
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    toast.message(`Batch started: ${res.count} order${res.count === 1 ? "" : "s"}.`);
    await followBatch(res.batchRunId);
  }

  function handleSubmitSelected() {
    const targets = filtered.filter((o) => selected.has(o.id) && canSubmit(o));
    if (targets.length === 0) return;
    setBatchConfirmIds(targets.map((o) => o.id));
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

  async function handleCancelOrder(id: string) {
    setBusyId(id);
    const res = await cancelOrder(id);
    setBusyId(null);
    if (res.success) {
      setOrders((list) =>
        list.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x)),
      );
      toast.success("Order marked Cancelled. Remember to void it on the Unifi portal.");
    } else {
      toast.error(res.error ?? "Cancel failed");
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const res = await deleteOrder(id);
    setBusyId(null);
    if (res.success) {
      setOrders((o) => o.filter((x) => x.id !== id));
      toast.success("Order deleted.");
    } else {
      toast.error("Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[#E3E8EF] bg-white p-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
        <p className="text-sm text-[#697386]">Loading orders…</p>
      </div>
    );
  }

  // Checked BEFORE the empty state: a failed fetch also leaves `orders` empty,
  // and "No orders yet" would be a lie that hides a broken server.
  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-red-700">Couldn&apos;t load orders</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-snug text-[#697386]">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setLoadError(null);
            reload().finally(() => setLoading(false));
          }}
          className="mt-4 cursor-pointer rounded-lg bg-[#635BFF] px-4 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-[#E3E8EF] bg-white p-10 text-center">
        <LottieSpot name="empty-orders" size={110} className="mb-2" fallback={null} />
        <p className="text-sm font-medium text-[#425466]">No orders yet</p>
        <p className="mt-1 text-xs text-[#697386]">Fill in the New Order tab to create one.</p>
      </div>
    );
  }

  // Read live from `orders` so the panel updates as the run progresses.
  const historyOrder = orders.find((o) => o.id === historyId) ?? null;
  // Re-read the same way: a row that finished mid-dialog must not be resubmitted
  // against a stale snapshot of itself.
  const resubmitOrder = orders.find((o) => o.id === resubmitId) ?? null;
  const deleteOrderRow = orders.find((o) => o.id === deleteId) ?? null;
  const cancelOrderRow = orders.find((o) => o.id === cancelId) ?? null;

  const filtered = filterOrders(orders, filters);
  // Options come from ALL loaded rows, not the filtered ones — deriving them
  // from `filtered` would make each choice erase the others, so picking a
  // package would empty the device list and strand the user.
  const { offers, devices } = filterOptions(orders);

  // Batch selection is scoped to the currently-filtered, submittable rows.
  const selectableIds = filtered.filter((o) => canSubmit(o)).map((o) => o.id);
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;

  const actionsFor = (o: OrderListItem): RowActions => ({
    busy: busyId === o.id,
    batchRunning,
    selected: selected.has(o.id),
    onToggleSelect: () => toggleOne(o.id),
    onSubmit: () => handleSubmit(o.id, o.fullName),
    onResubmit: () => setResubmitId(o.id),
    onEdit: () => onEdit(o.id),
    onCancelOrder: () => setCancelId(o.id),
    onDelete: () => setDeleteId(o.id),
    onShowHistory: () => setHistoryId(o.id),
  });

  return (
    <div className="space-y-3">
      <OrdersToolbar
        filters={filters}
        onChange={setFilters}
        offers={offers}
        devices={devices}
        selectedCount={selectedCount}
        batchRunning={batchRunning}
        onClearSelection={() => setSelected(new Set())}
        onSubmitSelected={handleSubmitSelected}
      />

      <OrdersTable
        orders={filtered}
        isSuperAdmin={isSuperAdmin}
        selectableIds={selectableIds}
        allSelected={allSelected}
        someSelected={selectedCount > 0}
        batchRunning={batchRunning}
        expanded={expanded}
        stageDetails={stageDetails}
        actionsFor={actionsFor}
        onToggleAll={toggleAll}
      />

      {/* No scrim here any more: the Sheet portals its own backdrop above
          everything, which is also what closes on outside-click and Escape. */}
      {historyOrder && (
        <OrderHistoryPanel order={historyOrder} onClose={() => setHistoryId(null)} />
      )}

      {/* Re-checked at confirm time, not just at open time: the row may have
          been picked up by another tab's poll while the dialog sat open. */}
      {deleteOrderRow && (
        <DeleteOrderDialog
          order={deleteOrderRow}
          onCancel={() => setDeleteId(null)}
          onConfirm={() => {
            setDeleteId(null);
            handleDelete(deleteOrderRow.id);
          }}
        />
      )}

      {/* Re-checked at confirm time for the same reason as Delete — and gated
          on canCancel so a row that finished changing state while the dialog
          was open cannot be cancelled from a stale snapshot. */}
      {cancelOrderRow && canCancel(cancelOrderRow) && (
        <CancelOrderDialog
          order={cancelOrderRow}
          onCancel={() => setCancelId(null)}
          onConfirm={() => {
            setCancelId(null);
            handleCancelOrder(cancelOrderRow.id);
          }}
        />
      )}

      {batchConfirmIds && (
        <BatchSubmitDialog
          count={batchConfirmIds.length}
          recipient={notifyTo}
          onCancel={() => setBatchConfirmIds(null)}
          onConfirm={() => {
            const ids = batchConfirmIds;
            setBatchConfirmIds(null);
            handleStartBatch(ids);
          }}
        />
      )}

      {resubmitOrder && canResubmit(resubmitOrder) && (
        <ResubmitDialog
          order={resubmitOrder}
          onCancel={() => setResubmitId(null)}
          onConfirm={() => {
            setResubmitId(null);
            handleSubmit(resubmitOrder.id, resubmitOrder.fullName);
          }}
        />
      )}
    </div>
  );
}

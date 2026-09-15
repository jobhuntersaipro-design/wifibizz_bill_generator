"use client";

import { useState } from "react";
import { toast } from "sonner";
import { adminSubmitOrder, adminSubmitTargets, type SubmitTarget } from "@/actions/admin-submit";

const ELIGIBLE = new Set(["draft", "failed", "warning"]);
const STOP_BEFORE_PAY_HELP = "The run stops on the Pay screen. The portal will already hold an unpaid order number for this customer, which must be paid or voided by hand.";

/**
 * Submit this order under a chosen agent's dealer session and watch it run.
 *
 * The live tab is opened SYNCHRONOUSLY in the click handler and navigated
 * once the run has started — a tab opened after an await is what popup
 * blockers eat. If the start fails, the tab is closed again.
 */
export function SubmitAsAdminButton({ orderId, label, status, portalOrderNo }: {
  orderId: string; label: string; status: string; portalOrderNo: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<SubmitTarget[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [stopBeforePay, setStopBeforePay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  if (status === "submitted" || status === "cancelled") return null;

  async function openDialog() {
    setOpen(true); setError(null); setFallbackUrl(null);
    if (targets) return;
    const res = await adminSubmitTargets();
    if (!res.success) { toast.error(res.error ?? "Could not load accounts."); return; }
    setTargets(res.data);
    setTargetId(res.data.find((t) => t.connection.state === "connected" || t.connection.state === "expiring")?.id ?? "");
  }

  async function confirm() {
    setBusy(true); setError(null);
    const tab = window.open("", "_blank");
    const res = await adminSubmitOrder(orderId, targetId, { stopBeforePay });
    setBusy(false);
    if (!res.success) { tab?.close(); setError(res.error); return; }
    const url = `/admin/orders/${orderId}/live?job=${encodeURIComponent(res.jobId)}`;
    if (tab) { tab.location.href = url; setOpen(false); toast.success("Run started — watching it in the new tab."); }
    else setFallbackUrl(url);
  }

  const notEligible = !ELIGIBLE.has(status);
  const chosen = targets?.find((t) => t.id === targetId);
  const canConfirm = !busy && !!chosen && (chosen.connection.state === "connected" || chosen.connection.state === "expiring") && !notEligible;

  return (
    <>
      <button type="button" onClick={openDialog}
        className="min-h-9 rounded-md bg-[#635BFF] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#5851E0] focus-visible:outline-2 focus-visible:outline-[#635BFF]">
        Submit as…
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4"
          role="dialog" aria-modal="true" aria-labelledby="submit-admin-title"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="submit-admin-title" className="text-base font-semibold text-[#0A2540]">Submit {label} as an agent</h3>

            {notEligible ? (
              <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-sm text-[#B54708]">
                {status === "submitting" ? "A run is already in flight for this order." : `An order in status "${status}" cannot be submitted.`}
              </p>
            ) : fallbackUrl ? (
              <p className="mt-2 text-sm text-[#425466]">
                The run has started, but the browser blocked the new tab.{" "}
                <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-[#635BFF] underline">Open the live view</a>
              </p>
            ) : (
              <>
                <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                  This mints a <strong>real Unifi order</strong> under the chosen account&apos;s staff code.
                  {status === "warning" && portalOrderNo && (
                    <> The portal already holds order <span className="font-mono">{portalOrderNo}</span> for this customer — a second run creates a <strong>second</strong> order that will need voiding.</>
                  )}
                </p>
                <label className="mt-4 block text-xs text-[#697386]">
                  Submit under
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!targets}
                    className="mt-1 w-full rounded-md border border-[#E3E8EF] bg-white px-3 py-2 text-sm text-[#0A2540]">
                    {!targets && <option>Loading accounts…</option>}
                    {targets?.length === 0 && <option value="">No Order Entry accounts</option>}
                    {targets?.map((t) => (
                      <option key={t.id} value={t.id} disabled={t.connection.state === "expired" || t.connection.state === "never"}>
                        {t.email ?? t.name ?? t.id}{t.staffCode ? ` · ${t.staffCode}` : ""} — {t.connection.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm text-[#0A2540]">
                  <input type="checkbox" checked={stopBeforePay} onChange={(e) => setStopBeforePay(e.target.checked)} className="mt-1" />
                  <span>Stop before Pay<span className="block text-xs text-[#697386]">{STOP_BEFORE_PAY_HELP}</span></span>
                </label>
                <p className="mt-3 text-xs text-[#697386]">Automatic retry is switched off for this order from now on.</p>
                {error && <p className="mt-3 rounded-md bg-[#FEF3F2] px-3 py-2 text-sm text-[#B42318]">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Cancel</button>
                  <button type="button" onClick={confirm} disabled={!canConfirm}
                    className="rounded-md bg-[#635BFF] px-3 py-2 text-sm text-white disabled:opacity-50">
                    {busy ? "Starting…" : "Start and watch"}
                  </button>
                </div>
              </>
            )}
            {(notEligible || fallbackUrl) && (
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

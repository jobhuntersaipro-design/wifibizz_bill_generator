"use client";
import { Select } from "@/components/ui/select";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { adminCloneOrder, adminCloneTargets } from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface Target {
  id: string;
  email: string | null;
  name: string | null;
  isSuperAdmin: boolean;
}

type Done = { id: string; reference: string | null; targetEmail: string | null; copied: number; missing: string[] };

/**
 * Clone this order into an Order Entry account as a draft, to run its failure
 * again by hand. The dialog says what a run costs: most failures happen after
 * the portal mints a real order number.
 */
export function CloneOrderButton({ orderId, label }: { orderId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  async function openDialog() {
    setOpen(true);
    setDone(null);
    if (targets) return;
    const res = await adminCloneTargets();
    if (!res.success) { toast.error(res.error ?? "Could not load accounts."); return; }
    setTargets(res.data);
    setTargetId(res.data[0]?.id ?? "");
  }

  async function confirm() {
    setBusy(true);
    const res = await adminCloneOrder(orderId, targetId);
    setBusy(false);
    if (!res.success || !res.data) { toast.error(res.error ?? "Clone failed."); return; }
    setDone(res.data);
    toast.success(`${res.data.reference} created in ${res.data.targetEmail}.`);
  }

  return (
    <>
      <Button unstyled variant="outline" type="button" onClick={openDialog}
        className="min-h-9 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-wash focus-visible:outline-2 focus-visible:outline-brand">
        Clone &amp; retry
      </Button>

      {open && (
        <Modal label="Clone order" onClose={() => setOpen(false)} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="clone-order-title" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <h3 id="clone-order-title" className="text-base font-semibold text-ink">
              {done ? "Clone created" : `Clone ${label} to retry it`}
            </h3>

            {done ? (
              <>
                <p className="mt-2 text-sm text-ink-soft">
                  <strong>{done.reference}</strong> is a draft in <strong>{done.targetEmail}</strong> with{" "}
                  {done.copied} document{done.copied === 1 ? "" : "s"} copied. Sign in as that account and
                  submit it from Order Entry.
                </p>
                {done.missing.length > 0 && (
                  <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                    {done.missing.length} document{done.missing.length === 1 ? " was" : "s were"} no longer in
                    storage and {done.missing.length === 1 ? "was" : "were"} not copied: {done.missing.join(", ")}.
                    Attach {done.missing.length === 1 ? "it" : "them"} before submitting.
                  </p>
                )}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Button unstyled variant="outline" type="button" onClick={() => setOpen(false)}
                    className="rounded-md border border-line px-3 py-2 text-sm text-ink-soft">
                    Close
                  </Button>
                  <a href={`/dashboard/order-entry/new-order?draft=${done.id}`} target="_blank" rel="noreferrer"
                    className="rounded-md bg-brand px-3 py-2 text-sm text-white">
                    Open the draft
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-soft">
                  Creates a new <strong>draft</strong> with this order&apos;s customer, package and documents.
                  Nothing is submitted — you press Submit yourself, and that run is never retried automatically.
                </p>
                <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                  Most failures happen after the portal mints a Customer Order Number, so submitting the clone
                  will usually create a <strong>real Unifi order</strong> that needs voiding.
                </p>
                <label className="mt-4 block text-xs text-ink-muted">
                  Place the draft in
                  <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!targets}
                    className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink">
                    {!targets && <option>Loading accounts…</option>}
                    {targets?.length === 0 && <option value="">No Order Entry accounts</option>}
                    {targets?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.email ?? t.name ?? t.id}{t.isSuperAdmin ? " (superadmin)" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="mt-5 flex justify-end gap-2">
                  <Button unstyled variant="outline" type="button" onClick={() => setOpen(false)}
                    className="rounded-md border border-line px-3 py-2 text-sm text-ink-soft">
                    Cancel
                  </Button>
                  <Button unstyled variant="default" type="button" onClick={confirm} disabled={busy || !targetId}
                    className="rounded-md bg-brand px-3 py-2 text-sm text-white disabled:opacity-50">
                    {busy ? "Cloning…" : "Create draft"}
                  </Button>
                </div>
              </>
            )}
          </Modal>
      )}
    </>
  );
}

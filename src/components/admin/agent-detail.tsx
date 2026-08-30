"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { setOrderEntryAccess } from "@/actions/admin-users";
import { OrderOversight, ConnectionBadge } from "@/components/admin/order-oversight";
import type { ConnectionView } from "@/lib/agent-connection";

export interface AgentView {
  id: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  caseLimit: number;
  orderEntryEnabled: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  staffCode: string | null;
  registeredEmail: string | null;
  lastConnectedAt: string | null;
  connection: ConnectionView;
}

/**
 * One agent: who they are, whether they can submit, and everything they have done.
 *
 * The body is `OrderOversight` with the agent pinned — the live panel, the
 * charts and the orders table all narrow to this person. Reused rather than
 * rebuilt so the numbers here and on the main page cannot disagree.
 *
 * There is deliberately NO edit form: Users already has one, and a second copy
 * is how two forms drift. The one control here is order-entry access, because
 * that is the thing you change while looking at somebody's failures.
 */
export function AgentDetail({ agent }: { agent: AgentView }) {
  const [enabled, setEnabled] = useState(agent.orderEntryEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    const res = await setOrderEntryAccess(agent.id, next);
    setSaving(false);
    if (!res.success) {
      setEnabled(!next); // put it back rather than leave the switch lying
      toast.error(res.error ?? "Could not change access.");
    } else {
      toast.success(next ? "Order entry enabled." : "Order entry disabled.");
    }
  }

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-[#E3E8EF] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[#0A2540]">
              {agent.email ?? agent.name ?? agent.id}
            </h1>
            <p className="mt-0.5 text-sm text-[#697386]">
              {agent.name ?? "No name"}
              {agent.isSuperAdmin && (
                <span className="ml-2 rounded-full bg-[#EFF4FF] px-2 py-0.5 text-xs text-[#3538CD]">
                  Superadmin
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ConnectionBadge view={agent.connection} />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#425466]">
              <input type="checkbox" checked={enabled} disabled={saving} onChange={toggle}
                className="h-4 w-4 cursor-pointer accent-[#635BFF]" />
              Order entry access
            </label>
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Dealer staff code" value={agent.staffCode} />
          <Field label="OTP email" value={agent.registeredEmail} />
          <Field
            label="Last connected"
            value={agent.lastConnectedAt ? agent.lastConnectedAt.slice(0, 16).replace("T", " ") : null}
          />
          <Field label="Case limit" value={String(agent.caseLimit)} />
          <Field label="Account created" value={agent.createdAt.slice(0, 10)} />
          <Field label="Notes" value={agent.notes} />
        </dl>

        <p className="mt-4 text-xs text-[#697386]">
          Editing name, password, notes or case limit lives on{" "}
          <Link href="/admin" className="text-[#635BFF] hover:underline">Users</Link>.
        </p>
      </header>

      <OrderOversight agentId={agent.id} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-[#697386]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[#0A2540]">{value || "—"}</dd>
    </div>
  );
}

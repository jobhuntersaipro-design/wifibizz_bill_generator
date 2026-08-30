"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import {
  adminListOrders, adminOrderStats, adminRestoreOrder, adminPurgeOrder,
  type AdminOrderRow, type AdminStats,
} from "@/actions/admin-orders";
import { purgePhrase, UNCLASSIFIED } from "@/lib/admin-order-stats";

const DAY = 86400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Error codes are snake_case machine tokens; this is the only place they face a human. */
function prettyCode(code: string): string {
  if (code === UNCLASSIFIED) return "Unclassified";
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function OrderOversight() {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * DAY)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<AdminOrderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        adminOrderStats({ from: new Date(from).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() }),
        adminListOrders(),
      ]);
      if (!s.success) setError(s.error ?? "Could not load statistics.");
      else { setStats(s.data); setError(null); }
      if (o.success) setOrders(o.data);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => orders.filter((o) =>
      (!agentFilter || o.agentId === agentFilter) &&
      (!statusFilter || (statusFilter === "deleted" ? o.deletedAt : o.status === statusFilter))),
    [orders, agentFilter, statusFilter],
  );

  const agentOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) m.set(o.agentId, o.agentEmail ?? o.agentId);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const statusOptions = useMemo(
    () => [...new Set(orders.map((o) => o.status))].sort(),
    [orders],
  );

  async function restore(o: AdminOrderRow) {
    const res = await adminRestoreOrder(o.id);
    if (res.success) { toast.success(`${purgePhrase(o)} restored to the agent's list.`); void load(); }
    else toast.error(res.error ?? "Restore failed.");
  }

  return (
    <div className="space-y-5">
      <RangeBar from={from} to={to} onFrom={setFrom} onTo={setTo} loading={loading} />

      {error && (
        <p className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B42318]">
          {error}
        </p>
      )}

      <Totals stats={stats} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Orders submitted per day" subtitle="Successful submits, Malaysia time">
            <Trend trend={stats?.trend ?? []} />
          </Card>
        </div>
        <Card title="Why submits fail" subtitle="Every failed attempt in range">
          <Errors errors={stats?.errors ?? []} />
        </Card>
      </div>

      <Card title="By agent" subtitle="Usage and the error each agent hits most">
        <AgentTable agents={stats?.agents ?? []} />
      </Card>

      <Card
        title={`All orders · ${filtered.length}`}
        subtitle="Every agent, every status, deleted included"
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={agentFilter} onChange={setAgentFilter} label="All agents"
            options={agentOptions.map(([id, email]) => ({ value: id, label: email }))} />
          <Select value={statusFilter} onChange={setStatusFilter} label="All statuses"
            options={[...statusOptions.map((s) => ({ value: s, label: s })), { value: "deleted", label: "deleted" }]} />
        </div>
        <OrderTable rows={filtered} onRestore={restore} onPurge={setPurgeTarget} />
      </Card>

      {purgeTarget && (
        <PurgeDialog
          order={purgeTarget}
          onClose={() => setPurgeTarget(null)}
          onDone={() => { setPurgeTarget(null); void load(); }}
        />
      )}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function Card({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#E3E8EF] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#0A2540]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-[#697386]">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RangeBar({ from, to, onFrom, onTo, loading }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; loading: boolean;
}) {
  // `max`/`min` keep the range valid at the input rather than letting the server
  // silently clamp it — a range that quietly changes is worse than one refused.
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E3E8EF] bg-white p-4">
      <label className="text-xs text-[#697386]">
        From
        <input type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)}
          className="mt-1 block rounded-md border border-[#E3E8EF] px-2 py-1.5 text-sm text-[#0A2540]" />
      </label>
      <label className="text-xs text-[#697386]">
        To
        <input type="date" value={to} min={from} onChange={(e) => onTo(e.target.value)}
          className="mt-1 block rounded-md border border-[#E3E8EF] px-2 py-1.5 text-sm text-[#0A2540]" />
      </label>
      {[7, 30, 90].map((d) => (
        <button key={d} type="button"
          onClick={() => { onFrom(isoDay(new Date(Date.now() - (d - 1) * DAY))); onTo(isoDay(new Date())); }}
          className="rounded-md border border-[#E3E8EF] px-3 py-1.5 text-xs text-[#425466] transition-colors hover:border-[#635BFF]">
          {d}d
        </button>
      ))}
      {loading && <span className="text-xs text-[#697386]">Loading…</span>}
    </div>
  );
}

function Totals({ stats }: { stats: AdminStats | null }) {
  const t = stats?.totals;
  const tiles = [
    { label: "Submitted", value: t?.submitted ?? 0 },
    { label: "Failed attempts", value: t?.failedAttempts ?? 0 },
    { label: "Active agents", value: t?.agents ?? 0 },
    { label: "Deleted orders", value: t?.deleted ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.label} className="rounded-xl border border-[#E3E8EF] bg-white p-4">
          <p className="text-xs text-[#697386]">{x.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#0A2540]">{x.value}</p>
        </div>
      ))}
    </div>
  );
}

function Trend({ trend }: { trend: { day: string; count: number }[] }) {
  // An all-zero range is not the same as no data, and must not render as an
  // axis with invisible bars that reads like a broken chart.
  if (trend.length === 0 || trend.every((d) => d.count === 0)) {
    return <Empty>No orders were submitted in this range.</Empty>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E3E8EF" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#697386" }} axisLine={false} tickLine={false}
          tickFormatter={(d: string) => d.slice(5)} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#697386" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E3E8EF" }} />
        <Bar dataKey="count" fill="#635BFF" radius={[3, 3, 0, 0]} name="Submitted" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Errors({ errors }: { errors: { code: string; count: number }[] }) {
  if (errors.length === 0) return <Empty>No failed attempts in this range.</Empty>;
  const max = errors[0].count;
  return (
    <ul className="space-y-2">
      {errors.slice(0, 8).map((e) => (
        <li key={e.code}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-[#0A2540]" title={e.code}>{prettyCode(e.code)}</span>
            <span className="tabular-nums text-xs font-semibold text-[#0A2540]">{e.count}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#F6F9FC]">
            <div className="h-1.5 rounded-full bg-[#635BFF]" style={{ width: `${(e.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AgentTable({ agents }: { agents: AdminStats["agents"] }) {
  if (agents.length === 0) return <Empty>No agent activity in this range.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E3E8EF] text-left text-xs text-[#697386]">
            <th className="pb-2 pr-3 font-medium">Agent</th>
            <th className="pb-2 pr-3 text-right font-medium">Submitted</th>
            <th className="pb-2 pr-3 text-right font-medium">Failed attempts</th>
            <th className="pb-2 pr-3 text-right font-medium">Success rate</th>
            <th className="pb-2 font-medium">Most common error</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.userId} className="border-b border-[#F0F3F8] last:border-0">
              <td className="py-2.5 pr-3 text-[#0A2540]">{a.email}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">{a.submitted}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">{a.failedAttempts}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">
                {a.successRate === null ? "—" : `${Math.round(a.successRate * 100)}%`}
              </td>
              <td className="py-2.5 text-[#425466]">
                {a.topError ? `${prettyCode(a.topError.code)} · ${a.topError.count}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ rows, onRestore, onPurge }: {
  rows: AdminOrderRow[];
  onRestore: (o: AdminOrderRow) => void;
  onPurge: (o: AdminOrderRow) => void;
}) {
  if (rows.length === 0) return <Empty>No orders match these filters.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E3E8EF] text-left text-xs text-[#697386]">
            <th className="pb-2 pr-3 font-medium">Order</th>
            <th className="pb-2 pr-3 font-medium">Agent</th>
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium">Error</th>
            <th className="pb-2 pr-3 font-medium">Created</th>
            <th className="pb-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b border-[#F0F3F8] last:border-0">
              <td className="py-2.5 pr-3">
                <Link href={`/admin/orders/${o.id}`} className="text-[#635BFF] hover:underline">
                  {o.reference ?? o.fullName}
                </Link>
                {o.reference && <div className="text-xs text-[#697386]">{o.fullName}</div>}
              </td>
              <td className="py-2.5 pr-3 text-[#425466]">{o.agentEmail ?? "—"}</td>
              <td className="py-2.5 pr-3">
                <StatusPill status={o.status} deleted={!!o.deletedAt} />
              </td>
              <td className="max-w-[240px] py-2.5 pr-3 text-xs text-[#425466]">
                {o.errorCode ? prettyCode(o.errorCode) : o.errorMessage ? "Unclassified" : "—"}
              </td>
              <td className="py-2.5 pr-3 text-xs tabular-nums text-[#697386]">
                {new Date(o.createdAt).toISOString().slice(0, 10)}
              </td>
              <td className="py-2.5">
                {o.deletedAt ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onRestore(o)}
                      className="rounded-md border border-[#E3E8EF] px-2 py-1 text-xs text-[#425466] hover:border-[#635BFF]">
                      Restore
                    </button>
                    <button type="button" onClick={() => onPurge(o)}
                      className="rounded-md border border-[#FCA5A5] px-2 py-1 text-xs text-[#B42318] hover:bg-[#FEF2F2]">
                      Purge
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[#B4BCCA]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status, deleted }: { status: string; deleted: boolean }) {
  // Deleted wins over the status: an admin scanning this column needs to know
  // the row is gone from the agent's world before anything else about it.
  if (deleted) {
    return <span className="rounded-full bg-[#F1F3F6] px-2 py-0.5 text-xs text-[#697386]">Deleted</span>;
  }
  const tone =
    status === "submitted" ? "bg-[#ECFDF3] text-[#027A48]"
    : status === "failed" ? "bg-[#FEF3F2] text-[#B42318]"
    : status === "warning" ? "bg-[#FFFAEB] text-[#B54708]"
    : status === "submitting" ? "bg-[#EFF4FF] text-[#3538CD]"
    : "bg-[#F1F3F6] text-[#697386]";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{status}</span>;
}

function Select({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[#E3E8EF] px-2 py-1.5 text-xs text-[#425466]">
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-[#697386]">{children}</p>;
}

function PurgeDialog({ order, onClose, onDone }: {
  order: AdminOrderRow; onClose: () => void; onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const phrase = purgePhrase(order);

  async function confirm() {
    setBusy(true);
    const res = await adminPurgeOrder(order.id, typed);
    setBusy(false);
    if (res.success) { toast.success(`${phrase} purged permanently.`); onDone(); }
    else toast.error(res.error ?? "Purge failed.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-[#0A2540]">Purge this order permanently?</h3>
        <p className="mt-2 text-sm text-[#425466]">
          This destroys the order <strong>and its entire submit history</strong>. It cannot be undone,
          and nothing else in the app keeps a copy.
        </p>
        {order.orderId && (
          <p className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
            This order reached the Unifi portal as <strong>{order.orderId}</strong>. Purging removes our
            record of it — the order still exists at Unifi.
          </p>
        )}
        <label className="mt-4 block text-xs text-[#697386]">
          Type <strong className="text-[#0A2540]">{phrase}</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
            className="mt-1 w-full rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#0A2540]" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy}
            className="rounded-md bg-[#B42318] px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Purging…" : "Purge permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

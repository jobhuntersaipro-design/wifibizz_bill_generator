"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import {
  adminListOrders, adminOrderStats, adminRestoreOrder, adminPurgeOrder,
  adminLiveJobs, adminReleaseJob, adminBulkPurgePreview, adminBulkPurge,
  type AdminOrderRow, type AdminStats, type LiveJob,
} from "@/actions/admin-orders";
import { purgePhrase, bucketLabel, orderErrorLabel, type Granularity } from "@/lib/admin-order-stats";
import { errorShortLabel } from "@/lib/order-types";
import { matchesOrderSearch, toCsv } from "@/lib/admin-search";
import { formatDuration } from "@/lib/order-types";
import LottieSpot from "@/components/order-entry/LottieSpot";
import { useAnimatedCounter } from "@/components/dashboard/shared";
import { useFlashOnChange } from "@/lib/use-flash";
import type { ConnectionView } from "@/lib/agent-connection";

const DAY = 86400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Error codes are snake_case machine tokens; this is the only place they face a human. */
function prettyCode(code: string): string {
  // Shared with the agent-facing status line, so one code cannot read
  // "Blacklisted IC" on one table and "Blacklisted ic" on the other.
  return errorShortLabel(code) ?? code;
}

export function OrderOversight({ agentId: pinnedAgent }: { agentId?: string } = {}) {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * DAY)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // When an agent is pinned (the agent detail page) the selector is gone and
  // this is fixed — one page, one subject.
  const [agentFilter, setAgentFilter] = useState(pinnedAgent ?? "");
  // null = follow the range's own default; a value pins it.
  const [granularity, setGranularity] = useState<Granularity | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<AdminOrderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        adminOrderStats({
          from: new Date(from).toISOString(),
          to: new Date(`${to}T23:59:59`).toISOString(),
          // The chart filter narrows the STATISTICS as well as the table, so
          // the tiles, the trend and the errors all describe the same agent.
          agentId: agentFilter || undefined,
          granularity: granularity ?? undefined,
        }),
        // Filtered server-side when an agent is pinned, rather than fetching
        // every order and dropping most of them on the client.
        adminListOrders(pinnedAgent ? { agentId: pinnedAgent } : undefined),
      ]);
      if (!s.success) setError(s.error ?? "Could not load statistics.");
      else { setStats(s.data); setError(null); }
      if (o.success) setOrders(o.data);
    } finally {
      setLoading(false);
    }
  }, [from, to, agentFilter, granularity, pinnedAgent]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => orders.filter((o) =>
      (!agentFilter || o.agentId === agentFilter) &&
      (!statusFilter || (statusFilter === "deleted" ? o.deletedAt : o.status === statusFilter)) &&
      matchesOrderSearch(o, search)),
    [orders, agentFilter, statusFilter, search],
  );

  const agentOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) m.set(o.agentId, o.agentEmail ?? o.agentId);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  // Derived from the orders CURRENTLY IN VIEW, not from every order: with an
  // agent selected, offering a status that agent has none of gives an option
  // that always yields an empty table, which reads as a broken filter.
  const statusOptions = useMemo(
    () => [...new Set(
      orders.filter((o) => !agentFilter || o.agentId === agentFilter).map((o) => o.status),
    )].sort(),
    [orders, agentFilter],
  );

  function exportCsv() {
    // Exactly the FILTERED rows: an export that ignores the filters exports
    // something the screen never showed.
    const csv = toCsv(
      ["reference", "name", "ic", "agent", "status", "error_code", "portal_order", "package", "created", "deleted_at"],
      filtered.map((o) => [
        o.reference, o.fullName, o.idNumber, o.agentEmail, o.status, o.errorCode,
        o.orderId, o.offerName, o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        o.deletedAt ? (o.deletedAt instanceof Date ? o.deletedAt.toISOString() : String(o.deletedAt)) : null,
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restore(o: AdminOrderRow) {
    const res = await adminRestoreOrder(o.id);
    if (res.success) { toast.success(`${purgePhrase(o)} restored to the agent's list.`); void load(); }
    else toast.error(res.error ?? "Restore failed.");
  }

  return (
    <div className="space-y-5">
      <LivePanel agentId={pinnedAgent} />

      <RangeBar from={from} to={to} onFrom={setFrom} onTo={setTo} loading={loading} />

      {error && (
        <p className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B42318]">
          {error}
        </p>
      )}

      <Totals stats={stats} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E3E8EF] bg-white p-3">
        <span className="text-xs text-[#697386]">Charts:</span>
        {!pinnedAgent && (
          <Select value={agentFilter} onChange={setAgentFilter} label="All agents"
            options={agentOptions.map(([id, email]) => ({ value: id, label: email }))} />
        )}
        <div className="flex overflow-hidden rounded-md border border-[#E3E8EF]">
          {(["day", "week", "month"] as Granularity[]).map((g) => (
            <button key={g} type="button" onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                (granularity ?? stats?.granularity) === g
                  ? "bg-[#635BFF] text-white" : "text-[#425466] hover:bg-[#F6F9FC]"}`}>
              {g}
            </button>
          ))}
        </div>
        {granularity && (
          <button type="button" onClick={() => setGranularity(null)}
            className="text-xs text-[#635BFF] hover:underline">Auto</button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title={`Orders submitted per ${stats?.granularity ?? "day"}`}
            subtitle="Successful submits, Malaysia time"
          >
            <Trend trend={stats?.trend ?? []} granularity={stats?.granularity ?? "day"} />
          </Card>
        </div>
        <Card title="Why submits fail" subtitle="Every failed attempt in range">
          <Errors errors={stats?.errors ?? []} />
        </Card>
      </div>

      {!pinnedAgent && (
        <Card title="By agent" subtitle="Usage and the error each agent hits most">
          <AgentTable agents={stats?.agents ?? []} />
        </Card>
      )}

      <Card
        title={`All orders · ${filtered.length}`}
        subtitle="Every agent, every status, deleted included"
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {/* Agent is chosen once, above, and applies to the charts AND this
              table: two selects for one concept is how a page starts lying
              about which agent you are looking at. */}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, IC, ORD-…, portal no."
            className="w-56 rounded-md border border-[#E3E8EF] px-2 py-1.5 text-xs text-[#425466] placeholder:text-[#B4BCCA]"
          />
          <Select value={statusFilter} onChange={setStatusFilter} label="All statuses"
            options={[...statusOptions.map((s) => ({ value: s, label: s })), { value: "deleted", label: "deleted" }]} />
          <button type="button" onClick={exportCsv} disabled={filtered.length === 0}
            className="rounded-md border border-[#E3E8EF] px-2.5 py-1.5 text-xs text-[#425466] transition-colors hover:border-[#635BFF] disabled:opacity-40">
            Export CSV · {filtered.length}
          </button>
          <button type="button" onClick={() => setBulkOpen(true)}
            className="ml-auto rounded-md border border-[#FCA5A5] px-2.5 py-1.5 text-xs text-[#B42318] transition-colors hover:bg-[#FEF2F2]">
            Purge old deleted…
          </button>
        </div>
        <OrderTable rows={filtered} onRestore={restore} onPurge={setPurgeTarget} />
      </Card>

      {bulkOpen && (
        <BulkPurgeDialog onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); void load(); }} />
      )}

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

/* ── live jobs ───────────────────────────────────────────────────────────── */

/**
 * What is holding a submit slot right now.
 *
 * The ONLY thing on this page that auto-refreshes. The tables deliberately do
 * not: a list that reshuffles under the cursor while you are reading it is
 * worse than a slightly stale one, but a live panel that is stale is useless.
 */
function LivePanel({ agentId }: { agentId?: string }) {
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [reachable, setReachable] = useState(true);
  // The server's own words when it fails for a reason that is not the droplet
  // being down — an expired admin session being the common one.
  const [failure, setFailure] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<LiveJob | null>(null);
  const [loaded, setLoaded] = useState(false);

  const read = useCallback(async () => {
    const res = await adminLiveJobs();
    setReachable(res.reachable);
    setFailure(res.success ? null : res.error ?? "Could not load running submits.");
    setJobs(agentId ? res.data.filter((j) => j.agentId === agentId) : res.data);
    setLoaded(true);
  }, [agentId]);

  useEffect(() => {
    let alive = true;
    const tick = () => { void read().catch(() => { if (alive) setReachable(false); }); };
    tick();
    const t = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [read]);

  // Nothing at all until the first read lands, so the panel never flashes
  // "no submits running" at someone whose submit IS running.
  if (!loaded) return null;

  return (
    <>
      <Card title="Running now" subtitle="Submits holding a slot on the order service">
        {!reachable ? (
          // NOT the empty state: empty means idle, and unreachable does not.
          // Reporting them the same way is how an outage reads as calm.
          <p className="rounded-md bg-[#FFFAEB] px-3 py-2 text-sm text-[#B54708]">
            Could not reach the order service. Submits may still be running.
          </p>
        ) : failure ? (
          <p className="rounded-md bg-[#FFFAEB] px-3 py-2 text-sm text-[#B54708]">
            {failure === "Unauthorized"
              ? "Your admin session has expired — reload the page and sign in again."
              : failure}
          </p>
        ) : jobs.length === 0 ? (
          <Empty>No submits running.</Empty>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.jobId}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
                  j.stuck ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E3E8EF]"}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#0A2540]">
                    {j.orderLabel ?? <span className="italic text-[#B54708]">unknown order</span>}
                    <span className="ml-2 text-xs text-[#697386]">{j.agentEmail ?? "unknown agent"}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[#697386]">
                    {j.stage ?? j.status} · running {formatDuration(j.ageS * 1000)}
                    {j.stuck && <span className="ml-2 font-semibold text-[#B42318]">Stuck</span>}
                  </p>
                </div>
                <button type="button" onClick={() => setReleasing(j)}
                  className="shrink-0 rounded-md border border-[#E3E8EF] px-3 py-1.5 text-xs text-[#425466] transition-colors hover:border-[#635BFF]">
                  Release
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {releasing && (
        <ReleaseDialog job={releasing} onClose={() => setReleasing(null)}
          onDone={() => { setReleasing(null); void read(); }} />
      )}
    </>
  );
}

function ReleaseDialog({ job, onClose, onDone }: {
  job: LiveJob; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const res = await adminReleaseJob(job.jobId);
    setBusy(false);
    if (res.success) { toast.success(res.message); onDone(); }
    else { toast.error(res.error ?? "Could not release the job."); onDone(); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-[#0A2540]">Release this submit slot?</h3>
        <p className="mt-2 text-sm text-[#425466]">
          <strong>{job.orderLabel ?? "An unknown order"}</strong>
          {job.agentEmail ? <> for <strong>{job.agentEmail}</strong></> : null}, running{" "}
          {formatDuration(job.ageS * 1000)}.
        </p>
        {/* The honest half. The droplet stops the run when it still holds a task
            handle; when it does not — the genuinely wedged case — releasing frees
            the registry entry and nothing more. The admin cannot tell which case
            they are in beforehand, so the dialog covers the weaker one. */}
        <p className="mt-3 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
          This frees the slot so other agents can submit. If the run cannot be stopped it will keep
          going on the portal, and this order may still receive a result. Check at Unifi before
          submitting it again.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Cancel</button>
          <button type="button" onClick={go} disabled={busy}
            className="rounded-md bg-[#635BFF] px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Releasing…" : "Release slot"}
          </button>
        </div>
      </div>
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
    // Present tense, unlike its neighbours: who could submit RIGHT NOW, which
    // is the question you ask before wondering why nothing is moving.
    { label: "Connected now", value: t?.connected ?? 0 },
    { label: "Deleted orders", value: t?.deleted ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((x) => (
        <Tile key={x.label} label={x.label} value={x.value} />
      ))}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  // Counts up only when the value changes for a reason the admin caused — a
  // load, a range change, a filter. The hook animates on target change alone,
  // so unrelated re-renders leave the number still; a number that dances is a
  // number nobody trusts. tabular-nums (below) keeps the width from jittering.
  const shown = useAnimatedCounter(value, 500);
  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white p-4">
      <p className="text-xs text-[#697386]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#0A2540]">{shown}</p>
    </div>
  );
}

function Trend({ trend, granularity }: {
  trend: { day: string; count: number }[]; granularity: Granularity;
}) {
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
          tickFormatter={(d: string) => bucketLabel(d, granularity)} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#697386" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E3E8EF" }} />
        <Bar dataKey="count" fill="#635BFF" radius={[3, 3, 0, 0]} name="Submitted" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Errors({ errors }: { errors: { code: string; count: number }[] }) {
  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-6">
        {/* One-shot, not a loop: "nothing failed" is an all-clear to note and
            move past, not an activity to watch. Reduced motion keeps the text
            alone, which said everything already. */}
        <LottieSpot name="success" size={44} loop={false} fallback={null} />
        <p className="text-sm text-[#697386]">No failed attempts in this range.</p>
      </div>
    );
  }
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
            <th className="pb-2 pr-3 font-medium">Most common error</th>
            <th className="pb-2 font-medium">Connection</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.userId} className="border-b border-[#F0F3F8] last:border-0">
              <td className="py-2.5 pr-3">
                <Link href={`/admin/agents/${a.userId}`} className="text-[#635BFF] hover:underline">
                  {a.email}
                </Link>
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">{a.submitted}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">{a.failedAttempts}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-[#0A2540]">
                {a.successRate === null ? "—" : `${Math.round(a.successRate * 100)}%`}
              </td>
              <td className="py-2.5 pr-3 text-[#425466]">
                {a.topError ? `${prettyCode(a.topError.code)} · ${a.topError.count}` : "—"}
              </td>
              <td className="py-2.5"><ConnectionBadge view={a.connection} /></td>
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
        {/* Keyed on the filter state: changing a filter remounts the body, so
            the one-shot entrance replays for the NEW result set and never for
            an unrelated re-render. Delay capped at 15 rows — beyond that a
            stagger reads as slowness, not polish. */}
        <tbody key={`${rows.length}:${rows[0]?.id ?? ""}`}>
          {rows.map((o, i) => (
            <tr
              key={o.id}
              className="animate-fade-in-up border-b border-[#F0F3F8] last:border-0"
              style={{ animationDelay: `${Math.min(i, 15) * 20}ms` }}
            >
              <td className="py-2.5 pr-3">
                <Link href={`/admin/orders/${o.id}`} className="text-[#635BFF] hover:underline">
                  {o.reference ?? o.fullName}
                </Link>
                {o.reference && <div className="text-xs text-[#697386]">{o.fullName}</div>}
              </td>
              <td className="py-2.5 pr-3">
                <Link href={`/admin/agents/${o.agentId}`} className="text-[#425466] hover:text-[#635BFF] hover:underline">
                  {o.agentEmail ?? "—"}
                </Link>
                {/* The staff code rides under the e-mail rather than taking its
                    own column: this table has no breakpoints, and the Order
                    cell beside it already reads as two lines. A dash rather
                    than a blank when the agent has never connected. */}
                <div className="text-xs tabular-nums text-[#697386]">{o.agentStaffCode ?? "—"}</div>
              </td>
              <td className="py-2.5 pr-3">
                <StatusPill status={o.status} deleted={!!o.deletedAt} />
              </td>
              <td className="max-w-[240px] py-2.5 pr-3 text-xs text-[#425466]">
                {/* Only a FAILED run has an error. A submitted order's
                    errorMessage is the advance-payment note applyResult writes
                    on success, and calling that "Unclassified" reported a
                    payment receipt as a fault. */}
                {(() => { const e = orderErrorLabel(o); return e ? prettyCode(e) : "—"; })()}
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
  // The one place motion carries information on this table: the row whose
  // status just CHANGED is the row worth glancing at. Mount is not a change.
  const flash = useFlashOnChange(status, "animate-pill-flash");
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
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone} ${flash}`}>{status}</span>;
}

/**
 * A dealer session, as a badge.
 *
 * Colour and words both come from `describeConnection`, so a green pill can
 * never sit beside text saying the session expired.
 */
export function ConnectionBadge({ view }: { view: ConnectionView }) {
  // Pulses once when the STATE changes to good — an agent reconnecting is
  // news; a badge that was always green is not.
  const flash = useFlashOnChange(view.state, view.tone === "good" ? "animate-pill-flash" : "");
  const tone =
    view.tone === "good" ? "bg-[#ECFDF3] text-[#027A48]"
    : view.tone === "warn" ? "bg-[#FFFAEB] text-[#B54708]"
    : "bg-[#F1F3F6] text-[#697386]";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${tone} ${flash}`}>{view.label}</span>;
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

/**
 * Purge every order soft-deleted longer than the cutoff — the PII release
 * valve in one gesture. Confirmed by typing the COUNT: the single purge's
 * guards-against-haste rule, adapted because there is no one name to type.
 * The server recomputes the set, so a stale preview cannot widen the blast.
 */
function BulkPurgeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState<30 | 90 | 180>(90);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-[#0A2540]">Purge old deleted orders?</h3>
        <div className="mt-3 flex gap-2">
          {([30, 90, 180] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className={`rounded-md border px-3 py-1.5 text-xs ${days === d
                ? "border-[#635BFF] bg-[#EFF4FF] text-[#3538CD]" : "border-[#E3E8EF] text-[#425466]"}`}>
              Older than {d} days
            </button>
          ))}
        </div>
        {/* Keyed on `days`: switching cutoffs REMOUNTS the body with a fresh
            null preview — the same key-not-effect pattern the plans page set,
            and what keeps setState out of the effect (lint:
            react-hooks/set-state-in-effect). */}
        <BulkPurgeBody key={days} days={days} onClose={onClose} onDone={onDone} />
      </div>
    </div>
  );
}

function BulkPurgeBody({ days, onClose, onDone }: {
  days: 30 | 90 | 180; onClose: () => void; onDone: () => void;
}) {
  const [preview, setPreview] = useState<{ id: string; label: string }[] | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminBulkPurgePreview(days).then((r) => { if (alive && r.success) setPreview(r.data); });
    return () => { alive = false; };
  }, [days]);

  async function confirm() {
    setBusy(true);
    const res = await adminBulkPurge(days, typed);
    setBusy(false);
    if (res.success) { toast.success(`${res.purged} orders purged permanently.`); onDone(); }
    else toast.error(res.error ?? "Purge failed.");
  }

  return (
    <>
        {preview === null ? (
          <p className="mt-4 text-sm text-[#697386]">Counting…</p>
        ) : preview.length === 0 ? (
          <p className="mt-4 rounded-md bg-[#F6F9FC] px-3 py-2 text-sm text-[#425466]">
            Nothing has been deleted for longer than {days} days.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-[#425466]">
              This destroys <strong>{preview.length}</strong> order{preview.length === 1 ? "" : "s"} and
              their entire histories. It cannot be undone.
            </p>
            <p className="mt-2 max-h-24 overflow-y-auto rounded-md bg-[#F6F9FC] px-3 py-2 text-xs text-[#697386]">
              {preview.map((p) => p.label).join(" · ")}
            </p>
            <label className="mt-3 block text-xs text-[#697386]">
              Type <strong className="text-[#0A2540]">{preview.length}</strong> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#0A2540]" />
            </label>
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy || !preview || preview.length === 0}
            className="rounded-md bg-[#B42318] px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Purging…" : "Purge permanently"}
          </button>
        </div>
    </>
  );
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

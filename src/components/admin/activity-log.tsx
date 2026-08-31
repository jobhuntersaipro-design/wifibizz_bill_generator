"use client";

import { useEffect, useState } from "react";
import { getAuditLog } from "@/actions/admin-audit";

interface Row {
  id: string;
  actor: string;
  action: string;
  targetUser: string | null;
  targetOrder: string | null;
  detail: string | null;
  createdAt: string;
}

/** The action vocabulary, as sentences. An unknown action falls back to its
 * raw name rather than hiding — a trail that drops rows it cannot phrase is
 * not a trail. */
const PHRASE: Record<string, string> = {
  user_created: "created",
  user_updated: "updated",
  user_deleted: "deleted the account of",
  order_entry_enabled: "enabled order entry for",
  order_entry_disabled: "disabled order entry for",
  case_limit_topup: "topped up the case limit of",
  order_restored: "restored order",
  order_purged: "purged order",
  job_released: "released a submit slot",
  password_changed: "changed their password",
  password_reset: "reset their password",
};

export function ActivityLog() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    getAuditLog({ limit: 21 })
      .then((res) => {
        if (!alive || !res.success) return;
        setMore(res.data.length > 20);
        setRows(res.data.slice(0, 20));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function loadMore() {
    if (!rows?.length) return;
    const res = await getAuditLog({ before: rows[rows.length - 1].createdAt, limit: 51 });
    if (res.success) {
      setMore(res.data.length > 50);
      setRows([...rows, ...res.data.slice(0, 50)]);
    }
  }

  if (!rows || rows.length === 0) return null; // a young trail earns its space later

  const shown = expanded ? rows : rows.slice(0, 5);

  return (
    <section className="mt-6 rounded-xl border border-[#E3E8EF] bg-white">
      <div className="flex items-center justify-between border-b border-[#E3E8EF] px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-[#0A2540]">Activity</h2>
          <p className="mt-0.5 text-xs text-[#697386]">
            Who did what — account changes, access flips, restores, purges, releases.
          </p>
        </div>
        {rows.length > 5 && (
          <button type="button" onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer text-xs text-[#635BFF] hover:underline">
            {expanded ? "Show less" : `Show all ${rows.length}${more ? "+" : ""}`}
          </button>
        )}
      </div>
      <ul className="divide-y divide-[#F0F3F8] px-6 py-2">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-[13px]">
            <span className="tabular-nums text-xs text-[#697386]">
              {r.createdAt.slice(0, 16).replace("T", " ")}
            </span>
            <span className="font-medium text-[#0A2540]">
              {r.actor === "admin" ? "Admin" : r.targetUser ?? r.actor}
            </span>
            <span className="text-[#425466]">{PHRASE[r.action] ?? r.action}</span>
            {r.action.startsWith("password") ? null : r.targetUser && (
              <span className="font-medium text-[#0A2540]">{r.targetUser}</span>
            )}
            {r.targetOrder && <span className="font-mono text-xs text-[#697386]">{r.targetOrder.slice(0, 12)}…</span>}
            {r.detail && <span className="text-xs text-[#697386]">— {r.detail}</span>}
          </li>
        ))}
      </ul>
      {expanded && more && (
        <div className="border-t border-[#E3E8EF] px-6 py-3">
          <button type="button" onClick={loadMore}
            className="cursor-pointer text-xs text-[#635BFF] hover:underline">
            Load older
          </button>
        </div>
      )}
    </section>
  );
}

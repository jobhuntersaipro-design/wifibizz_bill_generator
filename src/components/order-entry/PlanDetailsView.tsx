"use client";

import { useEffect, useState } from "react";
import { getPublishedPlans, type PlanView } from "@/actions/plans";

/**
 * Read-only view of the plans an agent may sell, and what each one requires.
 *
 * The offer groups are the portal's own mandatory groups, recorded by an admin —
 * seeing them here is how an agent knows what a package will ask for before
 * committing a customer to it.
 */
export function PlanDetailsView() {
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getPublishedPlans()
      .then((r) => {
        if (!active) return;
        if (r.success) setPlans(r.plans);
        else setError("Couldn't load plan details.");
      })
      .catch(() => active && setError("Couldn't load plan details."));
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-red-700">{error}</p>
      </div>
    );
  }
  if (!plans) {
    return (
      <div className="rounded-lg border border-line bg-white p-12 flex flex-col items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <p className="text-sm text-ink-muted">Loading plan details…</p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = plans.filter((p) => !q || p.name.toLowerCase().includes(q));
  const byCategory = new Map<string, PlanView[]>();
  for (const p of visible) {
    const list = byCategory.get(p.category);
    if (list) list.push(p);
    else byCategory.set(p.category, [p]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-wash px-4 py-3">
        <p className="text-[12px] leading-snug text-ink-soft">
          These are the plans you can sell, and the offer groups the Unifi portal requires
          for each. A plan appears here once an admin has confirmed its groups against the
          portal — if one you need is missing, ask an admin to publish it.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search plans…"
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink hover:border-brand/60 focus:border-brand focus:outline-none transition-colors"
      />

      {plans.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center">
          <p className="text-sm font-medium text-ink-soft">No plans published yet</p>
          <p className="mt-1 text-xs text-ink-muted">
            An admin needs to record each plan&apos;s offer groups before it can be sold.
          </p>
        </div>
      )}

      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category} className="rounded-lg border border-line bg-white overflow-hidden">
          <h2 className="border-b border-line bg-wash px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {category}
            <span className="ml-2 tabular-nums text-ink-faint">{list.length}</span>
          </h2>
          {list.map((p) => (
            <div key={p.id} className="border-b border-line last:border-0 px-4 py-3">
              <p className="text-[13px] text-ink leading-snug">{p.name}</p>
              {p.offerGroups.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {p.offerGroups.map((g) => (
                    <li key={g.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          g.mandatory
                            ? "bg-danger/10 text-danger"
                            : "bg-line text-ink-muted"
                        }`}
                      >
                        {g.mandatory ? "★ required" : "optional"}
                      </span>
                      <code className="min-w-0 flex-1 truncate text-ink-soft" title={g.name}>
                        {g.name}
                      </code>
                      {/* What the group holds. A channel group is ticked by the
                          portal itself, so its rows are never chosen here. */}
                      {g.kind !== "device" && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            g.kind === "discount"
                              ? "bg-brand/10 text-brand"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {g.kind === "discount" ? "auto-applied" : "included"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

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
      <div className="rounded-lg border border-[#E3E8EF] bg-white p-12 flex flex-col items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
        <p className="text-sm text-[#697386]">Loading plan details…</p>
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
      <div className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-4 py-3">
        <p className="text-[12px] leading-snug text-[#425466]">
          These are the plans you can sell, and the offer groups the Unifi portal requires
          for each. A plan appears here once an admin has confirmed its groups against the
          portal — if one you need is missing, ask an admin to publish it.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search plans…"
        className="h-10 w-full rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#0A2540] hover:border-[#635BFF]/60 focus:border-[#635BFF] focus:outline-none transition-colors"
      />

      {plans.length === 0 && (
        <div className="rounded-lg border border-dashed border-[#E3E8EF] bg-white p-10 text-center">
          <p className="text-sm font-medium text-[#425466]">No plans published yet</p>
          <p className="mt-1 text-xs text-[#697386]">
            An admin needs to record each plan&apos;s offer groups before it can be sold.
          </p>
        </div>
      )}

      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category} className="rounded-lg border border-[#E3E8EF] bg-white overflow-hidden">
          <h2 className="border-b border-[#E3E8EF] bg-[#F6F9FC] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#697386]">
            {category}
            <span className="ml-2 tabular-nums text-[#8792A2]">{list.length}</span>
          </h2>
          {list.map((p) => (
            <div key={p.id} className="border-b border-[#E3E8EF] last:border-0 px-4 py-3">
              <p className="text-[13px] text-[#0A2540] leading-snug">{p.name}</p>
              {p.offerGroups.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {p.offerGroups.map((g) => (
                    <li key={g.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          g.mandatory
                            ? "bg-[#DF1B41]/10 text-[#DF1B41]"
                            : "bg-[#E3E8EF] text-[#697386]"
                        }`}
                      >
                        {g.mandatory ? "★ required" : "optional"}
                      </span>
                      <code className="min-w-0 truncate text-[#425466]" title={g.name}>
                        {g.name}
                      </code>
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

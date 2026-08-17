"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  adminListPlans,
  adminSetPlanPublished,
  adminAddOfferGroup,
  adminDeleteOfferGroup,
  adminAddOfferItem,
  adminDeleteOfferItem,
  type PlanView,
  type OfferGroupView,
} from "@/actions/plans";

/**
 * How an admin finds the offer-group names. Written out rather than illustrated
 * because the names must be copied EXACTLY — a screenshot invites retyping from
 * memory, and a name that doesn't match the dialog won't be found at run time.
 */
function Guide() {
  return (
    <details className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-[#0A2540]">
        Where do these offer group names come from?
      </summary>
      <div className="mt-3 space-y-3 text-[12px] leading-relaxed text-[#425466]">
        <p>
          Each plan&apos;s devices live in the Unifi portal&apos;s <strong>Offer</strong> dialog,
          and only the groups marked with a red <span className="font-semibold text-[#DF1B41]">*</span>{" "}
          are the ones that plan requires. That dialog exists only on an order&apos;s own
          detail page, so it has to be read by hand once per plan.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Open any existing order in the dealer portal (or start one for this plan).</li>
          <li>On the order detail page, find <strong>Select Offer</strong> and click <strong>Add</strong>.</li>
          <li>
            The <strong>Offer</strong> dialog lists rows like{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[11px]">
              Unifi Home 500Mbps Mesh WIFI [Pick 0-2]
            </code>
            .
          </li>
          <li>
            Copy <strong>only the rows with a red <span className="text-[#DF1B41]">*</span></strong>,
            exactly as written — including the <code className="rounded bg-white px-1 py-0.5 text-[11px]">[Pick 0-1]</code> part.
          </li>
        </ol>
        <div className="rounded-md border border-[#E3E8EF] bg-white p-3 font-mono text-[11px] leading-relaxed">
          <div className="text-[#8792A2]">Unifi Home 500Mbps Mesh WIFI [Pick 0-2]</div>
          <div className="text-[#8792A2]">Unifi Home 500Mbps VAS [Pick 0-N]</div>
          <div className="text-[#8792A2]">Unifi Home Broadband Smart Device (Set H) [Pick 0-1]</div>
          <div className="text-[#0A2540]">
            Unifi Home 500Mbps Premium Value With Device Discount[Pick 0-1]{" "}
            <span className="font-bold text-[#DF1B41]">*</span>{" "}
            <span className="text-[#635BFF]">← copy this</span>
          </div>
          <div className="text-[#0A2540]">
            Unifi Home 500Mbps Premium Value With Device[Pick 0-1]{" "}
            <span className="font-bold text-[#DF1B41]">*</span>{" "}
            <span className="text-[#635BFF]">← and this</span>
          </div>
        </div>
        <p>
          Drop the <span className="font-semibold text-[#DF1B41]">*</span> when pasting — tick
          &ldquo;Mandatory&rdquo; instead. A plan can only be published once it has at least one
          mandatory group.
        </p>
      </div>
    </details>
  );
}

/**
 * One offer group and the rows inside it.
 *
 * Discount groups are labelled as automatic: the agent never picks from them,
 * the order carries them. Device groups are what the agent chooses from.
 */
function GroupBlock({ group, onChanged }: { group: OfferGroupView; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [monthly, setMonthly] = useState("");
  const [busy, setBusy] = useState(false);

  async function addItem() {
    setBusy(true);
    const res = await adminAddOfferItem(group.id, name, code, monthly);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error ?? "Couldn't add that item.");
      return;
    }
    setName(""); setCode(""); setMonthly(""); setAdding(false);
    onChanged();
  }

  async function removeItem(id: string) {
    const res = await adminDeleteOfferItem(id);
    if (!res.success) {
      toast.error(res.error ?? "Couldn't remove that item.");
      return;
    }
    onChanged();
  }

  return (
    <li className="rounded-md border border-[#E3E8EF] bg-[#F6F9FC] px-2.5 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            group.mandatory ? "bg-[#DF1B41]/10 text-[#DF1B41]" : "bg-[#E3E8EF] text-[#697386]"
          }`}
          title={group.mandatory ? "Marked with a red * in the portal" : "Optional group"}
        >
          {group.mandatory ? "★ required" : "optional"}
        </span>
        <code className="min-w-0 flex-1 truncate text-[#425466]" title={group.name}>
          {group.name}
        </code>
        {group.isDiscount && (
          <span
            className="shrink-0 rounded bg-[#635BFF]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#635BFF]"
            title="Applied automatically during the order — the agent never picks it"
          >
            auto-applied
          </span>
        )}
      </div>

      {group.items.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 pl-2">
          {group.items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 text-[12px]">
              <span className="text-[#8792A2]">└</span>
              <span className="min-w-0 flex-1 truncate text-[#0A2540]" title={it.name}>
                {it.name}
                {it.code && (
                  <span className="ml-1.5 text-[10px] text-[#8792A2] tabular-nums">#{it.code}</span>
                )}
              </span>
              {it.monthly !== null && (
                <span className="shrink-0 text-[11px] tabular-nums text-[#697386]">
                  RM{it.monthly}/mth
                </span>
              )}
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                aria-label={`Remove ${it.name}`}
                className="shrink-0 rounded p-1 text-[#697386] hover:bg-white hover:text-[#DF1B41] transition-colors cursor-pointer"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={group.isDiscount
              ? "Promo Discount RM10 (Perpetual) - 36 Months"
              : "Premium Value Samsung TV 55inch 1 (RM20)"}
            className="h-8 min-w-64 flex-1 rounded border border-[#E3E8EF] bg-white px-2 text-[12px] text-[#0A2540] focus:border-[#635BFF] focus:outline-none"
          />
          <input
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="RM/mth"
            className="h-8 w-20 rounded border border-[#E3E8EF] bg-white px-2 text-[12px] tabular-nums text-[#0A2540] focus:border-[#635BFF] focus:outline-none"
          />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="code (optional)"
            className="h-8 w-28 rounded border border-[#E3E8EF] bg-white px-2 text-[12px] tabular-nums text-[#0A2540] focus:border-[#635BFF] focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={addItem}
            className="rounded bg-[#635BFF] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0A2540] disabled:opacity-50 transition-colors cursor-pointer"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setName(""); setCode(""); setMonthly(""); }}
            className="rounded border border-[#E3E8EF] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#425466] hover:border-[#635BFF] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 ml-4 text-[11px] font-medium text-[#635BFF] hover:underline cursor-pointer"
        >
          + Add {group.isDiscount ? "discount" : "device"}
        </button>
      )}
    </li>
  );
}

function PlanRow({ plan, onChanged }: { plan: PlanView; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [busy, setBusy] = useState(false);

  const mandatoryCount = plan.offerGroups.filter((g) => g.mandatory).length;

  async function togglePublish() {
    setBusy(true);
    const res = await adminSetPlanPublished(plan.id, !plan.published);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error ?? "Couldn't change this plan.");
      return;
    }
    toast.success(plan.published ? "Unpublished" : "Published", { description: plan.name });
    onChanged();
  }

  async function addGroup() {
    setBusy(true);
    const res = await adminAddOfferGroup(plan.id, name, mandatory);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error ?? "Couldn't add that offer group.");
      return;
    }
    setName("");
    setAdding(false);
    onChanged();
  }

  async function removeGroup(id: string) {
    const res = await adminDeleteOfferGroup(id);
    if (!res.success) {
      toast.error(res.error ?? "Couldn't remove that offer group.");
      return;
    }
    if (res.unpublished) {
      toast.warning("Plan unpublished", {
        description: "Its last mandatory offer group was removed.",
      });
    }
    onChanged();
  }

  return (
    <div className="border-b border-[#E3E8EF] last:border-0 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[#0A2540] leading-snug">{plan.name}</p>
          <p className="mt-0.5 text-[11px] text-[#697386]">
            {plan.bandwidth ?? "—"}
            {mandatoryCount === 0 && " · no offer groups yet"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            plan.published
              ? "bg-green-100 text-green-700"
              : mandatoryCount > 0
                ? "bg-[#E3E8EF] text-[#425466]"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {plan.published ? "Published" : mandatoryCount > 0 ? "Unpublished" : "Needs groups"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={togglePublish}
          className="shrink-0 rounded-md border border-[#E3E8EF] px-3 py-1.5 text-[12px] font-medium text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] disabled:opacity-50 transition-colors cursor-pointer"
        >
          {plan.published ? "Unpublish" : "Publish"}
        </button>
      </div>

      {plan.offerGroups.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {plan.offerGroups.map((g) => (
            <div key={g.id} className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <GroupBlock group={g} onChanged={onChanged} />
              </div>
              <button
                type="button"
                onClick={() => removeGroup(g.id)}
                aria-label={`Remove group ${g.name}`}
                title="Remove this group and its items"
                className="mt-2 shrink-0 rounded p-1 text-[#697386] hover:bg-[#F6F9FC] hover:text-[#DF1B41] transition-colors cursor-pointer"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Unifi Home 500Mbps Premium Value With Device[Pick 0-1]"
            className="h-9 min-w-72 flex-1 rounded-lg border border-[#E3E8EF] px-3 text-[12px] text-[#0A2540] hover:border-[#635BFF]/60 focus:border-[#635BFF] focus:outline-none transition-colors"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-[#425466] cursor-pointer">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[#CBD2DC] accent-[#635BFF] cursor-pointer"
            />
            Mandatory (red *)
          </label>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={addGroup}
            className="rounded-md bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0A2540] disabled:opacity-50 transition-colors cursor-pointer"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setName(""); }}
            className="rounded-md border border-[#E3E8EF] px-3 py-1.5 text-[12px] font-medium text-[#425466] hover:border-[#635BFF] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 text-[11px] font-medium text-[#635BFF] hover:underline cursor-pointer"
        >
          + Add offer group
        </button>
      )}
    </div>
  );
}

export function PlanDetails() {
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnpublished, setOnlyUnpublished] = useState(false);

  async function reload() {
    const res = await adminListPlans();
    if (res.success) setPlans(res.plans);
    else setError(res.error ?? "Couldn't load plans.");
  }

  useEffect(() => {
    let active = true;
    adminListPlans()
      .then((res) => {
        if (!active) return;
        if (res.success) setPlans(res.plans);
        else setError(res.error ?? "Couldn't load plans.");
      })
      .catch(() => active && setError("Couldn't load plans."));
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
        <p className="text-sm text-[#697386]">Loading plans…</p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = plans.filter((p) => {
    if (onlyUnpublished && p.published) return false;
    return !q || p.name.toLowerCase().includes(q);
  });

  // Grouped by the portal's own offer category, which is how the plans are
  // presented in the dealer portal itself.
  const byCategory = new Map<string, PlanView[]>();
  for (const p of visible) {
    const list = byCategory.get(p.category);
    if (list) list.push(p);
    else byCategory.set(p.category, [p]);
  }

  const publishedCount = plans.filter((p) => p.published).length;

  return (
    <div className="space-y-4">
      <Guide />

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plans…"
          className="h-10 flex-1 min-w-60 rounded-lg border border-[#E3E8EF] bg-white px-3 text-sm text-[#0A2540] hover:border-[#635BFF]/60 focus:border-[#635BFF] focus:outline-none transition-colors"
        />
        <label className="flex items-center gap-2 text-[12px] text-[#425466] cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnpublished}
            onChange={(e) => setOnlyUnpublished(e.target.checked)}
            className="h-4 w-4 rounded border-[#CBD2DC] accent-[#635BFF] cursor-pointer"
          />
          Unpublished only
        </label>
        <span className="text-[12px] font-medium text-[#0A2540] tabular-nums">
          {publishedCount} of {plans.length} published
        </span>
      </div>

      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category} className="rounded-lg border border-[#E3E8EF] bg-white overflow-hidden">
          <h2 className="border-b border-[#E3E8EF] bg-[#F6F9FC] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#697386]">
            {category}
            <span className="ml-2 tabular-nums text-[#8792A2]">{list.length}</span>
          </h2>
          {list.map((p) => (
            <PlanRow key={p.id} plan={p} onChanged={reload} />
          ))}
        </section>
      ))}

      {visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-[#E3E8EF] bg-white p-10 text-center">
          <p className="text-sm text-[#697386]">No plans match.</p>
        </div>
      )}
    </div>
  );
}

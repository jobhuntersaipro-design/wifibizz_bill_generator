"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminDeletePlanDetail,
  adminImportPlanDetails,
  adminListPlanDetails,
  adminSavePlanDetail,
} from "@/actions/plan-details";
import {
  checkPlanDetail,
  PLAN_CSV_TEMPLATE,
  readPlanCsv,
  type PlanDetailInput,
  type PlanDetailView,
} from "@/lib/plan-detail";
import { formatFee } from "@/lib/plan-offer";

const EMPTY: PlanDetailInput = { name: "", price: "", contractMonths: "" };

export function PlanDetailsList() {
  const [rows, setRows] = useState<PlanDetailView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; input: PlanDetailInput } | null>(null);
  const [deleting, setDeleting] = useState<PlanDetailView | null>(null);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ step: string; pct: number } | null>(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    adminListPlanDetails().then((res) => {
      if (res.success) setRows(res.data);
      else setError(res.error);
    });

  useEffect(() => {
    void load();
  }, []);

  async function onCsv(file: File | undefined) {
    if (!file) return;
    setCsvErrors([]);
    setUpload({ step: `Reading ${file.name}…`, pct: 15 });
    const text = await file.text();
    setUpload({ step: "Checking each line…", pct: 35 });
    const parsed = readPlanCsv(text);
    if (!parsed.ok) {
      setUpload(null);
      return setCsvErrors(parsed.errors);
    }
    setUpload({ step: `Saving ${parsed.rows.length} plan${parsed.rows.length === 1 ? "" : "s"}…`, pct: 65 });
    const res = await adminImportPlanDetails(parsed.rows);
    if (!res.success) {
      setUpload(null);
      return setCsvErrors([res.error]);
    }
    setUpload({ step: "Refreshing the list…", pct: 90 });
    await load();
    setUpload({ step: "Done", pct: 100 });
    toast.success(`Uploaded ${file.name}: ${res.data.added} added, ${res.data.updated} updated`);
    setTimeout(() => setUpload(null), 600);
  }

  const q = query.trim().toLowerCase();
  const shown = rows?.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      `rm${formatFee(Number(r.price))}`.includes(q.replace(/\s+/g, "")) ||
      `${r.contractMonths} months`.includes(q),
  );

  function onSaved(row: PlanDetailView) {
    setRows((prev) =>
      [...(prev ?? []).filter((r) => r.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await adminDeletePlanDetail(deleting.id);
    if (!res.success) return toast.error(res.error);
    setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
    toast.success(`Deleted ${deleting.name}`);
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-card p-4 text-sm text-ink-muted space-y-2">
        <p className="font-medium text-ink">What this list is for</p>
        <p>
          The consent chat (Chat and Bizz Chat on the Case List, Combine, and the Order Entry chat cards) prints the
          monthly fee and the contract period of the customer&apos;s package. When the package name does not say
          them (for example &ldquo;RM189&rdquo; or &ldquo;(24M)&rdquo;), the chat looks up the package here. Type
          the plan name as it appears in the package. Capitals and extra spaces do not matter.
        </p>
        <p>If a package is not on this list, the agent must type the fee and the contract period before the chat is made.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {rows ? (q ? `${shown?.length ?? 0} of ${rows.length} plans` : `${rows.length} plan${rows.length === 1 ? "" : "s"}`) : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(PLAN_CSV_TEMPLATE)}`}
            download="plan-details-template.csv"
            className="self-center text-sm text-brand underline-offset-2 hover:underline"
          >
            Download CSV template
          </a>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void onCsv(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="outline" disabled={!!upload} onClick={() => fileRef.current?.click()}>
            {upload ? "Uploading…" : "Upload CSV"}
          </Button>
          <Button onClick={() => setEditing({ id: null, input: EMPTY })}>Add plan</Button>
        </div>
      </div>

      {upload && (
        <div role="status" className="rounded-lg border border-line bg-card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink">{upload.step}</span>
            <span className="tabular-nums text-ink-muted">{upload.pct}%</span>
          </div>
          <Progress value={upload.pct} aria-label="CSV upload progress" />
        </div>
      )}

      {rows && rows.length > 0 && (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plan name, price or contract"
          aria-label="Search plans"
          className="max-w-sm"
        />
      )}

      {csvErrors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">The CSV was not uploaded. Correct these lines and upload it again:</p>
          <ul className="mt-1 list-disc pl-5">
            {csvErrors.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {csvErrors.length > 20 && <p className="mt-1">…and {csvErrors.length - 20} more.</p>}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {!rows && !error && <p className="text-sm text-ink-muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="rounded-lg border border-line bg-card p-6 text-center text-sm text-ink-muted">
          No plans yet. Add one with its price and contract period.
        </p>
      )}

      {shown && shown.length === 0 && rows && rows.length > 0 && (
        <p className="rounded-lg border border-line bg-card p-6 text-center text-sm text-ink-muted">
          No plan matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {shown && shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="bg-wash text-left text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Plan name</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Price</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Contract</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink">{r.name}</td>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">RM{formatFee(Number(r.price))}</td>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{r.contractMonths} months</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            id: r.id,
                            input: { name: r.name, price: formatFee(Number(r.price)), contractMonths: String(r.contractMonths) },
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleting(r)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PlanDetailDialog
          key={editing.id ?? "new"}
          id={editing.id}
          initial={editing.input}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            onSaved(row);
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete plan</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{deleting?.name}&rdquo;? The consent chat will then ask the agent for its price and
              contract period, unless the plan name says them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanDetailDialog({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string | null;
  initial: PlanDetailInput;
  onClose: () => void;
  onSaved: (row: PlanDetailView) => void;
}) {
  const [input, setInput] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof PlanDetailInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput((prev) => ({ ...prev, [k]: e.target.value }));
    setError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkPlanDetail(input);
    if (!check.ok) return setError(check.error);
    setSaving(true);
    const res = await adminSavePlanDetail(id, input);
    setSaving(false);
    if (!res.success) return setError(res.error);
    toast.success(id ? "Plan updated" : "Plan added");
    onSaved(res.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{id ? "Edit plan" : "Add plan"}</DialogTitle>
            <DialogDescription>Type the plan name as it appears in the order&apos;s package.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pd-name">Plan name</Label>
            <Input id="pd-name" autoFocus value={input.name} onChange={set("name")} placeholder="e.g. Unifi Home 500Mbps" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pd-price">Price (RM per month)</Label>
            <Input id="pd-price" inputMode="decimal" value={input.price} onChange={set("price")} placeholder="e.g. 189" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pd-months">Contract (months)</Label>
            <Input id="pd-months" inputMode="numeric" value={input.contractMonths} onChange={set("contractMonths")} placeholder="e.g. 24" />
          </div>
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : id ? "Save" : "Add plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

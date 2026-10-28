"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "@/lib/toast";
import { pollWhileVisible } from "@/lib/poll";
import { adminCloneTargets } from "@/actions/admin-orders";
import {
  dismissWhatsappAlert,
  getWhatsappKnowledge,
  listWhatsappAlerts,
  pushWhatsappToOrderEntry,
  saveWhatsappKnowledge,
  type WhatsappAlertView,
  type WhatsappKnowledge,
} from "@/actions/whatsapp";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

const ALERT_POLL_MS = 30_000;

/** Chats where the customer sent documents: the AI handed off and someone must pick it up. */
export function WhatsappAlerts() {
  const [alerts, setAlerts] = useState<WhatsappAlertView[]>([]);

  const load = useCallback(async () => {
    const res = await listWhatsappAlerts();
    if (res.success) setAlerts(res.data);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const stop = pollWhileVisible(() => void load(), ALERT_POLL_MS);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [load]);

  async function dismiss(id: string) {
    setAlerts((list) => list.filter((a) => a.id !== id));
    await dismissWhatsappAlert(id);
  }

  if (alerts.length === 0) return null;
  return (
    <section aria-label="WhatsApp alerts" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <BellRing className="size-4" aria-hidden /> Documents received ({alerts.length})
      </h2>
      <ul className="mt-2 space-y-2">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              {a.message} <span className="text-xs text-amber-700">{formatKualaLumpur(a.createdAt)}</span>
            </span>
            <button
              type="button"
              onClick={() => void dismiss(a.id)}
              className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm font-medium hover:bg-amber-100"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TEXT_TYPES = /\.(txt|md|csv)$/i;

/** Upload or replace the document the AI answers from. */
export function WhatsappKnowledgeSettings() {
  const [doc, setDoc] = useState<WhatsappKnowledge | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getWhatsappKnowledge();
    if (res.success) setDoc(res.data);
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  async function upload(file: File) {
    const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!pdf && !TEXT_TYPES.test(file.name)) {
      toast.error("Upload a PDF or a text file (.txt, .md).");
      return;
    }
    setBusy(true);
    const data = pdf ? await toBase64(file) : await file.text();
    const res = await saveWhatsappKnowledge({ name: file.name, mime: pdf ? "application/pdf" : "text/plain", data });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Knowledge document saved. The AI uses it from the next message.");
    await load();
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">AI knowledge document</h2>
      <p className="mt-1 text-sm text-ink-muted">
        The AI answers only from this document: packages, prices, coverage and the documents a customer must send.
        When the document has no answer, the AI says it will check. Without a document, the AI does not reply.
      </p>
      <p className="mt-3 text-sm text-ink">
        {doc === null
          ? "Loading…"
          : doc.name
            ? <>Current: <strong>{doc.name}</strong>{doc.updatedAt && <span className="text-ink-muted"> · updated {formatKualaLumpur(doc.updatedAt)}</span>}</>
            : "No document uploaded."}
      </p>
      <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-medium text-white has-[:disabled]:opacity-50">
        {busy ? "Uploading…" : doc?.name ? "Replace document" : "Upload document"}
        <input
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      <p className="mt-2 text-xs text-ink-muted">PDF up to 4 MB, or a text file.</p>
    </section>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface Target {
  id: string;
  email: string | null;
  name: string | null;
  isSuperAdmin: boolean;
}

/** Make an Order Entry draft from this chat: name, number and the documents the customer sent. */
export function WhatsappPushToOrderEntry({ waId }: { waId: string }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; reference: string | null; documents: number; email: string } | null>(null);

  async function openDialog() {
    setOpen(true);
    setDone(null);
    if (targets) return;
    const res = await adminCloneTargets();
    if (!res.success) {
      toast.error(res.error ?? "Could not load accounts.");
      return;
    }
    setTargets(res.data);
    setTargetId(res.data[0]?.id ?? "");
  }

  async function confirm() {
    setBusy(true);
    const res = await pushWhatsappToOrderEntry(waId, targetId);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setDone(res.data);
    toast.success(`${res.data.reference} created in ${res.data.email}.`);
  }

  return (
    <>
      <button type="button" onClick={() => void openDialog()} className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-wash">
        Push to Order Entry
      </button>
      {open && (
        <Modal
          label="Push to Order Entry"
          onClose={() => setOpen(false)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="push-oe-title"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        >
          <h3 id="push-oe-title" className="text-base font-semibold text-ink">
            {done ? "Draft created" : "Push this lead to Order Entry"}
          </h3>
          {done ? (
            <>
              <p className="mt-2 text-sm text-ink-soft">
                <strong>{done.reference}</strong> is a draft in <strong>{done.email}</strong> with {done.documents} document
                {done.documents === 1 ? "" : "s"} from this chat. Sign in as that account, complete the ID number, address
                and package, then submit it.
              </p>
              <div className="mt-5 flex justify-end">
                <Button unstyled variant="outline" type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-2 text-sm text-ink-soft">
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-soft">
                Creates a <strong>draft</strong> with the customer&apos;s name and number, and the images and PDFs they sent in
                this chat. Nothing is submitted.
              </p>
              <label className="mt-4 block text-xs text-ink-muted">
                Place the draft in
                <Select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  disabled={!targets}
                  className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                >
                  {!targets && <option>Loading accounts…</option>}
                  {targets?.length === 0 && <option value="">No Order Entry accounts</option>}
                  {targets?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.email ?? t.name ?? t.id}
                      {t.isSuperAdmin ? " (superadmin)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <Button unstyled variant="outline" type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-2 text-sm text-ink-soft">
                  Cancel
                </Button>
                <Button
                  unstyled
                  variant="default"
                  type="button"
                  onClick={() => void confirm()}
                  disabled={busy || !targetId}
                  className="rounded-md bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create draft"}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

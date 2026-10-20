"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  countWhatsappLabelUse,
  deleteWhatsappLabel,
  moveWhatsappLabel,
  saveWhatsappLabel,
  type CrmField,
} from "@/actions/whatsapp";
import { LABEL_COLORS, type ChatSummary, type Label, type LabelKind, type LabelSetter } from "@/lib/whatsapp-inbox";

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className={`inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium ${LABEL_COLORS[label.color] ?? LABEL_COLORS.gray}`}>
      {label.name}
    </span>
  );
}

const FIELD_KIND: Record<CrmField, LabelKind> = { stage: "stage", folder: "folder", tags: "tag" };

function Setter({ by, onRelease }: { by: LabelSetter | null; onRelease: () => void }) {
  if (by === "admin") {
    return (
      <span className="flex items-center gap-2 text-[11px] text-ink-muted">
        Set by admin
        <button type="button" onClick={onRelease} className="font-medium text-brand hover:underline">Let AI manage</button>
      </span>
    );
  }
  return <span className="text-[11px] text-ink-muted">{by === "ai" ? "AI" : "Not set"}</span>;
}

/** Stage, folder and tags of one chat. Changing a field marks it admin-set, so Claude leaves it alone. */
export function WhatsappCrmControls({
  chat,
  labels,
  onSet,
  onRelease,
}: {
  chat: ChatSummary;
  labels: Label[];
  onSet: (field: CrmField, value: string | string[] | null) => void;
  onRelease: (field: CrmField) => void;
}) {
  const of = (kind: LabelKind) => labels.filter((l) => l.kind === kind);
  const select = (field: "stage" | "folder", value: string | null, by: LabelSetter | null) => (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`wa-${field}`} className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {field === "stage" ? "Lead stage" : "Folder"}
        </label>
        <Setter by={by} onRelease={() => onRelease(field)} />
      </div>
      <select
        id={`wa-${field}`}
        value={value ?? ""}
        onChange={(event) => onSet(field, event.target.value || null)}
        className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2 text-sm text-ink"
      >
        <option value="">None</option>
        {of(FIELD_KIND[field]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-3">
      {select("stage", chat.stageId, chat.stageBy)}
      {chat.aiReason && chat.stageBy !== "admin" && <p className="text-xs text-ink-muted">AI: {chat.aiReason}</p>}
      {select("folder", chat.folderId, chat.folderBy)}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Tags</span>
          <Setter by={chat.tagsBy} onRelease={() => onRelease("tags")} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {of("tag").length === 0 && <span className="text-sm text-ink-muted">No tags. Add some in Settings.</span>}
          {of("tag").map((l) => {
            const on = chat.tagIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => onSet("tags", on ? chat.tagIds.filter((id) => id !== l.id) : [...chat.tagIds, l.id])}
                className={`min-h-8 rounded-full border px-2.5 text-xs font-medium ${on ? `border-transparent ${LABEL_COLORS[l.color] ?? LABEL_COLORS.gray}` : "border-line text-ink-muted hover:bg-wash"}`}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const LISTS: { kind: LabelKind; title: string; help: string }[] = [
  { kind: "stage", title: "Lead stages", help: "One per chat, in pipeline order." },
  { kind: "folder", title: "Folders", help: "One per chat." },
  { kind: "tag", title: "Tags", help: "Any number per chat." },
];

const COLORS = Object.keys(LABEL_COLORS);

/** The admin's stage / folder / tag lists. The description is what Claude reads to decide. */
export function WhatsappLabelSettings({ labels, onChanged }: { labels: Label[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Claude sorts each chat with these lists, reading the description to decide when a label fits. Write it the way you would brief a new agent.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {LISTS.map((list) => (
          <section key={list.kind} className="rounded-lg border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink">{list.title}</h2>
            <p className="text-xs text-ink-muted">{list.help}</p>
            <ul className="mt-3 space-y-2">
              {labels.filter((l) => l.kind === list.kind).map((l, i, all) => (
                <LabelRow key={l.id} label={l} first={i === 0} last={i === all.length - 1} onChanged={onChanged} />
              ))}
            </ul>
            <LabelForm kind={list.kind} onSaved={onChanged} />
          </section>
        ))}
      </div>
    </div>
  );
}

function LabelRow({ label, first, last, onChanged }: { label: Label; first: boolean; last: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function move(direction: -1 | 1) {
    setBusy(true);
    const res = await moveWhatsappLabel(label.id, direction);
    setBusy(false);
    if (!res.success) toast.error(res.error);
    else onChanged();
  }

  async function remove() {
    const used = await countWhatsappLabelUse(label.id);
    const count = used.success ? used.data : 0;
    const where = count > 0 ? ` It is on ${count} chat${count === 1 ? "" : "s"} and will be removed from them.` : "";
    if (!window.confirm(`Delete "${label.name}"?${where}`)) return;
    setBusy(true);
    const res = await deleteWhatsappLabel(label.id);
    setBusy(false);
    if (!res.success) toast.error(res.error);
    else onChanged();
  }

  if (editing) {
    return (
      <li>
        <LabelForm kind={label.kind} label={label} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="rounded-lg border border-line p-2">
      <div className="flex items-center gap-1">
        <LabelChip label={label} />
        <span className="ml-auto flex gap-0.5">
          <IconButton label="Move up" disabled={first || busy} onClick={() => void move(-1)}>↑</IconButton>
          <IconButton label="Move down" disabled={last || busy} onClick={() => void move(1)}>↓</IconButton>
          <IconButton label="Edit" disabled={busy} onClick={() => setEditing(true)}>Edit</IconButton>
          <IconButton label="Delete" disabled={busy} onClick={() => void remove()}>Delete</IconButton>
        </span>
      </div>
      {label.description && <p className="mt-1 text-xs text-ink-muted">{label.description}</p>}
    </li>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="min-h-8 min-w-8 rounded-md px-1.5 text-xs text-ink-muted hover:bg-wash hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LabelForm({ kind, label, onSaved, onCancel }: { kind: LabelKind; label?: Label; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(label?.name ?? "");
  const [description, setDescription] = useState(label?.description ?? "");
  const [color, setColor] = useState(label?.color ?? "gray");
  const [saving, setSaving] = useState(false);
  const id = `wa-label-${label?.id ?? `new-${kind}`}`;

  async function save() {
    setSaving(true);
    const res = await saveWhatsappLabel({ id: label?.id, kind, name, description, color });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    if (!label) {
      setName("");
      setDescription("");
      setColor("gray");
    }
    onSaved();
  }

  return (
    <form
      className={`space-y-2 ${label ? "rounded-lg border border-line p-2" : "mt-3 border-t border-line pt-3"}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-2">
        <label htmlFor={`${id}-name`} className="sr-only">Name</label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder={label ? "Name" : `New ${kind}`}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted"
        />
        <label htmlFor={`${id}-color`} className="sr-only">Colour</label>
        <select
          id={`${id}-color`}
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="rounded-lg border border-line bg-white px-1.5 py-1.5 text-sm text-ink"
        >
          {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <label htmlFor={`${id}-desc`} className="sr-only">When it applies</label>
      <textarea
        id={`${id}-desc`}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={300}
        rows={2}
        placeholder="When does it apply? Claude reads this."
        className="w-full resize-none rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-9 rounded-lg px-3 text-sm text-ink-muted hover:bg-wash">Cancel</button>
        )}
        <button type="submit" disabled={saving || !name.trim()} className="min-h-9 rounded-lg bg-ink px-3 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : label ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

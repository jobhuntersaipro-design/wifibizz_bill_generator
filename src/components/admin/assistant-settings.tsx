"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { saveChatSettings } from "@/actions/admin-chat-settings";
import {
  DEFAULT_INSTRUCTIONS,
  HANDOFF_PLACEHOLDER,
  MAX_INSTRUCTIONS_CHARS,
  referenceBlock,
  SAFETY_BLOCK,
} from "@/lib/admin-chat/prompt";
import {
  CHAT_EFFORTS,
  CHAT_MODELS,
  disabledToolsNamedIn,
  MAX_TOOL_DESCRIPTION_CHARS,
  type ChatSettings,
} from "@/lib/admin-chat/settings-rules";
import { cn } from "@/lib/utils";

export interface ToolInfo {
  name: string;
  label: string;
  note: string | null;
  defaultDescription: string;
  inputs: { name: string; description: string | null }[];
}

interface Runtime {
  enabled: boolean;
  /** The deployment's ADMIN_CHAT_MODEL / ADMIN_CHAT_EFFORT — used when nothing is picked here. */
  model: string;
  effort: string;
  handoffName: string;
}

/** The editable form of the settings: every text filled in, so dirty checks compare like with like. */
interface Draft {
  instructions: string;
  disabled: string[];
  descriptions: Record<string, string>;
  /** "" = the deployment default. */
  model: string;
  effort: string;
}

function toDraft(s: ChatSettings, tools: ToolInfo[]): Draft {
  return {
    instructions: s.instructions ?? DEFAULT_INSTRUCTIONS,
    disabled: [...s.disabledTools].sort(),
    descriptions: Object.fromEntries(
      tools.map((t) => [t.name, s.toolDescriptions[t.name] ?? t.defaultDescription]),
    ),
    model: s.model ?? "",
    effort: s.effort ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.instructions.trim() === b.instructions.trim() &&
    a.disabled.join(",") === b.disabled.join(",") &&
    a.model === b.model &&
    a.effort === b.effort &&
    Object.keys(a.descriptions).every((k) => a.descriptions[k].trim() === (b.descriptions[k] ?? "").trim())
  );
}

export function AssistantSettings({
  initial,
  tools,
  runtime,
}: {
  initial: ChatSettings;
  tools: ToolInfo[];
  runtime: Runtime;
}) {
  const [saved, setSaved] = useState<Draft>(() => toDraft(initial, tools));
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);

  const dirty = !sameDraft(draft, saved);
  const warnings = useMemo(
    () => disabledToolsNamedIn(draft.instructions, draft.disabled),
    [draft.instructions, draft.disabled],
  );

  function setDisabled(name: string, off: boolean) {
    setDraft((d) => ({
      ...d,
      disabled: off ? [...d.disabled, name].sort() : d.disabled.filter((n) => n !== name),
    }));
  }

  async function save() {
    setSaving(true);
    const res = await saveChatSettings({
      instructions: draft.instructions,
      disabledTools: draft.disabled,
      toolDescriptions: draft.descriptions,
      model: draft.model || null,
      effort: (draft.effort || null) as ChatSettings["effort"],
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    const next = toDraft(res.settings, tools);
    setSaved(next);
    setDraft(next);
    toast.success("Saved. The assistant uses this from its next message.");
  }

  return (
    <div className="space-y-5 pb-20">
      <RuntimeStrip runtime={runtime} />

      <ModelCard
        model={draft.model}
        effort={draft.effort}
        runtime={runtime}
        onModel={(model) => setDraft((d) => ({ ...d, model }))}
        onEffort={(effort) => setDraft((d) => ({ ...d, effort }))}
      />

      <InstructionsCard
        value={draft.instructions}
        handoffName={runtime.handoffName}
        warnings={warnings}
        onChange={(instructions) => setDraft((d) => ({ ...d, instructions }))}
      />

      <section className="rounded-xl border border-[#E3E8EF] bg-white">
        <div className="border-b border-[#E3E8EF] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[#0A2540]">Tools</h2>
          <p className="mt-1 text-[13px] text-[#697386]">
            The lookups the assistant can run. All of them only read. A switched-off tool is not offered to the
            assistant and is refused if it asks for it. The description is what the assistant reads to decide when to
            use a tool; what the tool actually looks up is fixed in code.
          </p>
        </div>
        <ul className="divide-y divide-[#E3E8EF]">
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              enabled={!draft.disabled.includes(t.name)}
              description={draft.descriptions[t.name] ?? t.defaultDescription}
              onToggle={(on) => setDisabled(t.name, !on)}
              onDescription={(text) =>
                setDraft((d) => ({ ...d, descriptions: { ...d.descriptions, [t.name]: text } }))
              }
            />
          ))}
        </ul>
      </section>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-[#E3E8EF] bg-white/95 backdrop-blur md:left-[240px]",
          // Right padding clears the assistant's own round launcher (bottom-right, 56px).
          "flex items-center justify-end gap-3 py-3 pl-4 sm:pl-6",
          runtime.enabled ? "pr-24" : "pr-4 sm:pr-6",
        )}
      >
        <p className="mr-auto text-[13px] text-[#697386]" aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        <button
          type="button"
          onClick={() => setDraft(saved)}
          disabled={!dirty || saving}
          className="h-10 rounded-lg border border-[#E3E8EF] px-4 text-[13px] font-medium text-[#425466] transition-colors hover:bg-[#F6F9FC] disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="h-10 rounded-lg bg-[#635BFF] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#5249E0] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function RuntimeStrip({ runtime }: { runtime: Runtime }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-[13px]",
        runtime.enabled ? "border-[#E3E8EF] bg-[#F6F9FC] text-[#425466]" : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      {runtime.enabled ? (
        <>
          <span className="font-medium text-[#0A2540]">The assistant is on.</span> It hands off to{" "}
          {runtime.handoffName}.
        </>
      ) : (
        <>
          <span className="font-medium">The assistant is off</span> (ADMIN_CHAT_ENABLED is not 1). Settings saved here
          take effect once it is switched on.
        </>
      )}
    </div>
  );
}

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-[#E3E8EF] bg-white px-3 text-[13px] text-[#0A2540] focus:border-[#635BFF] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20";

function ModelCard({
  model,
  effort,
  runtime,
  onModel,
  onEffort,
}: {
  model: string;
  effort: string;
  runtime: Runtime;
  onModel: (v: string) => void;
  onEffort: (v: string) => void;
}) {
  const modelNote = CHAT_MODELS.find((m) => m.id === (model || runtime.model))?.note;
  const effortNote = CHAT_EFFORTS.find((e) => e.id === (effort || runtime.effort))?.note;
  return (
    <section className="rounded-xl border border-[#E3E8EF] bg-white">
      <div className="border-b border-[#E3E8EF] px-5 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
          Model
          <StateChip custom={Boolean(model || effort)} />
        </h2>
        <p className="mt-1 text-[13px] text-[#697386]">
          Which Claude model answers, and how long it thinks before answering. &ldquo;Deployment default&rdquo; uses
          the environment setting ({runtime.model}, effort {runtime.effort}).
        </p>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div>
          <label htmlFor="assistant-model" className="mb-1.5 block text-[12.5px] font-medium text-[#425466]">
            Model
          </label>
          <select id="assistant-model" value={model} onChange={(e) => onModel(e.target.value)} className={SELECT_CLASS}>
            <option value="">Deployment default ({runtime.model})</option>
            {CHAT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.id})
              </option>
            ))}
          </select>
          {modelNote && <p className="mt-1.5 text-[12px] text-[#8792A2]">{modelNote}</p>}
        </div>
        <div>
          <label htmlFor="assistant-effort" className="mb-1.5 block text-[12.5px] font-medium text-[#425466]">
            Effort
          </label>
          <select id="assistant-effort" value={effort} onChange={(e) => onEffort(e.target.value)} className={SELECT_CLASS}>
            <option value="">Deployment default ({runtime.effort})</option>
            {CHAT_EFFORTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          {effortNote && <p className="mt-1.5 text-[12px] text-[#8792A2]">{effortNote}</p>}
        </div>
      </div>
    </section>
  );
}

function InstructionsCard({
  value,
  handoffName,
  warnings,
  onChange,
}: {
  value: string;
  handoffName: string;
  warnings: string[];
  onChange: (v: string) => void;
}) {
  const isDefault = value.trim() === DEFAULT_INSTRUCTIONS.trim();
  const over = value.length > MAX_INSTRUCTIONS_CHARS;
  return (
    <section className="rounded-xl border border-[#E3E8EF] bg-white">
      <div className="flex flex-wrap items-start gap-3 border-b border-[#E3E8EF] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            Instructions
            <StateChip custom={!isDefault} />
          </h2>
          <p className="mt-1 text-[13px] text-[#697386]">
            The assistant&apos;s system prompt: what it is, what it may answer, and how.{" "}
            <code className="font-mono text-[12px]">{HANDOFF_PLACEHOLDER}</code> is replaced with {handoffName}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_INSTRUCTIONS)}
          disabled={isDefault}
          className="h-9 rounded-lg border border-[#E3E8EF] px-3 text-[13px] font-medium text-[#425466] transition-colors hover:bg-[#F6F9FC] disabled:opacity-40"
        >
          Reset to default
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <label htmlFor="assistant-instructions" className="sr-only">
          Instructions
        </label>
        <textarea
          id="assistant-instructions"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={22}
          spellCheck={false}
          className="block w-full resize-y rounded-lg border border-[#E3E8EF] bg-[#FBFCFD] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-[#0A2540] focus:border-[#635BFF] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20"
        />
        <p className={cn("text-right text-[12px] tabular-nums", over ? "text-[#DF1B41]" : "text-[#8792A2]")}>
          {value.length.toLocaleString()} / {MAX_INSTRUCTIONS_CHARS.toLocaleString()}
        </p>
        {warnings.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            The instructions mention {warnings.map((w) => w).join(", ")}, which {warnings.length === 1 ? "is" : "are"}{" "}
            switched off below. The assistant will be told to use a tool it does not have.
          </p>
        )}
        <details className="group rounded-lg border border-[#E3E8EF] bg-[#F6F9FC]">
          <summary className="cursor-pointer select-none px-3 py-2.5 text-[13px] font-medium text-[#425466]">
            Always added after your instructions (not editable)
          </summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-[#E3E8EF] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#425466]">
            {`${SAFETY_BLOCK}\n\n${referenceBlock()}`}
          </pre>
        </details>
      </div>
    </section>
  );
}

function ToolRow({
  tool,
  enabled,
  description,
  onToggle,
  onDescription,
}: {
  tool: ToolInfo;
  enabled: boolean;
  description: string;
  onToggle: (on: boolean) => void;
  onDescription: (text: string) => void;
}) {
  const custom = description.trim() !== tool.defaultDescription.trim();
  const id = `tool-desc-${tool.name}`;
  return (
    <li className={cn("px-5 py-4 transition-opacity", !enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#0A2540]">
            {tool.label}
            <code className="rounded bg-[#F6F9FC] px-1.5 py-0.5 font-mono text-[11.5px] font-normal text-[#697386]">
              {tool.name}
            </code>
            {!enabled && (
              <span className="rounded-full bg-[#E3E8EF] px-2 py-0.5 text-[11px] font-medium text-[#425466]">Off</span>
            )}
          </p>
          {tool.note && <p className="mt-1 text-[12.5px] text-[#697386]">{tool.note}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${tool.label} tool`}
          onClick={() => onToggle(!enabled)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
        >
          <span
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              enabled ? "bg-[#635BFF]" : "bg-[#CBD2DC]",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </span>
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2">
          <label htmlFor={id} className="text-[12.5px] font-medium text-[#425466]">
            Description
          </label>
          <StateChip custom={custom} />
          {custom && (
            <button
              type="button"
              onClick={() => onDescription(tool.defaultDescription)}
              className="ml-auto text-[12.5px] font-medium text-[#635BFF] hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        <textarea
          id={id}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          rows={3}
          maxLength={MAX_TOOL_DESCRIPTION_CHARS}
          className="block w-full resize-y rounded-lg border border-[#E3E8EF] bg-[#FBFCFD] px-3 py-2 text-[13px] leading-relaxed text-[#0A2540] focus:border-[#635BFF] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20"
        />
        {tool.inputs.length > 0 && (
          <p className="mt-1.5 text-[12px] text-[#8792A2]">
            Inputs:{" "}
            {tool.inputs.map((i, n) => (
              <span key={i.name}>
                {n > 0 && ", "}
                <code className="font-mono" title={i.description ?? undefined}>
                  {i.name}
                </code>
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function StateChip({ custom }: { custom: boolean }) {
  return custom ? (
    <span className="rounded-full bg-[#EEF0FF] px-2 py-0.5 text-[11px] font-medium text-[#635BFF]">Edited</span>
  ) : (
    <span className="rounded-full bg-[#F6F9FC] px-2 py-0.5 text-[11px] font-medium text-[#697386]">Default</span>
  );
}

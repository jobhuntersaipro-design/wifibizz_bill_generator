/**
 * Folds the chat route's NDJSON events into one assistant message. Pure, so
 * the order rules — which are easy to get subtly wrong and look fine until a
 * reply streams in a different order — are tested without a browser.
 */

export type TraceStep =
  | { kind: "thinking"; text: string }
  /** Text the model wrote before a tool call: working, not the answer. */
  | { kind: "note"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      /** Past tense, once finished ("Checked plans"). */
      label: string;
      /** Present tense, while running ("Checking plans"). */
      active: string;
      detail: string;
      state: "running" | "done" | "error";
      summary?: string;
    };

export interface AssistantMessage {
  role: "assistant";
  text: string;
  steps: TraceStep[];
  startedAt: number;
  endedAt?: number;
  handoff?: string;
  error?: boolean;
}

export type StreamEvent = Record<string, unknown> & { type: string };

const s = (v: unknown) => (typeof v === "string" ? v : "");

export function applyStreamEvent(m: AssistantMessage, ev: StreamEvent): AssistantMessage {
  switch (ev.type) {
    case "thinking": {
      const delta = s(ev.delta);
      if (!delta) return m;
      const last = m.steps[m.steps.length - 1];
      if (last?.kind === "thinking") {
        return { ...m, steps: [...m.steps.slice(0, -1), { ...last, text: last.text + delta }] };
      }
      return { ...m, steps: [...m.steps, { kind: "thinking", text: delta }] };
    }
    case "text":
      return { ...m, text: m.text + s(ev.delta) };
    case "tool_start": {
      // Text streamed before a tool call was the model thinking aloud. Move it
      // into the trace so the answer bubble holds only the answer.
      const steps = [...m.steps];
      if (m.text.trim()) steps.push({ kind: "note", text: m.text.trim() });
      steps.push({
        kind: "tool",
        id: s(ev.id),
        name: s(ev.name),
        label: s(ev.label) || s(ev.name),
        active: s(ev.active) || s(ev.label) || s(ev.name),
        detail: s(ev.detail),
        state: "running",
      });
      return { ...m, text: "", steps };
    }
    case "tool_end":
      return {
        ...m,
        steps: m.steps.map((st) =>
          st.kind === "tool" && st.id === s(ev.id)
            ? { ...st, state: ev.ok === false ? "error" : "done", summary: s(ev.summary) }
            : st,
        ),
      };
    case "handoff":
      return { ...m, handoff: s(ev.assignee) };
    case "error": {
      const msg = s(ev.message);
      return { ...m, text: m.text ? `${m.text}\n\n${msg}` : msg, error: !m.text };
    }
    default:
      return m;
  }
}

/** "Thought for 6s · 2 lookups" — the collapsed trace header. */
export function traceSummary(m: AssistantMessage, now = Date.now()): string {
  const secs = Math.max(1, Math.round(((m.endedAt ?? now) - m.startedAt) / 1000));
  const tools = m.steps.filter((st) => st.kind === "tool").length;
  const lookups = tools === 0 ? "" : ` · ${tools} ${tools === 1 ? "lookup" : "lookups"}`;
  return `Worked for ${secs}s${lookups}`;
}

/** The trace header while the reply is still being worked on. */
export function liveLabel(steps: TraceStep[]): string {
  const running = steps.filter(
    (st): st is Extract<TraceStep, { kind: "tool" }> => st.kind === "tool" && st.state === "running",
  );
  if (running.length === 1) return `${running[0].active}…`;
  if (running.length > 1) return `Running ${running.length} lookups…`;
  return "Thinking…";
}

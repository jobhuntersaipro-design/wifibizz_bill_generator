"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  ChartColumn,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileText,
  Images,
  Layers,
  Loader2,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { parseChatMarkdown, type Block, type Inline } from "@/lib/admin-chat/markdown";
import { listChatHandoffs, resolveChatHandoff, type HandoffRow } from "@/actions/admin-chat";
import {
  applyStreamEvent,
  liveLabel,
  traceSummary,
  type AssistantMessage,
  type StreamEvent,
  type TraceStep,
} from "@/lib/admin-chat/stream-state";

/**
 * The admin assistant popup — a testing feature, read-only.
 *
 * Mounted once in AdminShell, so the conversation survives moving between
 * admin pages. A reload starts a new chat; the old one stays in the database.
 */

type ChatMessage = { role: "user"; text: string } | AssistantMessage;

const SUGGESTIONS = [
  "Which orders failed today, and why?",
  "What plans are published at 500Mbps?",
  "Is anything stuck on the submit server right now?",
  "Which agent has the most failures this week?",
];

export function AdminChat({ handoffName }: { handoffName: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "handoffs">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffRow[] | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  /** Update the assistant message being streamed (always the last one). */
  const patchLast = (fn: (m: AssistantMessage) => AssistantMessage) =>
    setMessages((list) => {
      const last = list[list.length - 1];
      if (!last || last.role !== "assistant") return list;
      const copy = list.slice();
      copy[copy.length - 1] = fn(last);
      return copy;
    });

  async function loadHandoffs() {
    const res = await listChatHandoffs();
    setHandoffs(res.data);
    // Shown in the tab rather than toasted: an empty list must not pass for
    // "nothing open" when the list simply could not be read.
    setHandoffError(res.success ? null : res.error ?? "Could not load handoffs.");
  }

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
    void loadHandoffs();
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setLocked(null);
    setBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || locked) return;
    setInput("");
    setBusy(true);
    setMessages((list) => [
      ...list,
      { role: "user", text },
      { role: "assistant", text: "", steps: [], startedAt: Date.now() },
    ]);
    scrollToEnd();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        const msg = err?.error ?? `The assistant answered ${res.status}.`;
        if (res.status === 423) setLocked(msg);
        patchLast((m) => ({ ...m, text: msg, error: true }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handleEvent(JSON.parse(line) as StreamEvent);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        patchLast((m) => ({ ...m, text: m.text || "Could not reach the assistant.", error: !m.text }));
      }
    } finally {
      setBusy(false);
      patchLast((m) => ({ ...m, endedAt: Date.now() }));
      scrollToEnd();
    }
  }

  function handleEvent(ev: StreamEvent) {
    if (ev.type === "conversation") {
      setConversationId(String(ev.id));
      return;
    }
    if (ev.type === "locked") {
      setLocked(String(ev.message));
      return;
    }
    patchLast((m) => applyStreamEvent(m, ev));
    if (ev.type === "handoff") void loadHandoffs();
    if (ev.type === "text" || ev.type === "tool_start") scrollToEnd();
  }

  async function resolve(id: string) {
    const res = await resolveChatHandoff(id);
    if (!res.success) {
      toast.error(res.error ?? "Could not resolve.");
      return;
    }
    setHandoffs((list) => list?.filter((h) => h.id !== id) ?? null);
  }

  const openCount = handoffs?.length ?? 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label="Open admin assistant"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#635BFF] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Admin assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      className="fixed inset-0 z-50 flex flex-col bg-white md:inset-auto md:bottom-5 md:right-5 md:h-[600px] md:max-h-[calc(100vh-2.5rem)] md:w-[400px] md:rounded-xl md:border md:border-[#E3E8EF] md:shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-[#E3E8EF] px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#0A2540]">Admin assistant</h2>
          <p className="text-[11px] text-[#697386]">Testing · read-only · answers from BizzFlow data</p>
        </div>
        <button
          type="button"
          onClick={newChat}
          aria-label="New chat"
          title="New chat"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[#697386] hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close admin assistant"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[#697386] hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div role="tablist" className="flex border-b border-[#E3E8EF] px-3 text-sm">
        {(["chat", "handoffs"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              if (t === "handoffs") void loadHandoffs();
            }}
            className={`-mb-px min-h-11 border-b-2 px-3 font-medium ${
              tab === t ? "border-[#635BFF] text-[#0A2540]" : "border-transparent text-[#697386] hover:text-[#0A2540]"
            }`}
          >
            {t === "chat" ? "Chat" : `Handoffs${openCount ? ` (${openCount})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-[#697386]">
                  Ask about orders, failures, plans or agents. I can&apos;t change anything — for that, I hand off to{" "}
                  {handoffName}.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="block w-full rounded-lg border border-[#E3E8EF] px-3 py-2 text-left text-sm text-[#0A2540] hover:border-[#635BFF] hover:bg-[#F6F9FC]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="ml-10 animate-[fade-in-up_0.25s_ease-out_both] rounded-lg bg-[#635BFF] px-3 py-2 text-sm whitespace-pre-wrap text-white"
                >
                  {m.text}
                </div>
              ) : (
                <AssistantBubble key={i} message={m} streaming={busy && i === messages.length - 1} />
              ),
            )}
          </div>

          <form
            className="border-t border-[#E3E8EF] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            {locked && <p className="mb-2 rounded-md bg-[#FFF4E5] px-2 py-1.5 text-xs text-[#9A4B00]">{locked}</p>}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                rows={1}
                maxLength={1000}
                disabled={!!locked}
                placeholder={locked ? "Locked" : "Ask about an order, plan or agent…"}
                aria-label="Your question"
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[#E3E8EF] px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-[#A3ACB9] focus:border-[#635BFF] focus:outline-none disabled:bg-[#F6F9FC]"
              />
              <button
                type="submit"
                disabled={busy || !input.trim() || !!locked}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#635BFF] text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </>
      ) : (
        <HandoffList rows={handoffs} error={handoffError} onResolve={resolve} />
      )}
    </section>
  );
}

const TOOL_ICON: Record<string, LucideIcon> = {
  search_orders: Search,
  get_order: FileText,
  explain_error_code: CircleAlert,
  list_plans: Layers,
  order_stats: ChartColumn,
  live_jobs: Activity,
  list_image_pools: Images,
  escalate_to_human: UserRound,
};

/** Re-renders once a second while `active`, for the live elapsed time. */
function useTicking(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

function AssistantBubble({ message: m, streaming }: { message: AssistantMessage; streaming: boolean }) {
  useTicking(streaming);
  const hasTrace = m.steps.length > 0;
  const nothingYet = streaming && !hasTrace && !m.text;

  return (
    <div className="mr-6 space-y-2">
      {nothingYet && <TypingDots />}
      {hasTrace && <Trace message={m} streaming={streaming} />}
      {m.text ? (
        <div
          className={`animate-[fade-in_0.3s_ease-out_both] rounded-lg px-3 py-2 text-sm ${
            m.error ? "bg-[#FDECEC] text-[#9B1C1C]" : "bg-[#F6F9FC] text-[#0A2540]"
          }`}
        >
          <ChatText blocks={parseChatMarkdown(m.text)} />
          {streaming && !m.error && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-[#635BFF]"
            />
          )}
        </div>
      ) : null}
      {m.handoff && (
        <p className="flex animate-[scale-in_0.3s_ease-out_both] items-center gap-1.5 text-xs font-medium text-[#0A7B3E]">
          <UserRound className="h-3.5 w-3.5" />
          Handed off to {m.handoff}
        </p>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-[#F6F9FC] px-3 py-2.5" aria-label="Thinking">
      {["[animation-delay:0ms]", "[animation-delay:160ms]", "[animation-delay:320ms]"].map((d) => (
        <span key={d} className={`h-1.5 w-1.5 animate-[dot-pulse_1.2s_ease-in-out_infinite] rounded-full bg-[#635BFF] ${d}`} />
      ))}
    </div>
  );
}

function Trace({ message: m, streaming }: { message: AssistantMessage; streaming: boolean }) {
  // Open while it works; once the answer starts, fold away unless the admin
  // chose otherwise.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (streaming && !m.text);
  const working = streaming && !m.text;

  return (
    <div className="rounded-lg border border-[#E3E8EF] bg-white">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
      >
        <Sparkles className={`h-3.5 w-3.5 shrink-0 text-[#635BFF] ${working ? "animate-pulse" : ""}`} />
        {working ? (
          <span className="animate-shimmer truncate bg-[linear-gradient(90deg,#697386_0%,#C4B5FD_50%,#697386_100%)] bg-[length:200%_100%] bg-clip-text font-medium text-transparent">
            {liveLabel(m.steps)}
          </span>
        ) : (
          <span className="truncate font-medium text-[#697386]">{traceSummary(m)}</span>
        )}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-[#697386] transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <ol className="relative max-h-72 space-y-2.5 overflow-y-auto px-3 pt-1 pb-3 before:absolute before:top-3 before:bottom-4 before:left-[21px] before:w-px before:bg-[#E3E8EF]">
            {m.steps.map((st, i) => (
              <TraceRow key={st.kind === "tool" ? st.id : `${st.kind}-${i}`} step={st} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function TraceRow({ step }: { step: TraceStep }) {
  if (step.kind === "tool") {
    const Icon = TOOL_ICON[step.name] ?? Search;
    return (
      <li className="relative flex animate-[fade-in-up_0.3s_ease-out_both] gap-2.5 text-xs">
        <span
          className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${
            step.state === "error" ? "bg-[#FDECEC] text-[#9B1C1C]" : "bg-[#EEF0FF] text-[#635BFF]"
          }`}
        >
          {step.state === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[#0A2540]">
            <span className="font-medium">{step.state === "running" ? step.active : step.label}</span>
            {step.detail && <span className="truncate text-[#697386]">{step.detail}</span>}
          </p>
          {step.state !== "running" && step.summary && (
            <p
              className={`mt-1 inline-flex animate-[scale-in_0.25s_ease-out_both] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                step.state === "error" ? "bg-[#FDECEC] text-[#9B1C1C]" : "bg-[#E8F6EE] text-[#0A7B3E]"
              }`}
            >
              {step.state === "error" ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              {step.summary}
            </p>
          )}
        </div>
      </li>
    );
  }
  const Icon = step.kind === "thinking" ? Brain : Sparkles;
  return (
    <li className="relative flex animate-[fade-in-up_0.3s_ease-out_both] gap-2.5 text-xs">
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F6F9FC] text-[#697386] ring-4 ring-white">
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-[#697386] italic">
        <ChatText blocks={parseChatMarkdown(step.text)} />
      </div>
    </li>
  );
}

function ChatText({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "para" ? (
          <p key={i}>
            <InlineParts parts={b.parts} />
          </p>
        ) : b.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineParts parts={it} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineParts parts={it} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function InlineParts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        switch (p.kind) {
          case "bold":
            return <strong key={i} className="font-semibold">{p.text}</strong>;
          case "code":
            return (
              <code key={i} className="rounded bg-white px-1 font-mono text-[12px]">
                {p.text}
              </code>
            );
          case "link":
            return (
              <Link key={i} href={p.href} className="font-medium text-[#635BFF] underline-offset-2 hover:underline">
                {p.text}
              </Link>
            );
          default:
            return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}

function HandoffList({
  rows,
  error,
  onResolve,
}: {
  rows: HandoffRow[] | null;
  error: string | null;
  onResolve: (id: string) => void;
}) {
  if (error) {
    return <p className="flex-1 px-3 py-6 text-center text-sm text-[#9B1C1C]">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[#697386]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="flex-1 px-3 py-6 text-center text-sm text-[#697386]">No open handoffs.</p>;
  }
  return (
    <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
      {rows.map((h) => (
        <li key={h.id} className="rounded-lg border border-[#E3E8EF] p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-[#697386]">
                To {h.assignee}
                {h.orderRef ? ` · ${h.orderRef}` : ""} · {new Date(h.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" })}
                {h.emailed ? " · e-mailed" : " · not e-mailed"}
              </p>
              <p className="mt-1 text-[#0A2540]">{h.summary}</p>
              <p className="mt-1 text-xs text-[#697386]">Why: {h.reason}</p>
            </div>
            <button
              type="button"
              onClick={() => onResolve(h.id)}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#0A7B3E] hover:bg-[#F6F9FC]"
            >
              <CheckCircle2 className="h-4 w-4" /> Resolve
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
